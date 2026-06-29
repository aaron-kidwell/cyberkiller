// Command server is the CyberKiller control plane: the HTTP API for the player
// hub and admin panel, plus the target lifecycle (spin/score/reset). main() wires
// config, starts background workers, and registers every route in one block - read
// that route list first to see the whole API surface.
package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	adm "github.com/cyberkiller/api/internal/admin"
	"github.com/cyberkiller/api/internal/chat"
	"github.com/cyberkiller/api/internal/corp"
	"github.com/cyberkiller/api/internal/db"
	"github.com/cyberkiller/api/internal/flows"
	"github.com/cyberkiller/api/internal/images"
	"github.com/cyberkiller/api/internal/koth"
	"github.com/cyberkiller/api/internal/scoring"
	"github.com/cyberkiller/api/internal/settings"
	"github.com/cyberkiller/api/internal/targets"
)

func rateLimit(key string, limit int, window time.Duration) bool {
	return db.RateLimit(context.Background(), key, limit, window)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// rateLimitExceeded reports whether a failure-counter key has already hit its
// limit, WITHOUT incrementing it. Pairs with a later rateLimit() call that only
// fires on actual failures - so legitimate high-volume traffic isn't throttled.
func rateLimitExceeded(key string) bool {
	const adminFailLimit = 10
	return db.RateLimitCount(context.Background(), key) >= adminFailLimit
}

func withRateLimit(keyTpl string, limit int, window time.Duration, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Substitute both placeholders: {ip} for legacy callers, {user} for
		// session-aware bucketing. If a request has a valid token, {user}
		// resolves to "u:<player-uuid>"; otherwise to "ip:<addr>".
		key := strings.ReplaceAll(keyTpl, "{ip}", clientIP(r))
		key = strings.ReplaceAll(key, "{user}", clientKey(r))
		if !rateLimit(key, limit, window) {
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}
		next(w, r)
	}
}

// globalRateLimit is a backstop default: 600 requests/min per (user OR ip).
// Stops trivial flooding of endpoints that don't have a more specific limit.
func globalRateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rateLimit("global:"+clientKey(r), 600, time.Minute) {
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// trustedProxies is the set of immediate-peer IPs we'll honor X-Forwarded-For from.
// In our deployment Caddy → socat → API all live on loopback, so loopback is the
// only trusted source. Without this check, an attacker could spoof their source
// IP via the header and trivially escape per-IP rate limits.
var trustedProxies = map[string]bool{
	"127.0.0.1": true, "::1": true,
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	// Trust X-Forwarded-For only when the immediate connection is from a known
	// reverse proxy (Caddy on loopback). Otherwise the API would treat every
	// request as coming from 127.0.0.1 (Caddy) → one shared rate-limit bucket
	// for the entire internet, which is effectively no rate limit.
	if trustedProxies[host] {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			// First IP in the comma-separated chain is the original client.
			if i := strings.IndexByte(xff, ','); i > 0 {
				xff = xff[:i]
			}
			xff = strings.TrimSpace(xff)
			if xff != "" {
				return xff
			}
		}
		if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" {
			return xri
		}
	}
	return host
}

// clientKey returns a rate-limit bucket key that uses the session-token-owner
// when available, falling back to the client IP. Defeats multi-IP bypass for
// authenticated endpoints - a single user can't open 50 proxies and 50x their
// quota.
func clientKey(r *http.Request) string {
	if tok := sessionTokenFromRequest(r); tok != "" {
		if pid, _ := sessionLookup(r.Context(), tok); pid != "" {
			return "u:" + pid
		}
	}
	return "ip:" + clientIP(r)
}

var adminUser, adminPass string

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	adminUser = os.Getenv("ADMIN_USERNAME")
	adminPass = os.Getenv("ADMIN_PASSWORD")
	// The admin username can be anything (deploy.sh defaults it to "admin"); the
	// password is what must be set and not left at a known-weak placeholder.
	if adminUser == "" {
		adminUser = "admin"
	}
	if adminPass == "" || adminPass == "cyberkiller-admin-local" || adminPass == "change-me-strong-password" {
		log.Fatal("FATAL: set a strong ADMIN_PASS in .env before running")
	}

	if err := db.Connect(ctx); err != nil {
		log.Fatalf("db: %v", err)
	}
	db.ConnectRedis(ctx)
	db.ApplyMigrations(ctx)

	// Arena addressing depends on the network mode (bridge vs LAN ipvlan), driven
	// by ARENA_IP_PREFIX/ARENA_BOX_BASE. Seed the target IP pool and point the
	// MERIDIAN roster at the right IPs before anything provisions.
	targets.SeedIPPool(ctx)
	corp.InitRoster()

	flows.StartSampler(ctx, 15*time.Second)
	// Automated King-of-the-Hill: poll KOTH-mode targets for the throne holder and
	// tick points to them. No client needed - the control plane reads the box.
	koth.StartKingScanner(ctx)

	// MERIDIAN ships as a bundled example scenario: register its roster and bring
	// the containers online. The range is static and instructor-managed (no
	// rotation, no rounds), and scoring is awarded by the admin, so there is no
	// auto-spawn scheduler and no flag scanner.
	if corp.Enabled() {
		corp.RegisterMachines(ctx)
		corp.Provision(ctx)
	}

	go disconnectStalePlayers(ctx)
	chat.LoadHistoryFromDB()
	chat.StartEmoteFetcher()

	// Ensure upload directory exists
	uploadDir := os.Getenv("UPLOAD_DIR")
	if uploadDir == "" {
		uploadDir = "/opt/cyberkiller/uploads"
	}
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		log.Printf("warn: could not create upload dir %s: %v", uploadDir, err)
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestSize(10 * 1024 * 1024)) // 10 MB max body (images)
	r.Use(securityHeaders)
	r.Use(corsMiddleware)
	r.Use(globalRateLimit)

	r.Post("/signup", handleSignup)
	r.Post("/login", handleLogin)
	r.Post("/logout", handleLogout)
	// Rate-limited: registration is heavy (IP-pool allocation + wg peer ops) and,
	// under the fallback path, can evict an active player's peer. 5/min/IP is ample
	// for legitimate reconnect/re-register while making pool-exhaustion abuse impractical.
	r.Post("/heartbeat", handleHeartbeat)
	// Range intel endpoints require a valid session - foothold credentials and
	// machine IPs are dropped to the ticker/intel feed; exposing them pre-auth
	// would defeat the whole game.
	r.Get("/koth/hills", requireSession(handleKothHills))
	r.Get("/radar", withRateLimit("radar:"+"{ip}", 30, time.Minute, requireSession(handleRadar)))
	r.Get("/activity", withRateLimit("activity:"+"{ip}", 30, time.Minute, requireSession(handleActivity)))
	r.Get("/scores", withRateLimit("scores:"+"{ip}", 120, time.Minute, handleScores)) // leaderboard stays public
	r.Get("/sitrep/latest", requireSession(handleSitrep))
	r.Get("/signup/mode", handleSignupMode)
	r.Get("/announcement", handleAnnouncement)
	r.Get("/ticker/events", withRateLimit("ticker:"+"{ip}", 120, time.Minute, requireSession(handleTicker)))
	r.Get("/arena/stats", withRateLimit("stats:"+"{ip}", 120, time.Minute, requireSession(handleArenaStats)))
	r.Get("/chat/ws", chat.HandleWS)
	r.Get("/chat/online", chat.OnlineHandler)
	r.Get("/chat/messages", chat.HistoryHandler)
	r.Get("/chat/emotes", chat.EmotesHandler)
	r.Get("/session/check", handleSessionCheck)
	r.Get("/player/{handle}", handleGetPlayer)
	r.Put("/player/{handle}", handlePutPlayer)
	r.Put("/player/{handle}/password", withRateLimit("pwchange:{ip}", 5, time.Minute, handleChangePassword))
	r.Delete("/player/{handle}", withRateLimit("delplayer:{ip}", 3, time.Minute, handleDeletePlayer))
	r.Get("/player/{handle}/posts", handleGetPosts)
	r.Get("/player/{handle}/posts/{postID}", handleGetPost)
	r.Post("/player/{handle}/posts", handleCreatePost)
	r.Put("/player/{handle}/posts/{postID}", handleUpdatePost)
	r.Delete("/player/{handle}/posts/{postID}", handleDeletePost)
	r.Post("/images/submit", handleImageSubmit)
	r.Get("/content", handleGetContent)
	r.Get("/theme", handleGetTheme)
	r.Get("/health", handleHealth)
	r.Get("/token/{token}", handleGetPlayerByToken)
	r.Post("/koth/feedback", handleSubmitFeedback)
	r.Post("/report", handleSubmitReport)
	r.Post("/koth/{arenaIP}/vote-reset", handleVoteReset)
	r.Get("/range-reset/votes", handleRangeResetVotes)
	r.Post("/range-reset/vote", handleRangeResetVote)
	r.Get("/known-issues", handleListKnownIssues)
	r.Get("/features", handleListFeatures)
	r.Post("/features", handleCreateFeature)
	r.Post("/features/{id}/vote", handleVoteFeature)
	r.Delete("/features/{id}", handleDeleteFeature)
	r.Post("/upload", makeUploadHandler(uploadDir))
	r.Get("/files/{filename}", makeFileHandler(uploadDir))

	// Discord-bot-friendly public API
	r.Route("/api/v1", func(ar chi.Router) {
		ar.Get("/leaderboard", handleAPILeaderboard)
		ar.Get("/kills", handleAPIKills)
		ar.Get("/stats", handleAPIStats)
	})

	if os.Getenv("LOCAL_MODE") == "true" {
		r.Route("/debug", func(dr chi.Router) {
			dr.Use(adminAuth)
			dr.Post("/reapply-dnat", func(w http.ResponseWriter, r *http.Request) {
				targets.ReconcileStaleMachines(r.Context())
				targets.ReapplyArenaNetworking(r.Context())
				writeJSON(w, 200, map[string]string{"ok": "true"})
			})
		})
	}

	// Admin routes (simple token auth)
	r.Route("/admin", func(ar chi.Router) {
		ar.Use(adminAuth)
		ar.Get("/submissions", handleAdminSubmissions)
		ar.Post("/submissions/{id}/approve", handleAdminApprove)
		ar.Post("/submissions/{id}/reject", handleAdminReject)
		ar.Get("/players", adm.GetPlayers)
		ar.Post("/players/{handle}/ban", adm.BanPlayer)
		ar.Post("/players/{handle}/kick", adm.KickPlayer)
		ar.Post("/players/{handle}/reset-score", adm.ResetPlayerScore)
		ar.Post("/players/{handle}/set-password", adm.SetPlayerPassword)
		ar.Post("/players/{handle}/set-admin", adm.SetPlayerAdmin)
		ar.Delete("/players/{handle}", adm.DeletePlayer)
		ar.Delete("/scores", adm.PurgeScores)
		ar.Delete("/kills", adm.PurgeActivity)
		ar.Post("/hills/{ip}/expire", adm.ExpireHill)
		ar.Post("/hills/{ip}/reset", adm.ResetHill)
		ar.Get("/chat/history", adm.GetChatHistory)
		ar.Post("/chat/send", adm.SendChatMessage)
		ar.Delete("/chat/messages/{id}", adm.DeleteChatMessage)
		ar.Post("/chat/timeout/{handle}", adm.TimeoutChatPlayer)
		ar.Post("/chat/slowmode", adm.SetChatSlowmode)
		ar.Post("/ticker/speed", adm.SetTickerSpeed)
		ar.Post("/chat/emote-only", adm.SetChatEmoteOnly)
		ar.Get("/chat/mode", adm.GetChatMode)
		ar.Get("/known-issues", adm.ListKnownIssues)
		ar.Post("/known-issues", adm.CreateKnownIssue)
		ar.Put("/known-issues/{id}", adm.UpdateKnownIssue)
		ar.Delete("/known-issues/{id}", adm.DeleteKnownIssue)
		ar.Get("/features", adm.ListFeatures)
		ar.Post("/features/{id}/status", adm.SetFeatureStatus)
		ar.Delete("/features/{id}", adm.DeleteFeature)
		ar.Get("/images", adm.GetImages)
		ar.Put("/images/{id}", adm.PutImage)
		ar.Delete("/images/{id}", adm.DeleteImage)
		// Modular targets: add by registry reference or upload, spin, stop.
		ar.Post("/targets", adm.AddTarget)
		ar.Post("/targets/upload", adm.UploadTarget)
		ar.Post("/targets/{id}/spin", adm.SpinTarget)
		ar.Post("/targets/{id}/stop", adm.StopTarget)
		ar.Get("/settings", adm.GetSettings)
		ar.Put("/settings", adm.PutSettings)
		ar.Get("/hills", adm.GetHills)
		ar.Get("/health-log", adm.GetHealthLog)
		ar.Delete("/health-log", adm.ClearHealthLog)
		ar.Delete("/health-log/{id}", adm.DeleteHealthLogEntry)
		ar.Get("/audit-log", adm.GetAuditLog)
		ar.Delete("/audit-log", adm.ClearAuditLog)
		ar.Delete("/audit-log/{id}", adm.DeleteAuditLogEntry)
		ar.Get("/game-events", adm.GetGameEvents)
		// Manual scoring: the instructor awards/revokes a user or root capture.
		ar.Post("/award", adm.AwardCapture)
		ar.Post("/revoke", adm.RevokeCapture)
		ar.Get("/feedback", adm.GetFeedback)
		ar.Delete("/feedback/{id}", adm.DeleteFeedback)
		ar.Delete("/feedback", adm.ClearFeedback)
		ar.Get("/reports", handleGetReports)
		ar.Delete("/reports/{id}", handleDeleteReport)
		ar.Post("/ticker", adm.PostTicker)
		ar.Post("/sitrep", adm.PostSitrep)
		ar.Put("/content", handlePutContent)
		ar.Put("/theme", handlePutTheme)
		ar.Post("/upload", handleUpload)
		// MERIDIAN example-scenario management
		ar.Get("/corp/machines", handleCorpMachines)
		ar.Post("/corp/{ip}/reset", handleCorpReset)
		ar.Post("/corp/{ip}/test", handleCorpTest)
		ar.Post("/corp/{ip}/clear-king", handleCorpClearKing)
	})

	addr := os.Getenv("BIND_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	log.Printf("CyberKiller API listening on %s", addr)
	// Timeouts prevent slow-loris and idle-connection FD exhaustion.
	// WS connections are hijacked so the WriteTimeout doesn't apply to them after upgrade.
	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 16, // 64 KB
	}
	go func() {
		<-ctx.Done()
		srv.Shutdown(context.Background())
	}()
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func disconnectStalePlayers(ctx context.Context) {
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			timeout := settings.Int(ctx, "heartbeat_timeout_s", 15)
			db.Pool.Exec(ctx, `
				UPDATE players SET connected = false
				WHERE last_heartbeat < NOW() - ($1 * INTERVAL '1 second') AND connected = true
			`, timeout)
		}
	}
}

