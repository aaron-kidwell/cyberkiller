// Package chat is the live hub chat: a WebSocket hub with history, emotes, and
// moderation (slowmode, emote-only, timeouts, operator messages).
package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/cyberkiller/api/internal/db"
	"github.com/gorilla/websocket"
)

// allowedWSOrigins is the set of origins permitted to open chat WebSockets.
// Prevents cross-site WebSocket hijacking if a player visits a malicious page
// with a valid session token in localStorage. localhost/127.0.0.1 entries
// support local dev and LAN testers using --resolve hacks.
var allowedWSOrigins = map[string]bool{
	"https://cyberkiller.net":     true,
	"https://www.cyberkiller.net": true,
	"http://localhost:3000":       true,
	"http://localhost:3001":       true,
	"http://127.0.0.1:3000":       true,
	"http://127.0.0.1:3001":       true,
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		o := r.Header.Get("Origin")
		if o == "" {
			return true // allow non-browser clients (curl, agents)
		}
		if allowedWSOrigins[o] {
			return true
		}
		// LAN testers may hit http://192.168.x.y:3000 directly
		if strings.HasPrefix(o, "http://192.168.") && strings.HasSuffix(o, ":3000") {
			return true
		}
		return false
	},
	ReadBufferSize:    4096,
	WriteBufferSize:   4096,
	EnableCompression: false,
	HandshakeTimeout:  10 * time.Second,
}

const (
	writeWait  = 10 * time.Second
	pongWait   = 90 * time.Second
	pingPeriod = 10 * time.Second
)

type Message struct {
	ID        string `json:"id"`
	Handle    string `json:"handle"`
	Text      string `json:"text"`
	Timestamp int64  `json:"ts"`
	System    bool   `json:"system,omitempty"`
	Type      string `json:"type,omitempty"` // "delete" | "timeout_self" | "throne"
	AvatarURL string `json:"avatar_url,omitempty"`
	Accent    string `json:"accent,omitempty"`   // player's profile accent color (hex)
	ArenaIP   string `json:"arena_ip,omitempty"` // throne events: which box changed hands
}

// Profile-snippet cache - chat is high frequency, profile changes are rare.
// One DB hit per handle every 60s instead of one per message.
var (
	profileSnipMu    sync.RWMutex
	profileSnipCache = make(map[string]profileSnipEntry)
)

type profileSnipEntry struct {
	avatar string
	accent string
	expiry time.Time
}

// Hex-ish color sanity check so a malicious profile field can't smuggle CSS.
var hexColorRE = regexp.MustCompile(`^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`)

// Theme preset accent fallbacks for players who haven't set a custom color.
// Keep in sync with web/lib/profile.ts THEME_PRESETS.
var themeAccent = map[string]string{
	"neon_ghost": "#e834c6",
	"synthwave":  "#ff2ec4",
	"matrix":     "#00ff66",
	"vaporwave":  "#ff6ad5",
	"acid":       "#a3e635",
	"midnight":   "#22d3ee",
	"bloodmoon":  "#f43f5e",
	"phosphor":   "#7fffd4",
}

func profileSnippet(ctx context.Context, handle string) (avatar, accent string) {
	profileSnipMu.RLock()
	e, ok := profileSnipCache[handle]
	profileSnipMu.RUnlock()
	if ok && time.Now().Before(e.expiry) {
		return e.avatar, e.accent
	}
	var av, ac, theme string
	_ = db.Pool.QueryRow(ctx, `
		SELECT COALESCE(avatar_url,''), COALESCE(color_accent,''), COALESCE(theme_preset,'')
		FROM players WHERE handle=$1
	`, handle).Scan(&av, &ac, &theme)
	if !hexColorRE.MatchString(ac) {
		ac = themeAccent[theme]
	}
	profileSnipMu.Lock()
	profileSnipCache[handle] = profileSnipEntry{avatar: av, accent: ac, expiry: time.Now().Add(60 * time.Second)}
	profileSnipMu.Unlock()
	return av, ac
}

// avatarFor preserved for the history-replay code path.
func avatarFor(ctx context.Context, handle string) string {
	av, _ := profileSnippet(ctx, handle)
	return av
}

// ── Moderation modes ─────────────────────────────────────────────────────────
// Set by admin endpoints; checked on every inbound message.
var (
	modeMu          sync.RWMutex
	slowmodeSeconds int  // 0 = off
	emoteOnly       bool // true = only emote tokens allowed
	lastSentMu      sync.Mutex
	lastSent        = make(map[string]time.Time)
)

func SetSlowmode(sec int) {
	if sec < 0 {
		sec = 0
	}
	if sec > 600 {
		sec = 600
	}
	modeMu.Lock()
	slowmodeSeconds = sec
	modeMu.Unlock()
	notice := fmt.Sprintf("Slowmode: %ds", sec)
	if sec == 0 {
		notice = "Slowmode OFF"
	}
	broadcast(Message{ID: nextID(), Handle: "system", Text: notice, Timestamp: time.Now().Unix(), System: true}, nil)
}

func SetEmoteOnly(on bool) {
	modeMu.Lock()
	emoteOnly = on
	modeMu.Unlock()
	notice := "Emote-only mode: OFF"
	if on {
		notice = "Emote-only mode: ON"
	}
	broadcast(Message{ID: nextID(), Handle: "system", Text: notice, Timestamp: time.Now().Unix(), System: true}, nil)
}

// SendOperator posts a message into chat as the operator/control account. Used
// by the admin panel to reply to players in the live chat. It is broadcast to
// every connected client and persisted like any other message. Handle is fixed
// to "operator" so it is visually distinct and never impersonates a player.
func SendOperator(text string) Message {
	text = strings.TrimSpace(text)
	if len(text) > 500 {
		text = text[:500]
	}
	m := Message{ID: nextID(), Handle: "operator", Text: text, Timestamp: time.Now().Unix(), System: true}
	appendHistory(m)
	broadcast(m, nil)
	return m
}

// BroadcastThrone pushes a real-time King-of-the-Hill throne change to every
// connected hub client (text announcement + which box + the new king), so the
// crown updates live instead of waiting for the next radar poll. Not persisted
// to chat history - it's an ephemeral event.
func BroadcastThrone(arenaIP, king, text string) {
	broadcast(Message{
		ID:        nextID(),
		Type:      "throne",
		Handle:    king,
		Text:      text,
		ArenaIP:   arenaIP,
		Timestamp: time.Now().Unix(),
		System:    true,
	}, nil)
}

func ModerationState() (slowmode int, emoteOnlyOn bool) {
	modeMu.RLock()
	defer modeMu.RUnlock()
	return slowmodeSeconds, emoteOnly
}

// customColonEmotes mirrors web/components/ArenaChat.tsx CUSTOM_EMOTES so the
// server can validate emote-only mode against the same hacker shortcodes the
// client renders. Update both lists together if changing either.
var customColonEmotes = map[string]bool{
	":rooted:": true, ":koth:": true, ":skull:": true, ":owned:": true,
	":hack:": true, ":grind:": true, ":rekt:": true, ":zero:": true,
	":ez:": true, ":gg:": true, ":fire:": true, ":wave:": true,
	":root:": true, ":shell:": true, ":bug:": true, ":noob:": true,
	":slay:": true, ":stealth:": true, ":rip:": true, ":pwned:": true,
}

// allMessageTokensAreEmotes returns true if every whitespace-separated token
// in text is present in the live 7TV emote map or the custom-emote allowlist.
// Empty text fails. Arbitrary :colon-wrapped: text does NOT pass - it must be
// in customColonEmotes, otherwise emote-only mode is trivially bypassable.
func allMessageTokensAreEmotes(text string) bool {
	t := strings.TrimSpace(text)
	if t == "" {
		return false
	}
	em := Emotes()
	for _, tok := range strings.Fields(t) {
		if _, ok := em[tok]; ok {
			continue
		}
		if customColonEmotes[tok] {
			continue
		}
		return false
	}
	return true
}

// applySlowmode returns "" if the message may pass, or a reject reason string.
func applySlowmode(handle string) string {
	sec, _ := ModerationState()
	if sec <= 0 {
		return ""
	}
	lastSentMu.Lock()
	defer lastSentMu.Unlock()
	if t, ok := lastSent[handle]; ok {
		wait := time.Until(t.Add(time.Duration(sec) * time.Second))
		if wait > 0 {
			return fmt.Sprintf("slowmode: wait %ds", int(wait.Seconds())+1)
		}
	}
	lastSent[handle] = time.Now()
	return ""
}

// client owns its WebSocket write path; only the writePump goroutine calls conn.WriteJSON.
type client struct {
	conn   *websocket.Conn
	handle string
	send   chan Message // buffered; drop connection if full
	// sessionStart is the epoch (seconds) the current browser session began.
	// Replay only sends messages at or after this, so each login is a clean
	// slate (no stale history from days ago). Zero means "no cutoff".
	sessionStart int64
}