type SignupRequest struct {
	Handle     string `json:"handle"`
	InviteCode string `json:"invite_code"`
	Password   string `json:"password"`
}

// handleSignupMode returns whether signup requires an invite code so the
// frontend can adapt the form (prompt for code first, mark it required).
// handleAnnouncement returns the operator-set announcement shown to players as a
// first-login popup and via the Announcements button. Bumping announcement_version
// re-shows it to everyone (clients track the last-seen version locally).
func handleAnnouncement(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	writeJSON(w, 200, map[string]any{
		"title":   settings.GetOr(ctx, "announcement_title", "Welcome to the CyberKiller alpha"),
		"body":    settings.GetOr(ctx, "announcement_body", ""),
		"active":  settings.GetOr(ctx, "announcement_active", "true") == "true",
		"version": settings.Int(ctx, "announcement_version", 1),
	})
}

func handleSignupMode(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	mode := settings.GetOr(ctx, "signup_mode", os.Getenv("SIGNUP_OPEN"))
	if mode == "true" {
		mode = "open"
	}
	dbCode := settings.GetOr(ctx, "signup_invite_code", os.Getenv("SIGNUP_INVITE_CODE"))
	switch mode {
	case "closed":
		// Invite-only: a valid code still works, so prompt for one.
		writeJSON(w, 200, map[string]any{"mode": "closed", "code_required": true})
	case "code":
		writeJSON(w, 200, map[string]any{"mode": "code", "code_required": true})
	case "open":
		writeJSON(w, 200, map[string]any{"mode": "open", "code_required": false})
	default:
		// env-var fallback: code required if env code is set and SIGNUP_OPEN != true
		required := dbCode != "" && os.Getenv("SIGNUP_OPEN") != "true"
		if required {
			writeJSON(w, 200, map[string]any{"mode": "code", "code_required": true})
		} else {
			writeJSON(w, 200, map[string]any{"mode": "open", "code_required": false})
		}
	}
}

func handleSignup(w http.ResponseWriter, r *http.Request) {
	if !rateLimit("signup:"+clientIP(r), 5, time.Minute) {
		writeError(w, 429, "too many signup attempts: try again in a minute")
		return
	}
	var req SignupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "invalid request")
		return
	}
	handle := strings.TrimSpace(req.Handle)
	if !validHandle.MatchString(handle) {
		writeError(w, 400, "handle must be 2-32 characters: letters, numbers, _ or -")
		return
	}

	ctx := r.Context()
	mode := settings.GetOr(ctx, "signup_mode", os.Getenv("SIGNUP_OPEN"))
	if mode == "true" {
		mode = "open"
	}
	dbCode := settings.GetOr(ctx, "signup_invite_code", os.Getenv("SIGNUP_INVITE_CODE"))

	// A valid invite code is an explicit grant and lets the holder in regardless
	// of signup_mode - including "closed", which then behaves as invite-only.
	var matchedCode string
	if req.InviteCode != "" && dbCode != "" && req.InviteCode == dbCode {
		matchedCode = req.InviteCode
	}

	// Gate codeless signups by mode. A valid code bypasses all of this.
	if matchedCode == "" {
		switch mode {
		case "open":
			// allow codeless
		case "closed":
			writeError(w, 403, "registration is invite-only right now: you need an invite code")
			return
		case "code":
			writeError(w, 403, "an invite code is required to register")
			return
		default:
			if os.Getenv("SIGNUP_OPEN") != "true" {
				writeError(w, 403, "registration is invite-only right now: you need an invite code")
				return
			}
		}
		// If a code WAS supplied but didn't match, be explicit.
		if req.InviteCode != "" {
			writeError(w, 403, "invalid or expired invite code")
			return
		}
	}

	b := make([]byte, 16)
	rand.Read(b)
	token := "INV-" + hex.EncodeToString(b)

	if msg := validatePassword(req.Password); msg != "" {
		writeError(w, 400, msg)
		return
	}
	h, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, 500, "password hashing failed")
		return
	}
	pwHash := string(h)

	var playerID uuid.UUID
	err = db.Pool.QueryRow(ctx, `
		INSERT INTO players (handle, invite_token, password_hash) VALUES ($1, $2, $3) RETURNING id
	`, handle, token, pwHash).Scan(&playerID)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			writeError(w, 409, "handle already taken")
			return
		}
		writeError(w, 500, "registration failed")
		return
	}
	db.Pool.Exec(ctx, `INSERT INTO scores (player_id) VALUES ($1) ON CONFLICT DO NOTHING`, playerID)
	db.Pool.Exec(ctx, `INSERT INTO ticker_events (message) VALUES ($1)`,
		handle+" joined the arena")

	// Issue a session token immediately so the new player can use the web UI without a separate login.
	// Also set invite_token expiry for the new player.
	sessBuf := make([]byte, 24)
	rand.Read(sessBuf)
	sessionToken := "SES-" + hex.EncodeToString(sessBuf)
	db.Pool.Exec(ctx, `UPDATE players SET session_token=$1, session_token_expires_at=NOW()+INTERVAL '24 hours',
		session_started_at=NOW(), invite_token_expires_at=NOW()+INTERVAL '1 year' WHERE id=$2`, sessionToken, playerID)

	setSessionCookie(w, sessionToken)
	writeJSON(w, 200, map[string]string{
		"player_id":     playerID.String(),
		"handle":        handle,
		"invite_token":  token,
		"session_token": sessionToken, // still in response for CLI/agent clients
	})
}

// requireSession wraps a handler so it only fires when the caller has a valid
// session token. Returns 401 otherwise. Used to gate range/intel endpoints
// (foothold credentials, target IPs) so they aren't readable pre-auth.
func requireSession(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := sessionTokenFromRequest(r)
		if token == "" {
			writeError(w, 401, "authentication required")
			return
		}
		pid, _ := sessionLookup(r.Context(), token)
		if pid == "" {
			writeError(w, 401, "invalid or expired session: please log in again")
			return
		}
		next(w, r)
	}
}