var (
	msgCounter uint64

	clientsMu sync.RWMutex
	clients   = make(map[*client]struct{})

	historyMu sync.RWMutex
	history   = seedHistory()

	lastJoinMu sync.Mutex
	lastJoin   = make(map[string]time.Time)

	timeoutsMu sync.Mutex
	timeouts   = make(map[string]time.Time)
)

func nextID() string {
	return fmt.Sprintf("%d", atomic.AddUint64(&msgCounter, 1))
}

func seedHistory() []Message {
	// Initial in-memory seed before LoadHistoryFromDB is called by main().
	// Replaced once the DB pool is up.
	now := time.Now().Unix()
	return []Message{
		{ID: nextID(), Handle: "system", Text: "Arena online. Attack range machines only.", Timestamp: now, System: true},
		{ID: nextID(), Handle: "system", Text: "Be kind, respectful, and helpful to your fellow hackers. This is a community, look out for each other.", Timestamp: now, System: true},
	}
}

// LoadHistoryFromDB replaces the in-memory history with the last 200 messages
// from chat_messages. Call this once at startup after db.Pool is initialized.
func LoadHistoryFromDB() {
	if db.Pool == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	rows, err := db.Pool.Query(ctx, `
		SELECT message_id, handle, text, is_system, EXTRACT(EPOCH FROM created_at)::bigint
		FROM chat_messages
		ORDER BY created_at DESC
		LIMIT 200
	`)
	if err != nil {
		log.Printf("[chat] LoadHistoryFromDB failed: %v", err)
		return
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.Handle, &m.Text, &m.System, &m.Timestamp); err == nil {
			out = append([]Message{m}, out...) // reverse to chronological
		}
	}
	if len(out) == 0 {
		return
	}
	historyMu.Lock()
	history = out
	historyMu.Unlock()
	log.Printf("[chat] loaded %d messages from DB", len(out))
}

// writePump drains the send channel and writes to the WebSocket.
// It is the only goroutine that writes to conn, so no lock needed on writes.
// Also sends periodic pings to keep the connection alive through proxies.
func (c *client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case m, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteJSON(m); err != nil {
				log.Printf("[chat] writePump %s: WriteJSON error: %v", c.handle, err)
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				log.Printf("[chat] writePump %s: ping error: %v", c.handle, err)
				return
			}
		}
	}
}

func isTimedOut(handle string) (bool, time.Time) {
	timeoutsMu.Lock()
	defer timeoutsMu.Unlock()
	exp, ok := timeouts[handle]
	if !ok {
		return false, time.Time{}
	}
	if time.Now().After(exp) {
		delete(timeouts, handle)
		return false, time.Time{}
	}
	return true, exp
}

// resolveHandle returns the player's handle if the session token is valid.
// Returns "" if the token is missing or invalid - HandleWS will then reject
// the upgrade with 401. Anonymous chat is no longer allowed: every connection
// must be tied to a logged-in player so moderation actions actually mean
// something.
func resolveHandle(ctx context.Context, token, queryHandle string) (string, int64) {
	if token == "" {
		return "", 0
	}
	var handle string
	var sessionStart sql.NullInt64
	if err := db.Pool.QueryRow(ctx,
		`SELECT COALESCE(handle,''), EXTRACT(EPOCH FROM session_started_at)::bigint
		   FROM players WHERE session_token=$1 AND NOT banned
		   AND (session_token_expires_at IS NULL OR session_token_expires_at > NOW())`,
		token,
	).Scan(&handle, &sessionStart); err == nil && handle != "" {
		return handle, sessionStart.Int64
	}
	return "", 0
}