// handleLogout invalidates the caller's session by NULLing session_token in the DB.
// Without this, "logging out" would only clear the client's localStorage - anyone
// who had read the token (XSS / shared computer / forensic dump) would retain access.
func handleLogout(w http.ResponseWriter, r *http.Request) {
	// Light rate limit so an attacker who somehow learned a token (e.g. from
	// a log line or shoulder-surf) can't trivially grief the user by logging
	// them out repeatedly. The cookie clear below is unconditional so a
	// legitimate user always succeeds at clearing their own browser cookie.
	if !rateLimit("logout:"+clientIP(r), 30, time.Minute) {
		writeError(w, 429, "too many logout attempts")
		return
	}
	token := sessionTokenFromRequest(r)
	if token != "" {
		// Verify the token is currently valid (not just a guessed string)
		// before invalidating it server-side. Avoids an attacker with a
		// stale/guessed token nuking a valid session by collision.
		pid, _ := sessionLookup(r.Context(), token)
		if pid != "" {
			db.Pool.Exec(r.Context(), `
				UPDATE players SET session_token=NULL, session_token_expires_at=NULL
				WHERE session_token=$1
			`, token)
		}
	}
	clearSessionCookie(w)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

// handleSessionCheck returns 200+handle if the session cookie or X-Player-Token
// header is valid, 401 otherwise. Used by the web UI to detect expired sessions
// and prompt re-login. Query-param tokens are NOT accepted - they would leak to
// server access logs, browser history, and Referer headers.
func handleSessionCheck(w http.ResponseWriter, r *http.Request) {
	token := sessionTokenFromRequest(r)
	if token == "" {
		writeError(w, 401, "no token")
		return
	}
	_, handle := sessionLookup(r.Context(), token)
	if handle == "" {
		writeError(w, 401, "invalid or expired session")
		return
	}
	writeJSON(w, 200, map[string]string{"handle": handle})
}

// sessionCookieName is the HttpOnly cookie that holds the session token in
// browsers. Same value can also be sent via X-Player-Token (for CLI/test tools
// and the SDK), so legacy callers continue to work.
const sessionCookieName = "ck_session"

// cookieSecure controls the Secure flag on the session cookie. A Secure cookie
// is dropped by browsers over plain HTTP, which silently breaks login on a LAN
// (http://host) deploy. We turn it on only when API_URL is https, so a domain +
// TLS deploy still gets the hardening and a local HTTP deploy still works.
var cookieSecure = strings.HasPrefix(strings.ToLower(os.Getenv("API_URL")), "https://")

// setSessionCookie writes the session token as an HttpOnly cookie scoped to
// "/". Secure flag is on whenever we're behind HTTPS - which Caddy ensures in
// prod. SameSite=Lax prevents CSRF for most cross-site form submits while
// still allowing top-level navigation (so following an email link still works).
func setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   cookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   24 * 60 * 60, // 24h, matches DB session_token_expires_at
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   cookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// sessionTokenFromRequest pulls the session token from the HttpOnly cookie
// (preferred) or X-Player-Token header (CLI / legacy compatibility).
func sessionTokenFromRequest(r *http.Request) string {
	if c, err := r.Cookie(sessionCookieName); err == nil && c.Value != "" {
		return c.Value
	}
	return r.Header.Get("X-Player-Token")
}

// sessionLookup resolves a rotating session_token (sent as X-Player-Token by the web UI)
// to the player's UUID and handle. Returns empty strings on failure.
// The agent uses invite_token in JSON body (agentAuth) - not this function.
func sessionLookup(ctx context.Context, sessionToken string) (playerID, handle string) {
	if sessionToken == "" {
		return "", ""
	}
	db.Pool.QueryRow(ctx,
		`SELECT id::text, COALESCE(handle,'') FROM players
		 WHERE session_token=$1 AND NOT banned
		   AND (session_token_expires_at IS NULL OR session_token_expires_at > NOW())`,
		sessionToken,
	).Scan(&playerID, &handle)
	return
}

// agentAuth validates that the invite_token in the request body matches the player_id.
// Returns the validated player UUID string, or "" if auth fails.
// handleHeartbeat is a lightweight presence ping. The hub posts it on a timer
// while a player has the page open so the online list and "connected" count
// reflect who is currently active. It is session-authenticated; there is no
// agent.
func handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	pid, _ := sessionLookup(r.Context(), sessionTokenFromRequest(r))
	if pid == "" {
		writeError(w, 401, "authentication required")
		return
	}
	if !rateLimit("heartbeat:"+pid, 30, time.Minute) {
		writeError(w, 429, "heartbeat rate exceeded")
		return
	}
	db.Pool.Exec(r.Context(), `UPDATE players SET last_heartbeat=NOW(), connected=true WHERE id=$1::uuid`, pid)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func handleKothHills(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Pool.Query(r.Context(), `
		SELECT host(arena_ip), tier, image_name, bounty_pts, COALESCE(king_handle,''), status,
			CASE WHEN expires_at IS NULL OR expires_at > NOW() + INTERVAL '100 years'
			     THEN -1
			     ELSE GREATEST(0, EXTRACT(EPOCH FROM (expires_at - NOW()))::int)
			END AS ttl_secs
		FROM koth_machines WHERE status IN ('active','spinning') ORDER BY started_at DESC
	`)
	if err != nil {
		log.Printf("koth hills query error: %v", err)
		writeError(w, 500, "failed to load hills")
		return
	}
	defer rows.Close()
	var hills []map[string]any
	for rows.Next() {
		var ip, tier, img, king, status string
		var bounty, ttl int
		rows.Scan(&ip, &tier, &img, &bounty, &king, &status, &ttl)
		hills = append(hills, map[string]any{
			"arena_ip": ip, "tier": tier, "image_name": img, "bounty_pts": bounty,
			"king_handle": king, "status": status, "ttl_secs": ttl,
		})
	}
	writeJSON(w, 200, map[string]any{"hills": hills})
}

func handleRadar(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	// Flag "captured" pills are per-viewer: a ✓ means YOU captured that flag,
	// not that someone (anyone) did. king_handle still shows who currently holds it.
	viewerID, _ := sessionLookup(ctx, sessionTokenFromRequest(r))
	if viewerID == "" {
		viewerID = "00000000-0000-0000-0000-000000000000"
	}
	var tgts []map[string]any
	if !targets.KothOnly() {
		rows, _ := db.Pool.Query(ctx, `
			SELECT host(arena_ip), tier, cred_hint, intel_hint, open_ports, image_name, submitter_handle,
				EXTRACT(EPOCH FROM (issued_at + (ttl_seconds || ' seconds')::interval - NOW()))::int
			FROM targets WHERE status='active'
		`)
		if rows != nil {
			defer rows.Close()
			for rows.Next() {
				var ip, tier, cred, intel, img, sub *string
				var ports []byte
				var ttl int
				rows.Scan(&ip, &tier, &cred, &intel, &ports, &img, &sub, &ttl)
				m := map[string]any{"type": "target", "arena_ip": ip, "tier": tier, "ttl_secs": ttl}
				// No cred_hint in radar - credentials belong in a dedicated connect flow.
				if intel != nil && *intel != "" {
					m["intel_hint"] = *intel
					m["has_intel"] = true
				}
				if ip != nil {
					if live := targets.ProbeOpenPorts(*ip); len(live) > 0 {
						m["open_ports"] = live
					} else if len(ports) > 0 {
						var portList any
						json.Unmarshal(ports, &portList)
						m["open_ports"] = portList
						m["ports_live"] = false
					}
				}
				tgts = append(tgts, m)
			}
		}
	}
	hillRows, _ := db.Pool.Query(ctx, `
		SELECT host(k.arena_ip), k.tier, COALESCE(k.image_name,''), COALESCE(k.king_handle,''),
			k.bounty_pts, COALESCE(k.intel_hint,''),
			CASE WHEN k.expires_at IS NULL OR k.expires_at > NOW() + INTERVAL '100 years'
			     THEN -1
			     ELSE GREATEST(0, EXTRACT(EPOCH FROM (k.expires_at - NOW()))::int)
			END,
			EXISTS(SELECT 1 FROM kills WHERE koth_id=k.id AND kind='user_flag' AND attacker_id=$1::uuid),
			EXISTS(SELECT 1 FROM kills WHERE koth_id=k.id AND kind='admin_flag' AND attacker_id=$1::uuid)
			OR (COALESCE(k.linux_machine,false) OR COALESCE(k.is_domain_controller,false))
			AND EXISTS(SELECT 1 FROM kills WHERE koth_id=k.id AND kind='root_flag' AND attacker_id=$1::uuid),
			EXISTS(SELECT 1 FROM kills WHERE koth_id=k.id AND kind='root_flag' AND attacker_id=$1::uuid),
			CASE WHEN k.king_since IS NOT NULL
				THEN GREATEST(0, EXTRACT(EPOCH FROM (NOW() - k.king_since))::int)
				ELSE 0 END,
			COALESCE(k.machine_type,'docker'),
			COALESCE(k.ad_domain,''),
			COALESCE(k.is_domain_controller, false),
			COALESCE(k.linux_machine, false),
			COALESCE(k.health_ok, true),
			COALESCE(k.user_flag_handle,''),
			COALESCE(k.koth_enabled, false)
		FROM koth_machines k WHERE k.status='active'
	`, viewerID)
	if hillRows != nil {
		defer hillRows.Close()
		userPts := settings.Int(ctx, "user_flag_points", scoring.UserFlagPoints)
		rootPts := settings.Int(ctx, "root_flag_points", scoring.RootFlagPoints)
		for hillRows.Next() {
			var ip, tier, img, king, intel, machineType, adDomain, userFlagBy string
			var bounty, ttl, kingSecs int
			var userCap, adminCap, rootCap, isDC, isLinux, healthOk, kothEnabled bool
			hillRows.Scan(&ip, &tier, &img, &king, &bounty, &intel, &ttl,
				&userCap, &adminCap, &rootCap,
				&kingSecs, &machineType, &adDomain, &isDC, &isLinux,
				&healthOk, &userFlagBy, &kothEnabled)

			recordType := "koth"
			if machineType == "ad" {
				recordType = "ad"
			} else if machineType == "corp" {
				recordType = "corp"
			}

			m := map[string]any{
				"type": recordType, "arena_ip": ip, "tier": tier, "image_name": img,
				"king_handle": king, "bounty_pts": bounty, "ttl_secs": ttl,
				"king_since_secs":    kingSecs,
				"koth":               kothEnabled,
				"user_flag_points":   userPts,
				"root_flag_points":   rootPts,
				"user_flag_captured": userCap,
				"user_flag_by":       userFlagBy,
				"root_flag_captured": rootCap,
				"health_ok":          healthOk,
			}

			if machineType == "corp" {
				m["os"] = "linux"
				m["ttl_secs"] = -1 // static instructor-managed boxes never expire
			}
			// Live probe of the box's real arena IP for open service ports. Targets
			// have real IPs on the arena bridge, so this reflects what a player's nmap
			// sees. No cred_hint here - credentials are part of a box's challenge.
			if live := targets.ProbeOpenPorts(ip); len(live) > 0 {
				m["open_ports"] = live
			} else {
				m["open_ports"] = []map[string]any{}
				m["ports_live"] = false
			}

			if intel != "" {
				m["intel_hint"] = intel
				m["has_intel"] = true
			}
			tgts = append(tgts, m)
		}
	}
	// Merge avg star ratings
	ratingMap := map[string]int{}
	rRows, _ := db.Pool.Query(ctx, `
		SELECT host(arena_ip), ROUND(AVG(stars))::int
		FROM machine_feedback
		GROUP BY arena_ip
	`)
	if rRows != nil {
		defer rRows.Close()
		for rRows.Next() {
			var ip string
			var avg int
			rRows.Scan(&ip, &avg)
			ratingMap[ip] = avg
		}
	}

	// Merge reset vote counts for koth hills
	resetThreshold := koth.VoteResetThreshold(ctx)
	voteMap := map[string]int{}
	vRows, _ := db.Pool.Query(ctx, `
		SELECT host(k.arena_ip), COUNT(v.player_id)
		FROM koth_reset_votes v
		JOIN koth_machines k ON k.id = v.machine_id
		WHERE k.status = 'active'
		GROUP BY k.arena_ip
	`)
	if vRows != nil {
		defer vRows.Close()
		for vRows.Next() {
			var ip string
			var cnt int
			vRows.Scan(&ip, &cnt)
			voteMap[ip] = cnt
		}
	}

	// Optionally tag which hills the requesting player already voted on
	var requestingPlayerID string
	if tok := sessionTokenFromRequest(r); tok != "" {
		requestingPlayerID, _ = sessionLookup(ctx, tok)
	}
	myVotes := map[string]bool{}
	if requestingPlayerID != "" {
		mvRows, _ := db.Pool.Query(ctx, `
			SELECT host(k.arena_ip)
			FROM koth_reset_votes v
			JOIN koth_machines k ON k.id = v.machine_id
			WHERE v.player_id=$1 AND k.status='active'
		`, requestingPlayerID)
		if mvRows != nil {
			defer mvRows.Close()
			for mvRows.Next() {
				var ip string
				mvRows.Scan(&ip)
				myVotes[ip] = true
			}
		}
	}

	for _, m := range tgts {
		if ip, ok := m["arena_ip"].(string); ok {
			if avg, found := ratingMap[ip]; found {
				m["avg_stars"] = avg
			}
			if m["type"] == "koth" || m["type"] == "ad" || m["type"] == "corp" {
				m["reset_votes"] = voteMap[ip]
				m["reset_threshold"] = resetThreshold
				m["my_reset_vote"] = myVotes[ip]
			}
		}
	}

	waveInProgress := settings.GetOr(ctx, "wave_in_progress", "false") == "true"

	writeJSON(w, 200, map[string]any{"machines": tgts, "wave_in_progress": waveInProgress})
}

func handleActivity(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	hot := []map[string]any{}
	rows, _ := db.Pool.Query(ctx, `
		SELECT f.dst_ip::text, COUNT(DISTINCT f.src_ip), array_agg(DISTINCT p.handle)
		FROM flows f
		JOIN players p ON p.arena_ip = f.src_ip
		WHERE f.observed_at > NOW() - INTERVAL '2 minutes'
		GROUP BY f.dst_ip
	`)
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var dst string
			var cnt int
			var handles []string
			rows.Scan(&dst, &cnt, &handles)
			hot = append(hot, map[string]any{"arena_ip": dst, "attackers": cnt, "handles": handles})
		}
	}
	kills := []map[string]any{}
	flags := []map[string]any{}
	// Persistent capture log (survives round resets), not the kills table which is
	// wiped on reset. first_blood is the recorded all-time value.
	krows, _ := db.Pool.Query(ctx, `
		SELECT kind, points, handle, captured_at, COALESCE(arena_ip,''), first_blood
		FROM capture_log
		ORDER BY captured_at DESC LIMIT 50
	`)
	if krows != nil {
		defer krows.Close()
		for krows.Next() {
			var kind, handle, ip string
			var pts int
			var at time.Time
			var firstBlood bool
			krows.Scan(&kind, &pts, &handle, &at, &ip, &firstBlood)
			entry := map[string]any{"kind": kind, "points": pts, "handle": handle, "arena_ip": ip, "first_blood": firstBlood, "ago": time.Since(at).Round(time.Second).String()}
			if kind == "user_flag" {
				flags = append(flags, entry)
			} else {
				kills = append(kills, entry)
			}
		}
	}
	writeJSON(w, 200, map[string]any{"hot": hot, "kills": kills, "flags": flags})
}