func HandleWS(w http.ResponseWriter, r *http.Request) {
	// Prefer the HttpOnly session cookie (set by /login on the same origin)
	// over a query-string token. JS can't read the cookie, so this is the
	// XSS-safe path for browsers. Query token is still supported for CLI/test
	// tools that can't set cookies.
	token := r.URL.Query().Get("token")
	if c, err := r.Cookie("ck_session"); err == nil && c.Value != "" {
		token = c.Value
	}
	handle, sessionStart := resolveHandle(r.Context(), token, r.URL.Query().Get("handle"))
	if handle == "" {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[chat] upgrade failed for handle=%s: %v", handle, err)
		return
	}
	log.Printf("[chat] WS opened for %s", handle)

	// Cap incoming WS frames to 8 KB - chat messages are < 500 chars.
	// Prevents a malicious client from sending GB-size frames to OOM the server.
	conn.SetReadLimit(8 * 1024)

	// Read deadline + pong handler keep the connection alive through proxies.
	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	c := &client{conn: conn, handle: handle, send: make(chan Message, 64), sessionStart: sessionStart}

	clientsMu.Lock()
	clients[c] = struct{}{}
	clientsMu.Unlock()

	// Set up cleanup BEFORE any work that might fail.
	defer func() {
		clientsMu.Lock()
		delete(clients, c)
		clientsMu.Unlock()
		close(c.send)
	}()

	go c.writePump()

	// Replay history asynchronously to avoid sending data in the same TCP segment
	// as the 101 Switching Protocols response. Some clients (notably Android Firefox
	// and iOS Safari) drop the connection if data arrives before they finish the
	// WS handshake. Recover from send-on-closed-channel if the connection died
	// before this goroutine wakes.
	go func() {
		defer func() { recover() }()
		time.Sleep(50 * time.Millisecond)
		historyMu.RLock()
		// On login, replay the most recent 100 messages regardless of age, so
		// everyone lands in the same populated chat (reconnects backfill via the
		// client's id-dedupe). History is capped at 200, so last-100 is always live.
		start := 0
		if len(history) > 100 {
			start = len(history) - 100
		}
		snap := make([]Message, len(history)-start)
		copy(snap, history[start:])
		historyMu.RUnlock()
		// Backfill avatars on replay - they aren't stored in chat_messages,
		// and the in-memory cache may have been cleared by a restart. avatarFor
		// is cached (60s TTL) so repeated handles only hit DB once.
		for i := range snap {
			if !snap[i].System && snap[i].Handle != "" {
				av, ac := profileSnippet(r.Context(), snap[i].Handle)
				if snap[i].AvatarURL == "" {
					snap[i].AvatarURL = av
				}
				if snap[i].Accent == "" {
					snap[i].Accent = ac
				}
			}
		}
		for _, m := range snap {
			select {
			case c.send <- m:
			default:
				return
			}
		}
	}()

	if handle != "" && handle != "anon" {
		lastJoinMu.Lock()
		// Wide window: announce a join once per long session, not on every WS
		// reconnect. A flapping client (or a hub tab that reconnects on focus)
		// must not re-spam "X joined the arena" - 5 min was far too short.
		recent := time.Since(lastJoin[handle]) < 2*time.Hour
		if !recent {
			lastJoin[handle] = time.Now()
		}
		lastJoinMu.Unlock()
		if !recent {
			joinMsg := Message{
				ID:        nextID(),
				Handle:    "system",
				Text:      handle + " joined the arena",
				Timestamp: time.Now().Unix(),
				System:    true,
			}
			// Don't appendHistory - join messages are ephemeral. Otherwise every WS
			// reconnect replays every prior join, spamming the chat.
			broadcast(joinMsg, c) // don't echo their own join to themselves
		}
	}

	for {
		var m Message
		if err := conn.ReadJSON(&m); err != nil {
			log.Printf("[chat] read loop %s exited: %v", handle, err)
			break
		}

		if timedOut, exp := isTimedOut(handle); timedOut {
			remaining := time.Until(exp).Round(time.Second)
			c.send <- Message{
				ID:        nextID(),
				Handle:    "system",
				Text:      fmt.Sprintf("You are timed out for another %s", remaining),
				Timestamp: time.Now().Unix(),
				System:    true,
				Type:      "timeout_self",
			}
			continue
		}

		m.ID = nextID()
		m.Handle = handle
		m.System = false
		m.Type = ""
		m.Timestamp = time.Now().Unix()
		m.AvatarURL, m.Accent = profileSnippet(r.Context(), handle)
		if len(m.Text) > 500 {
			m.Text = m.Text[:500]
		}
		if m.Text == "" {
			continue
		}
		_, emoteOnlyOn := ModerationState()
		if emoteOnlyOn && !allMessageTokensAreEmotes(m.Text) {
			c.send <- Message{
				ID: nextID(), Handle: "system", Text: "Emote-only mode is on, message must contain only emotes.",
				Timestamp: time.Now().Unix(), System: true, Type: "timeout_self",
			}
			continue
		}
		if reason := applySlowmode(handle); reason != "" {
			c.send <- Message{
				ID: nextID(), Handle: "system", Text: reason,
				Timestamp: time.Now().Unix(), System: true, Type: "timeout_self",
			}
			continue
		}
		appendHistory(m)
		broadcast(m, nil)
	}
}

func appendHistory(m Message) {
	historyMu.Lock()
	history = append(history, m)
	if len(history) > 200 {
		history = history[len(history)-200:]
	}
	historyMu.Unlock()
	// Persist so messages survive ck-control restarts. Best-effort - chat
	// uptime should not depend on DB latency. Errors logged but not fatal.
	if db.Pool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, err := db.Pool.Exec(ctx,
			`INSERT INTO chat_messages (message_id, handle, text, is_system) VALUES ($1,$2,$3,$4)`,
			m.ID, m.Handle, m.Text, m.System)
		if err != nil {
			log.Printf("[chat] persist message failed: %v", err)
		}
		// Trim table: keep last 1000 messages, drop older. Cheap to run on
		// every insert since the index makes it ~µs.
		db.Pool.Exec(ctx,
			`DELETE FROM chat_messages WHERE id < (SELECT id FROM chat_messages ORDER BY id DESC OFFSET 1000 LIMIT 1)`)
	}
}

// broadcast sends m to all clients except skip. Holds the lock only long enough
// to iterate and enqueue - no blocking I/O under the lock.
func broadcast(m Message, skip *client) {
	clientsMu.RLock()
	defer clientsMu.RUnlock()
	for c := range clients {
		if c == skip {
			continue
		}
		select {
		case c.send <- m:
		default:
			// Client's buffer full - drop the message for this client rather than block.
		}
	}
}

// DeleteMessage removes a message from history and broadcasts a delete event.
func DeleteMessage(id string) bool {
	historyMu.Lock()
	found := false
	for i, m := range history {
		if m.ID == id {
			history = append(history[:i], history[i+1:]...)
			found = true
			break
		}
	}
	historyMu.Unlock()
	if found {
		broadcast(Message{ID: id, Type: "delete", Timestamp: time.Now().Unix()}, nil)
		if db.Pool != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			db.Pool.Exec(ctx, `DELETE FROM chat_messages WHERE message_id=$1`, id)
		}
	}
	return found
}

// TimeoutPlayer mutes a handle server-side for the given duration.
func TimeoutPlayer(handle string, minutes int) {
	exp := time.Now().Add(time.Duration(minutes) * time.Minute)
	timeoutsMu.Lock()
	timeouts[handle] = exp
	timeoutsMu.Unlock()

	notice := Message{
		ID:        nextID(),
		Handle:    "system",
		Text:      fmt.Sprintf("%s timed out for %dm", handle, minutes),
		Timestamp: time.Now().Unix(),
		System:    true,
	}
	appendHistory(notice)
	broadcast(notice, nil)

	// Send a private notice to the timed-out player's connections
	personal := Message{
		ID:        nextID(),
		Handle:    "system",
		Text:      fmt.Sprintf("You have been timed out for %d minutes", minutes),
		Timestamp: time.Now().Unix(),
		System:    true,
		Type:      "timeout_self",
	}
	clientsMu.RLock()
	for c := range clients {
		if c.handle == handle {
			select {
			case c.send <- personal:
			default:
			}
		}
	}
	clientsMu.RUnlock()
}

// GetHistory returns recent messages for admin display.
func GetHistory() []Message {
	historyMu.RLock()
	defer historyMu.RUnlock()
	snap := make([]Message, len(history))
	copy(snap, history)
	return snap
}

func OnlineCount() int {
	clientsMu.RLock()
	defer clientsMu.RUnlock()
	return len(clients)
}

func OnlineHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"online": OnlineCount()})
}

// HistoryHandler returns the last 100 chat messages straight from the DB. The
// client loads this on mount (reliable, independent of WS-replay/in-memory state),
// then subscribes to /chat/ws for live updates (deduped by id).
func HistoryHandler(w http.ResponseWriter, r *http.Request) {
	out := []Message{}
	rows, err := db.Pool.Query(r.Context(), `
		SELECT message_id, handle, text, is_system, EXTRACT(EPOCH FROM created_at)::bigint
		FROM chat_messages ORDER BY created_at DESC LIMIT 100`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var m Message
			if rows.Scan(&m.ID, &m.Handle, &m.Text, &m.System, &m.Timestamp) == nil {
				out = append([]Message{m}, out...) // reverse to chronological
			}
		}
	}
	for i := range out {
		if !out[i].System && out[i].Handle != "" {
			out[i].AvatarURL, out[i].Accent = profileSnippet(r.Context(), out[i].Handle)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"messages": out})
}