func handleScores(w http.ResponseWriter, r *http.Request) {
	// Kills is the primary metric (persistent across rotations).
	// Points is the tiebreaker so flag captures still matter.
	rows, _ := db.Pool.Query(r.Context(), `
		SELECT p.handle, s.points, s.kills, RANK() OVER (ORDER BY s.kills DESC, s.points DESC),
		       COALESCE(p.title,''),
		       (SELECT COUNT(*) FROM koth_holds kh WHERE kh.player_id = p.id),
		       COALESCE(s.longest_reign_secs, 0)
		FROM scores s JOIN players p ON p.id = s.player_id
		WHERE s.points > 0 OR s.kills > 0
		ORDER BY s.kills DESC, s.points DESC LIMIT 50
	`)
	defer rows.Close()
	board := []map[string]any{}
	rank := 1
	for rows.Next() {
		var handle, title string
		var pts, kills, rk, crowns, reign int
		rows.Scan(&handle, &pts, &kills, &rk, &title, &crowns, &reign)
		board = append(board, map[string]any{"rank": rank, "handle": handle, "points": pts, "kills": kills, "koth_crowns": crowns, "title": title, "longest_reign_secs": reign})
		rank++
	}
	writeJSON(w, 200, map[string]any{"leaderboard": board})
}

func handleArenaStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var online, activeTargets, kills int
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM players WHERE connected = true`).Scan(&online)
	// Live targets are koth_machines rows (the modular + MERIDIAN boxes).
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM koth_machines WHERE status = 'active'`).Scan(&activeTargets)
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM kills WHERE submitted_at > NOW() - INTERVAL '24 hours'`).Scan(&kills)

	rows, _ := db.Pool.Query(ctx, `
		SELECT handle, agent_version FROM players
		WHERE connected = true ORDER BY last_heartbeat DESC LIMIT 200
	`)
	connected := []map[string]any{}
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var h, agentVer string
			rows.Scan(&h, &agentVer)
			connected = append(connected, map[string]any{
				"handle":        h,
				"agent_version": agentVer,
			})
		}
	}
	now := time.Now()
	res := map[string]any{
		"online_players": online, "active_targets": activeTargets,
		"kills_24h": kills, "connected": connected, "updated_at": now.Format(time.RFC3339),
		"user_flag_points":  settings.Int(ctx, "user_flag_points", scoring.UserFlagPoints),
		"root_flag_points":  settings.Int(ctx, "root_flag_points", scoring.RootFlagPoints),
		"ticker_px_per_sec": settings.Int(ctx, "ticker_px_per_sec", 40),
	}
	writeJSON(w, 200, res)
}

func handleSitrep(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var msg string
	db.Pool.QueryRow(ctx, `SELECT message FROM sitrep_events ORDER BY created_at DESC LIMIT 1`).Scan(&msg)
	if msg == "" {
		msg = settings.GetOr(ctx, "hub_default_sitrep", "Arena standing by. Connect your attack VM to engage.")
	}
	writeJSON(w, 200, map[string]string{"message": msg})
}

// noiseMessages are infra events that should not appear in the public ticker.
var noiseMessages = map[string]bool{
	"KOTH tokens rotated - thrones wiped": true,
	"KOTH token rotated - throne wiped":   true,
}

func handleTicker(w http.ResponseWriter, r *http.Request) {
	rows, _ := db.Pool.Query(r.Context(), `SELECT message, created_at FROM ticker_events ORDER BY created_at DESC LIMIT 100`)
	defer rows.Close()
	events := []map[string]any{}
	seen := make(map[string]bool)
	for rows.Next() {
		var msg string
		var at time.Time
		rows.Scan(&msg, &at)
		if noiseMessages[msg] || seen[msg] {
			continue
		}
		seen[msg] = true
		events = append(events, map[string]any{"message": msg, "at": at})
		if len(events) == 20 {
			break
		}
	}
	writeJSON(w, 200, map[string]any{"events": events})
}

func handleGetPlayer(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	ctx := r.Context()
	var id uuid.UUID
	var bio, title, avatar, css, theme, cbg, ccard, cacc, ctxt, cdim *string
	var extRaw []byte
	var loginStreak, loginStreakMax int
	var isAdmin bool
	err := db.Pool.QueryRow(ctx, `
		SELECT id, bio, title, avatar_url, custom_css, theme_preset,
			color_bg, color_card, color_accent, color_text, color_text_dim,
			COALESCE(profile_ext, '{}')::text,
			COALESCE(login_streak, 0), COALESCE(login_streak_max, 0),
			COALESCE(is_admin, false)
		FROM players WHERE handle=$1 AND NOT banned
	`, handle).Scan(&id, &bio, &title, &avatar, &css, &theme, &cbg, &ccard, &cacc, &ctxt, &cdim, &extRaw, &loginStreak, &loginStreakMax, &isAdmin)
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	var pts, kills, deaths int
	db.Pool.QueryRow(ctx, `SELECT COALESCE(points,0), COALESCE(kills,0), COALESCE(deaths,0) FROM scores WHERE player_id=$1`, id).Scan(&pts, &kills, &deaths)

	// Bug fix: only rank players who actually have a non-zero score so that
	// an empty leaderboard doesn't make every fresh signup show as "#1".
	var rank int
	db.Pool.QueryRow(ctx, `
		SELECT rk FROM (
			SELECT player_id, RANK() OVER (ORDER BY points DESC) AS rk
			FROM scores
			WHERE points > 0 OR kills > 0
		) x WHERE player_id = $1
	`, id).Scan(&rank)

	var targetKills, kothCrowns int
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM kills WHERE attacker_id=$1 AND kind='target'`, id).Scan(&targetKills)
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM koth_holds WHERE player_id=$1`, id).Scan(&kothCrowns)

	// First bloods: count machine+flag-kind combos where this player landed the
	// earliest capture (powers the FIRST BLOOD badge).
	var firstBloods int
	db.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM (
			SELECT DISTINCT ON (koth_id, kind) attacker_id
			FROM kills WHERE koth_id IS NOT NULL
			ORDER BY koth_id, kind, submitted_at ASC
		) f WHERE attacker_id=$1
	`, id).Scan(&firstBloods)

	var recent []map[string]any
	rows, _ := db.Pool.Query(ctx, `
		SELECT kind, points, submitted_at FROM kills WHERE attacker_id=$1
		ORDER BY submitted_at DESC LIMIT 12
	`, id)
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var kind string
			var points int
			var at time.Time
			rows.Scan(&kind, &points, &at)
			recent = append(recent, map[string]any{"kind": kind, "points": points, "submitted_at": at})
		}
	}

	// Merge profile_ext JSONB into response
	var ext map[string]any
	if len(extRaw) > 0 {
		json.Unmarshal(extRaw, &ext)
	}
	if ext == nil {
		ext = map[string]any{}
	}

	out := map[string]any{
		"handle": handle, "bio": bio, "title": title, "avatar_url": avatar,
		"custom_css": css, "theme_preset": theme,
		"color_bg": cbg, "color_card": ccard, "color_accent": cacc, "color_text": ctxt, "color_text_dim": cdim,
		"points": pts, "kills": kills, "deaths": deaths, "rank": rank,
		"target_kills": targetKills, "koth_crowns": kothCrowns, "first_bloods": firstBloods,
		"recent_kills": recent,
		"login_streak": loginStreak, "login_streak_max": loginStreakMax,
		// is_admin intentionally not exposed publicly - prevents account enumeration
	}
	_ = isAdmin // keep var to avoid unused-var; reserved for owner-scoped responses
	for k, v := range ext {
		out[k] = v
	}
	writeJSON(w, 200, out)
}

func handlePutPlayer(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	token := sessionTokenFromRequest(r)
	if token == "" {
		writeError(w, 401, "X-Player-Token header required")
		return
	}
	pid, _ := sessionLookup(r.Context(), token)
	if pid == "" {
		writeError(w, 403, "invalid or expired session: please log in again")
		return
	}
	var ownsHandle bool
	db.Pool.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM players WHERE id=$1::uuid AND handle=$2)`, pid, handle,
	).Scan(&ownsHandle)
	if !ownsHandle {
		writeError(w, 403, "token does not match this handle")
		return
	}
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	str := func(k string) string {
		v, _ := body[k].(string)
		return v
	}
	css := sanitizeCSS(str("custom_css"))
	avatarURL := str("avatar_url")
	if avatarURL != "" && !strings.HasPrefix(avatarURL, "https://") && !strings.HasPrefix(avatarURL, "http://") {
		writeError(w, 400, "avatar_url must be a http(s) URL or empty")
		return
	}
	bio := str("bio")
	if len(bio) > 2000 {
		bio = bio[:2000]
	}
	title := str("title")
	if len(title) > 120 {
		title = title[:120]
	}

	// Extended profile fields go into profile_ext JSONB
	urlKeys := map[string]bool{
		"background_url": true, "social_github": true,
		"social_twitter": true, "social_website": true, "music_url": true,
	}
	extKeys := []string{
		"status", "location", "background_url", "background_tile",
		"social_github", "social_twitter", "social_website",
		"featured_skills", "music_url", "music_label", "youtube_url", "layout_col",
		"badges_hidden",
	}
	shortTextKeys := map[string]int{
		"status": 120, "location": 80, "featured_skills": 300, "music_label": 100, "layout_col": 20,
		"youtube_url": 100, "badges_hidden": 400,
	}
	ext := map[string]any{}
	for _, k := range extKeys {
		v, ok := body[k]
		if !ok {
			continue
		}
		if urlKeys[k] {
			s, _ := v.(string)
			if s != "" && !strings.HasPrefix(s, "https://") && !strings.HasPrefix(s, "http://") {
				writeError(w, 400, k+" must be a http(s) URL or empty")
				return
			}
		}
		if k == "youtube_url" {
			s, _ := v.(string)
			if s != "" && !validYouTubeURL(s) {
				writeError(w, 400, "youtube_url must be a youtube.com or youtu.be URL")
				return
			}
		}
		if maxLen, limited := shortTextKeys[k]; limited {
			if s, ok := v.(string); ok && len(s) > maxLen {
				v = s[:maxLen]
			}
		}
		ext[k] = v
	}
	extJSON, _ := json.Marshal(ext)

	themePreset := str("theme_preset")
	if !validThemePresets[themePreset] {
		themePreset = "neon_ghost"
	}

	_, err := db.Pool.Exec(r.Context(), `
		UPDATE players SET bio=$1, title=$2, avatar_url=$3, custom_css=$4, theme_preset=$5,
			color_bg=$6, color_card=$7, color_accent=$8, color_text=$9, color_text_dim=$10,
			profile_ext=$11
		WHERE handle=$12
	`, bio, title, avatarURL, css, themePreset,
		sanitizeColor(str("color_bg")), sanitizeColor(str("color_card")),
		sanitizeColor(str("color_accent")), sanitizeColor(str("color_text")),
		sanitizeColor(str("color_text_dim")),
		string(extJSON), handle)
	if err != nil {
		log.Printf("put player error: %v", err)
		writeError(w, 500, "profile update failed")
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

var badCSS = regexp.MustCompile(`(?i)(` +
	`position\s*:\s*(fixed|absolute|sticky)` +
	`|@import` +
	`|javascript:` +
	`|expression\s*\(` +
	`|url\s*\(` + // block ALL url() - prevents background-image/border-image/mask/cursor exfil
	`|-moz-binding` +
	`|behavior\s*:` +
	`)`)

var youtubeHosts = map[string]bool{
	"youtube.com": true, "www.youtube.com": true,
	"m.youtube.com": true, "youtu.be": true,
}

func validYouTubeURL(s string) bool {
	u, err := url.Parse(s)
	if err != nil {
		return false
	}
	return youtubeHosts[u.Hostname()]
}

var validHandle = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{1,31}$`)

// Common weak passwords - rejected outright.
var commonPasswords = map[string]bool{
	"password1234": true, "qwerty123456": true, "letmein12345": true,
	"changeme1234": true, "admin1234567": true, "welcome12345": true,
	"123456789012": true, "qwertyuiop12": true, "iloveyou1234": true,
	"password!234": true, "monkey1234567": true, "dragon1234567": true,
	"sunshine1234": true, "princess1234": true, "football1234": true,
}

// validatePassword enforces:
//   - 12-256 chars
//   - at least 3 of 4 classes: lowercase, uppercase, digit, symbol
//   - not in the common-password blocklist
//   - not contain "cyberkiller" / "password" substring
//
// Returns "" if OK, or a user-facing error message.
func validatePassword(p string) string {
	if len(p) < 12 {
		return "password must be at least 12 characters"
	}
	if len(p) > 256 {
		return "password too long (max 256 chars)"
	}
	lower, upper, digit, sym := false, false, false, false
	for _, r := range p {
		switch {
		case r >= 'a' && r <= 'z':
			lower = true
		case r >= 'A' && r <= 'Z':
			upper = true
		case r >= '0' && r <= '9':
			digit = true
		case r >= 33 && r <= 126: // printable ASCII punct
			sym = true
		}
	}
	classes := 0
	for _, b := range []bool{lower, upper, digit, sym} {
		if b {
			classes++
		}
	}
	if classes < 3 {
		return "password must include at least 3 of: lowercase, uppercase, digit, symbol"
	}
	pl := strings.ToLower(p)
	if commonPasswords[pl] {
		return "password is too common, pick something less guessable"
	}
	if strings.Contains(pl, "cyberkiller") || strings.Contains(pl, "password") {
		return "password cannot contain 'password' or the site name"
	}
	return ""
}

var validColor = regexp.MustCompile(`^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?$`)
var closeStyleTag = regexp.MustCompile(`(?i)</\s*style`)

// cssComments matches CSS block comments; stripped before the deny-list so an
// attacker can't split a banned keyword across a comment (e.g. posi/**/tion).
var cssComments = regexp.MustCompile(`/\*[\s\S]*?\*/`)

var validThemePresets = map[string]bool{
	"neon_ghost": true, "shadow_op": true, "berserker": true, "void": true,
	"synthwave": true, "terminal": true, "amber_alert": true, "bloodmoon": true,
	"arctic": true, "operator": true,
	"vaporwave": true, "kingpin": true, "toxic": true, "deepsea": true,
	"ember": true, "phantom": true, "overclock": true,
}

const maxCSSBytes = 12 * 1024 // 12 KB

func sanitizeCSS(css string) string {
	if len(css) > maxCSSBytes {
		css = css[:maxCSSBytes]
	}
	// Neutralize keyword-splitting bypasses BEFORE the deny-list runs: CSS comments
	// (posi/**/tion:fixed) and backslash escapes (\75 rl, \5c) can hide banned
	// tokens from the regex. Strip comments and all backslashes first so the
	// deny-list sees the real keywords. Backslash escapes are not needed in a
	// profile style block, so dropping them is a safe tradeoff for the security gain.
	css = cssComments.ReplaceAllString(css, "")
	css = strings.ReplaceAll(css, "\\", "")
	css = badCSS.ReplaceAllString(css, "")
	// Strip </style only - that's the only tag that can break out of the style element context.
	css = closeStyleTag.ReplaceAllString(css, "")
	return css
}

func sanitizeColor(c string) string {
	if c == "" || validColor.MatchString(c) {
		return c
	}
	return ""
}

var validTiers = map[string]bool{"easy": true, "medium": true, "hard": true, "insane": true}

func handleImageSubmit(w http.ResponseWriter, r *http.Request) {
	// Require a valid web session to prevent anonymous spam of the admin queue.
	token := sessionTokenFromRequest(r)
	if token == "" {
		writeError(w, 401, "login required to submit an image")
		return
	}
	pid, _ := sessionLookup(r.Context(), token)
	if pid == "" {
		writeError(w, 401, "invalid or expired session: please log in again")
		return
	}
	if !rateLimit("imgsub:"+pid, 3, time.Hour) {
		writeError(w, 429, "submission limit reached: try again later")
		return
	}
	var req images.SubmitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "invalid request")
		return
	}
	req.DockerImage = strings.TrimSpace(req.DockerImage)
	req.MachineName = strings.TrimSpace(req.MachineName)
	switch {
	case req.DockerImage == "" || len(req.DockerImage) > 200:
		writeError(w, 400, "docker_image required (max 200 chars)")
		return
	case req.MachineName == "" || len(req.MachineName) > 100:
		writeError(w, 400, "machine_name required (max 100 chars)")
		return
	case !validTiers[req.Tier]:
		writeError(w, 400, "tier must be easy, medium, hard, or insane")
		return
	case req.PlayerID != "" && uuid.Validate(req.PlayerID) != nil:
		writeError(w, 400, "invalid player_id")
		return
	}
	if len(req.Description) > 2000 {
		req.Description = req.Description[:2000]
	}
	if err := images.Submit(r.Context(), req); err != nil {
		log.Printf("image submit error: %v", err)
		writeError(w, 500, "submission failed")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "pending"})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := db.Pool.Ping(r.Context()); err != nil {
		writeError(w, 503, "db down")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func handleGetPlayerByToken(w http.ResponseWriter, r *http.Request) {
	if !rateLimit("token:"+clientIP(r), 10, time.Minute) {
		writeError(w, 429, "too many requests")
		return
	}
	token := chi.URLParam(r, "token")
	// Helpful error if the user pasted a session token (SES-) instead of an invite token (INV-)
	if strings.HasPrefix(token, "SES-") {
		writeError(w, 400, "that looks like a session token (web login): the agent needs your INVITE token (starts with INV-). Find it in the hub: footer → Profile → Settings, or in the signup confirmation email.")
		return
	}
	var handle string
	err := db.Pool.QueryRow(r.Context(), `SELECT handle FROM players WHERE invite_token=$1 AND NOT banned`, token).Scan(&handle)
	if err != nil || handle == "" {
		writeError(w, 404, "token not found")
		return
	}
	writeJSON(w, 200, map[string]string{"handle": handle})
}

func adminAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		// Pre-check: if this IP has already racked up too many FAILED attempts,
		// stop before doing more work. We only count failures (below), not
		// successful auths - the admin panel legitimately polls ~50 requests/min,
		// so rate-limiting every request would break the panel. Brute force is
		// repeated failures, which is what this guards.
		if rateLimitExceeded("admin-auth-fail:" + ip) {
			writeError(w, 429, "too many failed admin auth attempts: wait a minute")
			return
		}
		user, pass, ok := r.BasicAuth()
		if !ok {
			user = r.Header.Get("X-Admin-User")
			pass = r.Header.Get("X-Admin-Pass")
		}
		// Master credentials from env
		if subtle.ConstantTimeCompare([]byte(user), []byte(adminUser)) == 1 &&
			subtle.ConstantTimeCompare([]byte(pass), []byte(adminPass)) == 1 {
			next.ServeHTTP(w, r)
			return
		}
		// Player admin credentials (handle + password, is_admin=true)
		if user != "" && pass != "" && checkPlayerAdmin(r.Context(), user, pass) {
			next.ServeHTTP(w, r)
			return
		}
		// Failed - count it toward the brute-force limit (10 failures/min/IP).
		rateLimit("admin-auth-fail:"+ip, 10, time.Minute)
		writeError(w, 401, "unauthorized")
	})
}

func checkPlayerAdmin(ctx context.Context, handle, password string) bool {
	var pwHash string
	err := db.Pool.QueryRow(ctx,
		`SELECT COALESCE(password_hash,'') FROM players WHERE handle=$1 AND is_admin=true AND NOT banned`,
		handle,
	).Scan(&pwHash)
	if err != nil || pwHash == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(pwHash), []byte(password)) == nil
}

func handleAdminSubmissions(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Pool.Query(r.Context(), `
		SELECT s.id, p.handle, s.docker_image, s.machine_name, s.tier, s.status,
			COALESCE(s.description,''), COALESCE(s.admin_note,''), s.submitted_at
		FROM image_submissions s JOIN players p ON p.id = s.player_id
		ORDER BY s.submitted_at DESC LIMIT 50
	`)
	list := []map[string]any{}
	if err != nil {
		writeJSON(w, 200, list)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var handle, img, name, tier, status, desc, note string
		var at time.Time
		rows.Scan(&id, &handle, &img, &name, &tier, &status, &desc, &note, &at)
		list = append(list, map[string]any{
			"id": id, "handle": handle, "docker_image": img, "machine_name": name,
			"tier": tier, "status": status, "description": desc, "admin_note": note,
			"submitted_at": at.Format(time.RFC3339),
		})
	}
	writeJSON(w, 200, list)
}

func handleAdminApprove(w http.ResponseWriter, r *http.Request) {
	id, _ := uuid.Parse(chi.URLParam(r, "id"))
	var body struct {
		Note string `json:"note"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	if body.Note == "" {
		body.Note = "approved"
	}
	images.Approve(r.Context(), id, body.Note)
	adm.AuditLog(r.Context(), "submission_approve", id.String())
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func handleAdminReject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Note string `json:"note"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	db.Pool.Exec(r.Context(), `UPDATE image_submissions SET status='rejected', admin_note=$2, reviewed_at=NOW() WHERE id=$1`, id, body.Note)
	adm.AuditLog(r.Context(), "submission_reject", id)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func handleGetContent(w http.ResponseWriter, r *http.Request) {
	rows, _ := db.Pool.Query(r.Context(), `SELECT id, value FROM page_content`)
	out := map[string]string{}
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var id, val string
			rows.Scan(&id, &val)
			out[id] = val
		}
	}
	writeJSON(w, 200, out)
}

func handlePutContent(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "invalid json")
		return
	}
	keys := []string{}
	for k, v := range body {
		db.Pool.Exec(r.Context(), `
			INSERT INTO page_content (id, value) VALUES ($1, $2)
			ON CONFLICT (id) DO UPDATE SET value=$2, updated_at=NOW()
		`, k, v)
		keys = append(keys, k)
	}
	adm.AuditLog(r.Context(), "content_update", strings.Join(keys, ","))
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func handleGetTheme(w http.ResponseWriter, r *http.Request) {
	rows, _ := db.Pool.Query(r.Context(), `SELECT key, value FROM site_theme`)
	out := map[string]string{}
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var k, v string
			rows.Scan(&k, &v)
			out[k] = v
		}
	}
	writeJSON(w, 200, out)
}

func handlePutTheme(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "invalid json")
		return
	}
	keys := []string{}
	for k, v := range body {
		db.Pool.Exec(r.Context(), `
			INSERT INTO site_theme (key, value) VALUES ($1, $2)
			ON CONFLICT (key) DO UPDATE SET value=$2
		`, k, v)
		keys = append(keys, k)
	}
	adm.AuditLog(r.Context(), "theme_update", strings.Join(keys, ","))
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func handleUpload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeError(w, 400, "file too large (max 8MB)")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, 400, "no file in request")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, 500, "read error")
		return
	}
	// Detect MIME from magic bytes, not from the request header
	ct := http.DetectContentType(data)
	if _, ok := allowedMIME[ct]; !ok {
		writeError(w, 400, "unsupported file type: jpeg, png, gif, webp only")
		return
	}
	dataURL := fmt.Sprintf("data:%s;base64,%s", ct, base64.StdEncoding.EncodeToString(data))
	b := make([]byte, 6)
	rand.Read(b)
	key := fmt.Sprintf("upload:%x", b)
	db.Pool.Exec(r.Context(), `
		INSERT INTO page_content (id, value) VALUES ($1, $2)
		ON CONFLICT (id) DO UPDATE SET value=$2, updated_at=NOW()
	`, key, dataURL)
	writeJSON(w, 200, map[string]string{"url": dataURL})
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Handle   string `json:"handle"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "invalid request")
		return
	}
	if req.Handle == "" || req.Password == "" {
		writeError(w, 400, "handle and password required")
		return
	}
	ctx := r.Context()
	var playerID uuid.UUID
	var handle string
	var pwHash *string
	err := db.Pool.QueryRow(ctx, `
		SELECT id, handle, password_hash FROM players WHERE handle=$1 AND NOT banned
	`, req.Handle).Scan(&playerID, &handle, &pwHash)
	// Unified error for all failure modes - handle unknown, handle exists with
	// no password, handle exists with wrong password - so an attacker can't
	// enumerate which handles are registered or which need agent-bootstrap.
	const genericAuthErr = "invalid handle or password"
	if err != nil {
		writeError(w, 401, genericAuthErr)
		return
	}
	if pwHash == nil {
		writeError(w, 401, genericAuthErr)
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(*pwHash), []byte(req.Password)); err != nil {
		writeError(w, 401, genericAuthErr)
		return
	}
	var inviteToken string
	db.Pool.QueryRow(ctx, `SELECT COALESCE(invite_token,'') FROM players WHERE id=$1`, playerID).Scan(&inviteToken)

	// Rotate session token - invalidates any existing browser session
	sessBuf := make([]byte, 24)
	rand.Read(sessBuf)
	sessionToken := "SES-" + hex.EncodeToString(sessBuf)
	db.Pool.Exec(ctx, `UPDATE players SET session_token=$1, session_token_expires_at=NOW()+INTERVAL '24 hours', session_started_at=NOW() WHERE id=$2`, sessionToken, playerID)

	// Update login streak - use server local date so "game day" aligns with the
	// server's wall clock, not UTC (avoids late-evening streak jumps for EDT players).
	today := time.Now().Format("2006-01-02")
	var streak int
	db.Pool.QueryRow(ctx, `
		UPDATE players SET
			login_streak = CASE
				WHEN last_login_date = $2::date THEN login_streak
				WHEN last_login_date = $2::date - INTERVAL '1 day' THEN login_streak + 1
				ELSE 1
			END,
			login_streak_max = GREATEST(login_streak_max,
				CASE
					WHEN last_login_date = $2::date THEN login_streak
					WHEN last_login_date = $2::date - INTERVAL '1 day' THEN login_streak + 1
					ELSE 1
				END
			),
			last_login_date = $2::date
		WHERE id = $1
		RETURNING login_streak
	`, playerID, today).Scan(&streak)

	setSessionCookie(w, sessionToken)
	writeJSON(w, 200, map[string]any{
		"player_id":     playerID.String(),
		"handle":        handle,
		"invite_token":  inviteToken,
		"session_token": sessionToken, // returned for CLI clients; browser uses cookie
		"login_streak":  streak,
	})
}

func handleChangePassword(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	// Per-handle limit (lowercased) layered on top of the per-IP withRateLimit
	// wrapper at the route. Stops multi-IP brute force against a single account.
	if !rateLimit("pwchange-h:"+strings.ToLower(handle), 5, time.Hour) {
		writeError(w, 429, "too many password change attempts for this account")
		return
	}
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
		InviteToken     string `json:"invite_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "invalid request")
		return
	}
	if msg := validatePassword(req.NewPassword); msg != "" {
		writeError(w, 400, msg)
		return
	}
	ctx := r.Context()
	var playerID uuid.UUID
	var pwHash *string
	var storedToken string
	err := db.Pool.QueryRow(ctx,
		`SELECT id, password_hash, COALESCE(invite_token,'') FROM players WHERE handle=$1 AND NOT banned`,
		handle,
	).Scan(&playerID, &pwHash, &storedToken)
	if err != nil {
		writeError(w, 404, "player not found")
		return
	}
	// Authentication:
	//   - If the player has a password set, current_password is REQUIRED.
	//     (The invite_token must NOT be a reusable password-reset secret -
	//     anyone who briefly held the token would otherwise keep account access forever.)
	//   - Invite-token-as-proof is only allowed when no password is set yet
	//     (initial-setup flow for an agent-only account).
	if pwHash != nil {
		if req.CurrentPassword == "" {
			writeError(w, 401, "current password required")
			return
		}
		if err := bcrypt.CompareHashAndPassword([]byte(*pwHash), []byte(req.CurrentPassword)); err != nil {
			writeError(w, 401, "current password incorrect")
			return
		}
	} else {
		// No password set yet - invite_token bootstraps the first password.
		if req.InviteToken == "" || storedToken == "" || req.InviteToken != storedToken {
			writeError(w, 401, "invite token required to set initial password")
			return
		}
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, 500, "password hashing failed")
		return
	}
	// Revoke ALL existing sessions and rotate the invite token. The caller will
	// need to log in again; any other devices that had a session are kicked.
	newSessBuf := make([]byte, 24)
	rand.Read(newSessBuf)
	newSession := "SES-" + hex.EncodeToString(newSessBuf)
	newInvBuf := make([]byte, 16)
	rand.Read(newInvBuf)
	newInvite := "INV-" + hex.EncodeToString(newInvBuf)
	db.Pool.Exec(ctx, `
		UPDATE players SET password_hash=$1,
			session_token=$2, session_token_expires_at=NOW()+INTERVAL '24 hours', session_started_at=NOW(),
			invite_token=$3, invite_token_expires_at=NOW()+INTERVAL '1 year'
		WHERE id=$4
	`, string(newHash), newSession, newInvite, playerID)
	setSessionCookie(w, newSession)
	writeJSON(w, 200, map[string]any{
		"ok":            true,
		"session_token": newSession,
		"invite_token":  newInvite,
		"message":       "password changed, all other sessions and the previous invite token are now invalid",
	})
}

func handleDeletePlayer(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	var req struct {
		Password    string `json:"password"`
		InviteToken string `json:"invite_token"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	ctx := r.Context()
	var pwHash *string
	var storedToken string
	err := db.Pool.QueryRow(ctx,
		`SELECT password_hash, COALESCE(invite_token,'') FROM players WHERE handle=$1 AND NOT banned`,
		handle,
	).Scan(&pwHash, &storedToken)
	if err != nil {
		writeError(w, 404, "player not found")
		return
	}
	if pwHash != nil {
		// Account has a password - require it
		if req.Password == "" {
			writeError(w, 401, "password required to delete account")
			return
		}
		if err := bcrypt.CompareHashAndPassword([]byte(*pwHash), []byte(req.Password)); err != nil {
			writeError(w, 401, "incorrect password")
			return
		}
	} else {
		// No password set - require invite token as proof of ownership
		if req.InviteToken == "" || storedToken == "" || req.InviteToken != storedToken {
			writeError(w, 401, "invite token required to delete account")
			return
		}
	}
	db.Pool.Exec(ctx, `DELETE FROM scores WHERE player_id=(SELECT id FROM players WHERE handle=$1)`, handle)
	db.Pool.Exec(ctx, `DELETE FROM players WHERE handle=$1`, handle)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func postAuth(r *http.Request, handle string) bool {
	token := sessionTokenFromRequest(r)
	if token == "" {
		return false
	}
	pid, _ := sessionLookup(r.Context(), token)
	if pid == "" {
		return false
	}
	var ownsHandle bool
	db.Pool.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM players WHERE id=$1::uuid AND handle=$2)`, pid, handle,
	).Scan(&ownsHandle)
	return ownsHandle
}

func handleGetPosts(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	// If the owner is authenticated, return all posts (including drafts with full body)
	isOwner := postAuth(r, handle)
	var rows pgx.Rows
	var err error
	if isOwner {
		rows, err = db.Pool.Query(r.Context(), `
			SELECT pp.id, pp.title, pp.body, pp.published, pp.created_at, pp.updated_at
			FROM player_posts pp
			JOIN players p ON p.id = pp.player_id
			WHERE p.handle=$1
			ORDER BY pp.created_at DESC
			LIMIT 100
		`, handle)
	} else {
		rows, err = db.Pool.Query(r.Context(), `
			SELECT pp.id, pp.title, LEFT(pp.body, 300), pp.published, pp.created_at, pp.updated_at
			FROM player_posts pp
			JOIN players p ON p.id = pp.player_id
			WHERE p.handle=$1 AND pp.published=true
			ORDER BY pp.created_at DESC
			LIMIT 50
		`, handle)
	}
	if err != nil {
		writeError(w, 500, "failed to load posts")
		return
	}
	defer rows.Close()
	var posts []map[string]any
	for rows.Next() {
		var id, title, body string
		var published bool
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &title, &body, &published, &createdAt, &updatedAt); err != nil {
			continue
		}
		entry := map[string]any{
			"id": id, "title": title, "published": published,
			"created_at": createdAt, "updated_at": updatedAt,
		}
		if isOwner {
			entry["body"] = body
		} else {
			entry["excerpt"] = body
		}
		posts = append(posts, entry)
	}
	if posts == nil {
		posts = []map[string]any{}
	}
	writeJSON(w, 200, posts)
}

func handleGetPost(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	postID := chi.URLParam(r, "postID")
	var id, title, body string
	var createdAt, updatedAt time.Time
	err := db.Pool.QueryRow(r.Context(), `
		SELECT pp.id, pp.title, pp.body, pp.created_at, pp.updated_at
		FROM player_posts pp
		JOIN players p ON p.id = pp.player_id
		WHERE p.handle=$1 AND pp.id=$2 AND pp.published=true
	`, handle, postID).Scan(&id, &title, &body, &createdAt, &updatedAt)
	if err != nil {
		writeError(w, 404, "post not found")
		return
	}
	writeJSON(w, 200, map[string]any{
		"id": id, "title": title, "body": body,
		"created_at": createdAt, "updated_at": updatedAt,
		"handle": handle,
	})
}

func handleCreatePost(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	if !postAuth(r, handle) {
		writeError(w, 403, "forbidden")
		return
	}
	// 10 posts/hour per author is plenty for legitimate use; stops bot
	// accounts from bloating the DB with 20K-char bodies × hundreds of posts.
	if !rateLimit("post-create:"+strings.ToLower(handle), 10, time.Hour) {
		writeError(w, 429, "post limit reached: try again later")
		return
	}
	var req struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	req.Title = strings.TrimSpace(req.Title)
	req.Body = strings.TrimSpace(req.Body)
	if len(req.Title) == 0 || len(req.Title) > 200 {
		writeError(w, 400, "title required (max 200 chars)")
		return
	}
	if len(req.Body) == 0 || len(req.Body) > 20000 {
		writeError(w, 400, "body required (max 20,000 chars)")
		return
	}
	var postID string
	err := db.Pool.QueryRow(r.Context(), `
		INSERT INTO player_posts (player_id, title, body)
		SELECT id, $2, $3 FROM players WHERE handle=$1
		RETURNING id
	`, handle, req.Title, req.Body).Scan(&postID)
	if err != nil {
		writeError(w, 500, "failed to create post")
		return
	}
	writeJSON(w, 200, map[string]string{"id": postID})
}

func handleUpdatePost(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	postID := chi.URLParam(r, "postID")
	if !postAuth(r, handle) {
		writeError(w, 403, "forbidden")
		return
	}
	var req struct {
		Title     string `json:"title"`
		Body      string `json:"body"`
		Published *bool  `json:"published"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	req.Title = strings.TrimSpace(req.Title)
	req.Body = strings.TrimSpace(req.Body)
	if len(req.Title) == 0 || len(req.Title) > 200 {
		writeError(w, 400, "title required (max 200 chars)")
		return
	}
	if len(req.Body) == 0 || len(req.Body) > 20000 {
		writeError(w, 400, "body required (max 20,000 chars)")
		return
	}
	published := true
	if req.Published != nil {
		published = *req.Published
	}
	tag, err := db.Pool.Exec(r.Context(), `
		UPDATE player_posts SET title=$3, body=$4, published=$5, updated_at=NOW()
		WHERE id=$2 AND player_id=(SELECT id FROM players WHERE handle=$1)
	`, handle, postID, req.Title, req.Body, published)
	if err != nil || tag.RowsAffected() == 0 {
		writeError(w, 404, "post not found")
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func handleDeletePost(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	postID := chi.URLParam(r, "postID")
	if !postAuth(r, handle) {
		writeError(w, 403, "forbidden")
		return
	}
	tag, err := db.Pool.Exec(r.Context(), `
		DELETE FROM player_posts
		WHERE id=$2 AND player_id=(SELECT id FROM players WHERE handle=$1)
	`, handle, postID)
	if err != nil || tag.RowsAffected() == 0 {
		writeError(w, 404, "post not found")
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

// Discord-bot-friendly API handlers

func handleAPILeaderboard(w http.ResponseWriter, r *http.Request) {
	rows, _ := db.Pool.Query(r.Context(), `
		SELECT p.handle, s.points, s.kills, RANK() OVER (ORDER BY s.points DESC)
		FROM scores s JOIN players p ON p.id = s.player_id
		ORDER BY s.points DESC LIMIT 25
	`)
	var board []map[string]any
	if rows != nil {
		defer rows.Close()
		rank := 1
		for rows.Next() {
			var handle string
			var pts, kills, rk int
			rows.Scan(&handle, &pts, &kills, &rk)
			board = append(board, map[string]any{"rank": rank, "handle": handle, "points": pts, "kills": kills})
			rank++
		}
	}
	if board == nil {
		board = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{"leaderboard": board, "updated_at": time.Now().Format(time.RFC3339)})
}

func handleAPIKills(w http.ResponseWriter, r *http.Request) {
	rows, _ := db.Pool.Query(r.Context(), `
		SELECT k.kind, k.points, p.handle, k.submitted_at,
			COALESCE(host(t.arena_ip), host(km.arena_ip), '') AS arena_ip
		FROM kills k
		JOIN players p ON p.id = k.attacker_id
		LEFT JOIN targets t ON t.id = k.target_id
		LEFT JOIN koth_machines km ON km.id = k.koth_id
		ORDER BY k.submitted_at DESC LIMIT 50
	`)
	var kills []map[string]any
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var kind, handle, ip string
			var pts int
			var at time.Time
			rows.Scan(&kind, &pts, &handle, &at, &ip)
			kills = append(kills, map[string]any{
				"kind": kind, "points": pts, "handle": handle, "arena_ip": ip,
				"submitted_at": at.Format(time.RFC3339),
				"ago":          time.Since(at).Round(time.Second).String(),
			})
		}
	}
	if kills == nil {
		kills = []map[string]any{}
	}
	writeJSON(w, 200, map[string]any{"kills": kills, "updated_at": time.Now().Format(time.RFC3339)})
}

func handleAPIStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var online, activeTargets, kills int
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM players WHERE connected = true`).Scan(&online)
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM koth_machines WHERE status = 'active'`).Scan(&activeTargets)
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM kills WHERE submitted_at > NOW() - INTERVAL '24 hours'`).Scan(&kills)
	writeJSON(w, 200, map[string]any{
		"online_players": online, "active_targets": activeTargets, "kills_24h": kills,
		"updated_at": time.Now().Format(time.RFC3339),
	})
}

func handleSubmitFeedback(w http.ResponseWriter, r *http.Request) {
	if !rateLimit("feedback:"+clientIP(r), 5, 10*time.Minute) {
		writeError(w, 429, "too many feedback submissions")
		return
	}
	token := sessionTokenFromRequest(r)
	if token == "" {
		writeError(w, 401, "X-Player-Token required")
		return
	}
	var req struct {
		ArenaIP   string `json:"arena_ip"`
		ImageName string `json:"image_name"`
		Stars     int    `json:"stars"`
		Body      string `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Stars < 1 || req.Stars > 5 || req.ArenaIP == "" || req.ImageName == "" {
		writeError(w, 400, "invalid request")
		return
	}
	// Resolve the handle from the session token - not from user-supplied input
	playerID, handle := sessionLookup(r.Context(), token)
	if playerID == "" {
		writeError(w, 401, "invalid or expired session: please log in again")
		return
	}
	// Validate that the machine IP actually exists to prevent feedback spam on phantom IPs.
	var exists bool
	db.Pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM koth_machines WHERE host(arena_ip)=$1 AND status='active')`, req.ArenaIP).Scan(&exists)
	if !exists {
		writeError(w, 400, "machine not found")
		return
	}
	_, err := db.Pool.Exec(r.Context(), `
		INSERT INTO machine_feedback (player_id, handle, arena_ip, image_name, stars, body)
		VALUES ($1::uuid, $2, $3::inet, $4, $5, $6)
	`, playerID, handle, req.ArenaIP, req.ImageName, req.Stars, req.Body)
	if err != nil {
		if strings.Contains(err.Error(), "invalid input syntax for type inet") {
			writeError(w, 400, "invalid arena_ip")
			return
		}
		writeError(w, 500, "failed to save feedback")
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func handleGetReports(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Pool.Query(r.Context(), `
		SELECT id, COALESCE(handle,'anonymous'), category, body, created_at
		FROM bug_reports ORDER BY created_at DESC LIMIT 100
	`)
	if err != nil {
		writeError(w, 500, "query error")
		return
	}
	defer rows.Close()
	type report struct {
		ID        int64  `json:"id"`
		Handle    string `json:"handle"`
		Category  string `json:"category"`
		Body      string `json:"body"`
		CreatedAt string `json:"created_at"`
	}
	var out []report
	for rows.Next() {
		var rp report
		var ts time.Time
		rows.Scan(&rp.ID, &rp.Handle, &rp.Category, &rp.Body, &ts)
		rp.CreatedAt = ts.Format(time.RFC3339)
		out = append(out, rp)
	}
	if out == nil {
		out = []report{}
	}
	writeJSON(w, 200, map[string]any{"reports": out})
}

func handleDeleteReport(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	_, err := db.Pool.Exec(r.Context(), `DELETE FROM bug_reports WHERE id=$1`, id)
	if err != nil {
		writeError(w, 500, "delete failed")
		return
	}
	adm.AuditLog(r.Context(), "report_delete", id)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func handleSubmitReport(w http.ResponseWriter, r *http.Request) {
	tok := sessionTokenFromRequest(r)
	if tok == "" {
		writeError(w, 401, "login required to submit a report")
		return
	}
	playerID, handle := sessionLookup(r.Context(), tok)
	if playerID == "" {
		writeError(w, 401, "invalid or expired session: please log in again")
		return
	}
	if !rateLimit("report:"+playerID, 3, 10*time.Minute) {
		writeError(w, 429, "too many submissions")
		return
	}
	// Per-IP fallback so a single attacker juggling many accounts can't
	// flood the admin queue 3-at-a-time from each handle.
	if !rateLimit("report-ip:"+clientIP(r), 10, time.Hour) {
		writeError(w, 429, "too many submissions from this network")
		return
	}
	var req struct {
		Category string `json:"category"`
		Body     string `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Body) == "" {
		writeError(w, 400, "body required")
		return
	}
	if req.Category == "" {
		req.Category = "general"
	}
	_, err := db.Pool.Exec(r.Context(), `
		INSERT INTO bug_reports (player_id, handle, category, body)
		VALUES ($1::uuid, $2, $3, $4)
	`, playerID, handle, req.Category, strings.TrimSpace(req.Body))
	if err != nil {
		writeError(w, 500, "failed to save report")
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func handleVoteReset(w http.ResponseWriter, r *http.Request) {
	arenaIP := chi.URLParam(r, "arenaIP")
	ctx := r.Context()

	token := sessionTokenFromRequest(r)
	if token == "" {
		writeError(w, 401, "authentication required")
		return
	}
	pid, _ := sessionLookup(ctx, token)
	if pid == "" {
		writeError(w, 401, "invalid or expired session: please log in again")
		return
	}
	playerID, err := uuid.Parse(pid)
	if err != nil {
		writeError(w, 401, "invalid session")
		return
	}

	// Find the active hill and its type
	var hillID uuid.UUID
	var machineName, machineType string
	if err := db.Pool.QueryRow(ctx, `
		SELECT id, image_name, COALESCE(machine_type,'docker')
		FROM koth_machines WHERE host(arena_ip)=$1 AND status='active'
	`, arenaIP).Scan(&hillID, &machineName, &machineType); err != nil {
		writeError(w, 404, "no active hill at that IP")
		return
	}

	// Record vote (ignore duplicate)
	db.Pool.Exec(ctx, `
		INSERT INTO koth_reset_votes (machine_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
	`, hillID, playerID)

	// Count votes and check threshold
	var votes int
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM koth_reset_votes WHERE machine_id=$1`, hillID).Scan(&votes)
	threshold := koth.VoteResetThreshold(ctx)

	if votes >= threshold {
		switch machineType {
		case "corp":
			go corp.ResetMachine(context.Background(), arenaIP)
		default:
			go func() {
				if err := koth.ResetHill(context.Background(), hillID); err != nil {
					log.Printf("[vote-reset] %v", err)
				}
			}()
		}
		db.Pool.Exec(ctx, `DELETE FROM koth_reset_votes WHERE machine_id=$1`, hillID)
		writeJSON(w, 200, map[string]any{"ok": "true", "reset": true, "votes": votes, "threshold": threshold})
		return
	}

	writeJSON(w, 200, map[string]any{"ok": "true", "reset": false, "votes": votes, "threshold": threshold})
}

func rangeResetThreshold(ctx context.Context) int {
	var online int
	// Count by recent heartbeat, not the `connected` flag - the flag lags/sticks and
	// can undercount active players (caused a 0/2 threshold with 3 genuinely online).
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM players WHERE last_heartbeat > now() - interval '90 seconds' AND NOT banned`).Scan(&online)
	if online > 0 && online < 5 {
		return online
	}
	return 5
}

// ── Known issues (public read) ───────────────────────────────────────────────

func handleListKnownIssues(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Pool.Query(r.Context(), `
		SELECT id, severity, title, body FROM known_issues
		ORDER BY sort_order ASC, id ASC
	`)
	list := []map[string]any{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id int64
			var sev, title, body string
			if rows.Scan(&id, &sev, &title, &body) == nil {
				list = append(list, map[string]any{"id": id, "severity": sev, "title": title, "body": body})
			}
		}
	}
	writeJSON(w, 200, map[string]any{"issues": list})
}

// ── Feature requests ─────────────────────────────────────────────────────────

// handleListFeatures returns all feature requests with vote score, sorted by
// score desc. If the caller has a session, my_vote reflects their vote (-1/0/1).
func handleListFeatures(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	// Optional auth - list is viewable logged-in; my_vote is 0 if no session.
	pid, _ := sessionLookup(ctx, sessionTokenFromRequest(r))

	rows, err := db.Pool.Query(ctx, `
		SELECT f.id, f.handle, f.title, f.body, f.status, f.created_at,
		       COALESCE(SUM(v.vote), 0) AS score,
		       COALESCE(COUNT(v.vote), 0) AS vote_count,
		       COALESCE((SELECT vote FROM feature_votes mv WHERE mv.feature_id=f.id AND mv.player_id=$1::uuid), 0) AS my_vote
		FROM feature_requests f
		LEFT JOIN feature_votes v ON v.feature_id = f.id
		GROUP BY f.id
		ORDER BY score DESC, f.created_at DESC
		LIMIT 200
	`, nullableUUID(pid))
	if err != nil {
		log.Printf("list features: %v", err)
		writeError(w, 500, "failed to load features")
		return
	}
	defer rows.Close()
	list := []map[string]any{}
	for rows.Next() {
		var id, score, voteCount, myVote int64
		var handle, title, body, status string
		var createdAt time.Time
		if err := rows.Scan(&id, &handle, &title, &body, &status, &createdAt, &score, &voteCount, &myVote); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"id": id, "handle": handle, "title": title, "body": body,
			"status": status, "score": score, "vote_count": voteCount,
			"my_vote": myVote, "created_at": createdAt.Format(time.RFC3339),
		})
	}
	writeJSON(w, 200, map[string]any{"features": list})
}

// nullableUUID returns the uuid string or a value that won't match any row,
// so the my_vote subquery is safe when there's no session.
func nullableUUID(pid string) string {
	if pid == "" {
		return "00000000-0000-0000-0000-000000000000"
	}
	return pid
}

func handleCreateFeature(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid, handle := sessionLookup(ctx, sessionTokenFromRequest(r))
	if pid == "" {
		writeError(w, 401, "login required to suggest a feature")
		return
	}
	if !rateLimit("feature-create:"+pid, 5, time.Hour) {
		writeError(w, 429, "you've suggested a lot recently: try again later")
		return
	}
	var req struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "invalid request")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Body = strings.TrimSpace(req.Body)
	if len(req.Title) < 4 || len(req.Title) > 120 {
		writeError(w, 400, "title must be 4–120 characters")
		return
	}
	if len(req.Body) > 2000 {
		writeError(w, 400, "description too long (max 2000 chars)")
		return
	}
	var id int64
	err := db.Pool.QueryRow(ctx, `
		INSERT INTO feature_requests (player_id, handle, title, body)
		VALUES ($1::uuid, $2, $3, $4) RETURNING id
	`, pid, handle, req.Title, req.Body).Scan(&id)
	if err != nil {
		log.Printf("create feature: %v", err)
		writeError(w, 500, "failed to save feature")
		return
	}
	// Auto-upvote your own suggestion.
	db.Pool.Exec(ctx, `INSERT INTO feature_votes (feature_id, player_id, vote) VALUES ($1, $2::uuid, 1)
		ON CONFLICT DO NOTHING`, id, pid)
	writeJSON(w, 200, map[string]any{"id": id})
}

// handleDeleteFeature lets a player remove their OWN feature request, but only
// while it's still "open" - once an admin promotes it onto the roadmap
// (planned / in_progress / done) the community has invested votes and it
// represents committed work, so it can no longer be self-deleted. Admins can
// still remove anything via the admin panel.
func handleDeleteFeature(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid, _ := sessionLookup(ctx, sessionTokenFromRequest(r))
	if pid == "" {
		writeError(w, 401, "login required")
		return
	}
	featureID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, 400, "invalid feature id")
		return
	}
	var ownerID, status string
	err = db.Pool.QueryRow(ctx,
		`SELECT COALESCE(player_id::text,''), status FROM feature_requests WHERE id=$1`, featureID,
	).Scan(&ownerID, &status)
	if err != nil {
		writeError(w, 404, "feature not found")
		return
	}
	if ownerID != pid {
		writeError(w, 403, "you can only delete your own suggestions")
		return
	}
	if status != "open" {
		writeError(w, 409, "this suggestion is on the roadmap ("+status+") and can no longer be deleted: contact an operator")
		return
	}
	// Votes cascade via FK ON DELETE CASCADE.
	db.Pool.Exec(ctx, `DELETE FROM feature_requests WHERE id=$1`, featureID)
	writeJSON(w, 200, map[string]any{"ok": true})
}

// handleVoteFeature sets the caller's vote on a feature: 1, -1, or 0 (clear).
func handleVoteFeature(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid, _ := sessionLookup(ctx, sessionTokenFromRequest(r))
	if pid == "" {
		writeError(w, 401, "login required to vote")
		return
	}
	if !rateLimit("feature-vote:"+pid, 120, time.Minute) {
		writeError(w, 429, "slow down")
		return
	}
	featureID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, 400, "invalid feature id")
		return
	}
	var req struct {
		Vote int `json:"vote"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	switch req.Vote {
	case 1, -1:
		db.Pool.Exec(ctx, `
			INSERT INTO feature_votes (feature_id, player_id, vote) VALUES ($1, $2::uuid, $3)
			ON CONFLICT (feature_id, player_id) DO UPDATE SET vote=$3, created_at=NOW()
		`, featureID, pid, req.Vote)
	case 0:
		db.Pool.Exec(ctx, `DELETE FROM feature_votes WHERE feature_id=$1 AND player_id=$2::uuid`, featureID, pid)
	default:
		writeError(w, 400, "vote must be 1, -1, or 0")
		return
	}
	var score int64
	db.Pool.QueryRow(ctx, `SELECT COALESCE(SUM(vote),0) FROM feature_votes WHERE feature_id=$1`, featureID).Scan(&score)
	writeJSON(w, 200, map[string]any{"ok": true, "score": score, "my_vote": req.Vote})
}

func handleRangeResetVotes(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var votes int
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM range_reset_votes WHERE voted_at > NOW() - INTERVAL '10 minutes'`).Scan(&votes)
	writeJSON(w, 200, map[string]any{"votes": votes, "threshold": rangeResetThreshold(ctx)})
}

func handleRangeResetVote(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	token := sessionTokenFromRequest(r)
	if token == "" {
		writeError(w, 401, "authentication required")
		return
	}
	pid, _ := sessionLookup(ctx, token)
	if pid == "" {
		writeError(w, 401, "invalid or expired session: please log in again")
		return
	}
	playerID, _ := uuid.Parse(pid)

	// Reject if reset fired in the last 5 minutes (prevents single-player spam)
	var lastReset time.Time
	db.Pool.QueryRow(ctx, `SELECT COALESCE(MAX(created_at), 'epoch') FROM ticker_events WHERE message LIKE 'RANGE RESET%'`).Scan(&lastReset)
	if time.Since(lastReset) < 5*time.Minute {
		remaining := int((5*time.Minute - time.Since(lastReset)).Seconds())
		writeJSON(w, 200, map[string]any{"votes": 0, "threshold": rangeResetThreshold(ctx), "reset": false, "cooldown_secs": remaining})
		return
	}

	db.Pool.Exec(ctx, `
		INSERT INTO range_reset_votes (player_id) VALUES ($1)
		ON CONFLICT (player_id) DO UPDATE SET voted_at = NOW()
	`, playerID)

	var votes int
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM range_reset_votes WHERE voted_at > NOW() - INTERVAL '10 minutes'`).Scan(&votes)

	threshold := rangeResetThreshold(ctx)
	triggered := false
	if votes >= threshold {
		db.Pool.Exec(ctx, `DELETE FROM range_reset_votes`)
		// Respawn the bundled MERIDIAN containers (re-seeds clean flags + loot).
		if corp.Enabled() {
			go corp.Provision(context.Background())
		}
		db.Pool.Exec(ctx, `INSERT INTO ticker_events (message) VALUES ($1)`,
			fmt.Sprintf("RANGE RESET: player vote passed (%d/%d)", threshold, threshold))
		triggered = true
	}

	writeJSON(w, 200, map[string]any{"votes": votes, "threshold": threshold, "reset": triggered})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; connect-src *; img-src * data:; font-src 'none'; style-src 'none'; script-src 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	allowed := map[string]bool{
		"http://localhost:3000": true,
		"http://localhost:3001": true,
		"http://127.0.0.1:3000": true,
		"http://127.0.0.1:3001": true,
	}
	if extra := os.Getenv("CORS_ORIGINS"); extra != "" {
		for _, o := range strings.Split(extra, ",") {
			if o = strings.TrimSpace(o); o != "" {
				allowed[o] = true
			}
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o := r.Header.Get("Origin")
		// Allow the configured origins plus any private-LAN address on the hub/admin
		// ports, so a self-hosted range works however the operator reaches it (LAN IP,
		// localhost, or a hostname) without the deploy having to guess the right IP.
		if allowed[o] || isPrivateLANOrigin(o) {
			w.Header().Set("Access-Control-Allow-Origin", o)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-User, X-Admin-Pass, X-Player-Token")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// isPrivateLANOrigin allows http://<private-ip>:3000 or :3001 (the hub + admin
// ports) so a self-hosted range works from any LAN address without the deploy
// pinning one IP. Only RFC1918 ranges over plain HTTP on those two ports.
var privateLANOriginRE = regexp.MustCompile(`^http://(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):(3000|3001)$`)

func isPrivateLANOrigin(o string) bool {
	return o != "" && privateLANOriginRE.MatchString(o)
}

// ── File upload ────────────────────────────────────────────────────────────────

var allowedMIME = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

func makeUploadHandler(uploadDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := sessionTokenFromRequest(r)
		if token == "" {
			writeError(w, 401, "X-Player-Token required")
			return
		}
		// Verify session token belongs to a real player
		_, handle := sessionLookup(r.Context(), token)
		if handle == "" {
			writeError(w, 403, "invalid or expired session: please log in again")
			return
		}

		if !rateLimit("upload:"+handle, 10, time.Hour) {
			writeError(w, 429, "upload limit reached: try again later")
			return
		}

		// Cap body to 8 MB before parsing
		r.Body = http.MaxBytesReader(w, r.Body, 8*1024*1024)
		if err := r.ParseMultipartForm(8 * 1024 * 1024); err != nil {
			writeError(w, 400, "file too large or bad form data (max 8 MB)")
			return
		}

		file, _, err := r.FormFile("file")
		if err != nil {
			writeError(w, 400, "missing file field")
			return
		}
		defer file.Close()

		// Read first 512 bytes to detect MIME type from magic bytes
		head := make([]byte, 512)
		n, _ := file.Read(head)
		mime := http.DetectContentType(head[:n])
		ext, ok := allowedMIME[mime]
		if !ok {
			writeError(w, 400, "unsupported file type: jpeg, png, gif, webp only")
			return
		}

		// Create file with UUID name
		id := uuid.New().String()
		fname := id + ext
		dst, err := os.Create(uploadDir + "/" + fname)
		if err != nil {
			log.Printf("upload create: %v", err)
			writeError(w, 500, "internal server error")
			return
		}
		defer dst.Close()

		// Write the 512-byte head we already read, then the rest
		if _, err := dst.Write(head[:n]); err != nil {
			writeError(w, 500, "internal server error")
			return
		}
		if _, err := io.Copy(dst, file); err != nil {
			writeError(w, 500, "internal server error")
			return
		}

		apiBase := os.Getenv("PUBLIC_API_BASE")
		if apiBase == "" {
			apiBase = os.Getenv("NEXT_PUBLIC_API_URL")
		}
		if apiBase == "" {
			apiBase = "http://localhost:8080"
		}
		writeJSON(w, 200, map[string]string{
			"url": apiBase + "/files/" + fname,
		})
	}
}

func makeFileHandler(uploadDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fname := chi.URLParam(r, "filename")
		// Guard against path traversal - filename must be UUID + safe extension
		if !regexp.MustCompile(`^[0-9a-f-]{36}\.(jpg|jpeg|png|gif|webp)$`).MatchString(fname) {
			writeError(w, 400, "invalid filename")
			return
		}
		path := uploadDir + "/" + fname
		f, err := os.Open(path)
		if err != nil {
			writeError(w, 404, "not found")
			return
		}
		defer f.Close()
		head := make([]byte, 512)
		n, _ := f.Read(head)
		mime := http.DetectContentType(head[:n])
		w.Header().Set("Content-Type", mime)
		w.Header().Set("Cache-Control", "public, max-age=31536000")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Write(head[:n])
		io.Copy(w, f)
	}
}

func handleCorpMachines(w http.ResponseWriter, r *http.Request) {
	type machineOut struct {
		Name         string `json:"name"`
		Display      string `json:"display"`
		Role         string `json:"role"`
		ArenaIP      string `json:"arena_ip"`
		Tier         string `json:"tier"`
		Status       string `json:"status"`
		Healthy      bool   `json:"healthy"`
		KingHandle   string `json:"king_handle"`
		UserCaptured bool   `json:"user_flag_captured"`
		RootCaptured bool   `json:"root_flag_captured"`
	}
	var out []machineOut
	for _, m := range corp.Roster {
		o := machineOut{Name: m.Name, Display: m.Display, Role: m.Role, ArenaIP: m.ArenaIP, Tier: m.Tier}
		db.Pool.QueryRow(r.Context(), `
			SELECT COALESCE(status,''), COALESCE(health_ok,false), COALESCE(king_handle,''),
			       EXISTS(SELECT 1 FROM kills k WHERE k.koth_id=km.id AND k.kind='user_flag'),
			       EXISTS(SELECT 1 FROM kills k WHERE k.koth_id=km.id AND k.kind='root_flag')
			FROM koth_machines km WHERE arena_ip=$1::inet AND machine_type='corp'
		`, m.ArenaIP).Scan(&o.Status, &o.Healthy, &o.KingHandle, &o.UserCaptured, &o.RootCaptured)
		out = append(out, o)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func handleCorpReset(w http.ResponseWriter, r *http.Request) {
	ip := chi.URLParam(r, "ip")
	adm.AuditLog(r.Context(), "corp_reset", ip)
	go corp.ResetMachine(context.Background(), ip)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "resetting " + ip})
}

func handleCorpTest(w http.ResponseWriter, r *http.Request) {
	ip := chi.URLParam(r, "ip")
	ok, detail := corp.TestMachine(ip)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": ok, "detail": detail})
}

func handleCorpClearKing(w http.ResponseWriter, r *http.Request) {
	ip := chi.URLParam(r, "ip")
	adm.AuditLog(r.Context(), "corp_clear_king", ip)
	corp.ClearKing(r.Context(), ip)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "king cleared on " + ip})
}
