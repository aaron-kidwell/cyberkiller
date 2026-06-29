// Package admin implements the instructor console endpoints behind /admin/*
// (BasicAuth): managing targets (add/spin/stop/delete), awarding and revoking
// captures, player moderation, chat, and range settings.
package admin

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/cyberkiller/api/internal/chat"
	"github.com/cyberkiller/api/internal/db"
	"github.com/cyberkiller/api/internal/koth"
	"github.com/cyberkiller/api/internal/scoring"
	"github.com/cyberkiller/api/internal/settings"
	"github.com/cyberkiller/api/internal/targets"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func GetSettings(w http.ResponseWriter, r *http.Request) {
	all, err := settings.All(r.Context())
	if err != nil {
		log.Printf("admin GetSettings: %v", err)
		writeErr(w, 500, "internal server error")
		return
	}
	writeJSON(w, 200, all)
}

func PutSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	ctx := r.Context()
	for k, v := range body {
		if err := settings.Set(ctx, k, v); err != nil {
			log.Printf("admin PutSettings key=%q: %v", k, err)
			writeErr(w, 500, "internal server error")
			return
		}
	}
	db.Pool.Exec(ctx, `INSERT INTO audit_log (actor, action, detail) VALUES ('admin','settings_update',$1)`, "bulk")
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func GetImages(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Pool.Query(r.Context(), `
		SELECT id, name, docker_image, tier, COALESCE(description,''), ssh_port, web_port, enabled, fail_count,
			COALESCE(source,'reference'), needs_flag_inject,
			EXISTS(SELECT 1 FROM koth_machines k WHERE k.image_id=target_images.id AND k.status IN ('active','spinning'))
		FROM target_images ORDER BY tier, name
	`)
	if err != nil {
		log.Printf("admin GetImages: %v", err)
		writeErr(w, 500, "internal server error")
		return
	}
	defer rows.Close()
	list := []map[string]any{}
	for rows.Next() {
		var id, name, img, tier, desc, source string
		var ssh, web, fails int
		var enabled, needsInject, live bool
		rows.Scan(&id, &name, &img, &tier, &desc, &ssh, &web, &enabled, &fails, &source, &needsInject, &live)
		m := map[string]any{
			"id": id, "name": name, "docker_image": img, "tier": tier,
			"ssh_port": ssh, "web_port": web, "enabled": enabled, "fail_count": fails,
			"source": source, "needs_flag_inject": needsInject, "live": live,
		}
		if desc != "" {
			m["description"] = desc
		}
		list = append(list, m)
	}
	writeJSON(w, 200, list)
}

func PutImage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Enabled     *bool   `json:"enabled"`
		Tier        *string `json:"tier"`
		Description *string `json:"description"`
		Name        *string `json:"name"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	ctx := r.Context()
	if body.Enabled != nil {
		if *body.Enabled {
			db.Pool.Exec(ctx, `UPDATE target_images SET enabled=true, fail_count=0 WHERE id=$1`, id)
		} else {
			db.Pool.Exec(ctx, `UPDATE target_images SET enabled=false WHERE id=$1`, id)
		}
	}
	if body.Tier != nil {
		db.Pool.Exec(ctx, `UPDATE target_images SET tier=$1 WHERE id=$2`, *body.Tier, id)
	}
	if body.Description != nil {
		db.Pool.Exec(ctx, `UPDATE target_images SET description=$1 WHERE id=$2`, *body.Description, id)
	}
	if body.Name != nil {
		db.Pool.Exec(ctx, `UPDATE target_images SET name=$1 WHERE id=$2`, *body.Name, id)
	}
	AuditLog(ctx, "image_update", id)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func BanPlayer(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	var body struct {
		Banned bool `json:"banned"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	if body.Banned {
		db.Pool.Exec(r.Context(), `UPDATE players SET banned=true, connected=false, session_token=NULL WHERE handle=$1`, handle)
		AuditLog(r.Context(), "player_ban", handle)
	} else {
		db.Pool.Exec(r.Context(), `UPDATE players SET banned=false WHERE handle=$1`, handle)
		AuditLog(r.Context(), "player_unban", handle)
	}
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func KickPlayer(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	ctx := r.Context()
	tag, err := db.Pool.Exec(ctx, `UPDATE players SET connected=false, session_token=NULL WHERE handle=$1`, handle)
	if err != nil || tag.RowsAffected() == 0 {
		writeErr(w, 404, "player not found")
		return
	}
	db.Pool.Exec(ctx, `INSERT INTO ticker_events (message) VALUES ($1)`, "Operator disconnected "+handle)
	AuditLog(ctx, "player_kick", handle)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

// captureBody is the shared payload for awarding/revoking a target capture.
type captureBody struct {
	Handle  string `json:"handle"`
	ArenaIP string `json:"arena_ip"`
	Kind    string `json:"kind"` // "user_flag" | "root_flag"
}

// resolveCapture validates the body and looks up the player + target. The points
// for the capture come from settings (falling back to the scoring defaults).
func resolveCapture(ctx context.Context, b captureBody) (playerID, kothID uuid.UUID, points int, err error) {
	if b.Kind != "user_flag" && b.Kind != "root_flag" {
		return playerID, kothID, 0, fmt.Errorf("kind must be user_flag or root_flag")
	}
	if err = db.Pool.QueryRow(ctx, `SELECT id FROM players WHERE handle=$1`, b.Handle).Scan(&playerID); err != nil {
		return playerID, kothID, 0, fmt.Errorf("player not found")
	}
	if err = db.Pool.QueryRow(ctx, `SELECT id FROM koth_machines WHERE host(arena_ip)=$1 AND status='active'`, b.ArenaIP).Scan(&kothID); err != nil {
		return playerID, kothID, 0, fmt.Errorf("no active target at that IP")
	}
	if b.Kind == "root_flag" {
		points = settings.Int(ctx, "root_flag_points", scoring.RootFlagPoints)
	} else {
		points = settings.Int(ctx, "user_flag_points", scoring.UserFlagPoints)
	}
	return playerID, kothID, points, nil
}

// AwardCapture grants a player a user/root capture on a target. Scoring is
// operator-driven: the instructor confirms a player owned the box and awards the
// points. Re-awarding the same capture is a no-op.
func AwardCapture(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var b captureBody
	json.NewDecoder(r.Body).Decode(&b)
	pid, kothID, points, err := resolveCapture(ctx, b)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	var exists bool
	db.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM kills WHERE koth_id=$1 AND attacker_id=$2 AND kind=$3)`, kothID, pid, b.Kind).Scan(&exists)
	if exists {
		writeJSON(w, 200, map[string]string{"ok": "true", "note": "already awarded"})
		return
	}
	if err := scoring.AwardKill(ctx, pid, points, b.Kind, nil, &kothID); err != nil {
		log.Printf("admin AwardCapture: %v", err)
		writeErr(w, 500, "internal server error")
		return
	}
	if b.Kind == "root_flag" {
		db.Pool.Exec(ctx, `UPDATE koth_machines SET king_player_id=$1, king_handle=$2, king_since=NOW() WHERE id=$3`, pid, b.Handle, kothID)
	} else {
		db.Pool.Exec(ctx, `UPDATE koth_machines SET user_flag_handle=$1 WHERE id=$2`, b.Handle, kothID)
	}
	// Record in capture_log so a manual award also shows in the hub Activity feed.
	db.Pool.Exec(ctx, `
		INSERT INTO capture_log (attacker_id, handle, kind, koth_id, arena_ip, points)
		VALUES ($1,$2,$3,$4,$5,$6)
	`, pid, b.Handle, b.Kind, kothID, b.ArenaIP, points)
	label := "user"
	if b.Kind == "root_flag" {
		label = "root"
	}
	db.Pool.Exec(ctx, `INSERT INTO ticker_events (message) VALUES ($1)`,
		fmt.Sprintf("%s captured %s on %s (+%d pts)", b.Handle, label, b.ArenaIP, points))
	AuditLog(ctx, "award_capture", b.Handle+":"+b.ArenaIP+":"+b.Kind)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

// RevokeCapture undoes a previously awarded capture: it deletes the kill, backs
// the points out of the player's score, and clears the holder if it was a root
// capture.
func RevokeCapture(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var b captureBody
	json.NewDecoder(r.Body).Decode(&b)
	pid, kothID, points, err := resolveCapture(ctx, b)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	tag, _ := db.Pool.Exec(ctx, `DELETE FROM kills WHERE koth_id=$1 AND attacker_id=$2 AND kind=$3`, kothID, pid, b.Kind)
	if tag.RowsAffected() == 0 {
		writeJSON(w, 200, map[string]string{"ok": "true", "note": "nothing to revoke"})
		return
	}
	killDelta := 1
	if b.Kind == "user_flag" {
		killDelta = 0
	}
	db.Pool.Exec(ctx, `UPDATE scores SET points = GREATEST(0, points - $2), kills = GREATEST(0, kills - $3), updated_at=NOW() WHERE player_id=$1`, pid, points, killDelta)
	if b.Kind == "root_flag" {
		db.Pool.Exec(ctx, `UPDATE koth_machines SET king_player_id=NULL, king_handle=NULL, king_since=NULL WHERE id=$1 AND king_player_id=$2`, kothID, pid)
	} else {
		db.Pool.Exec(ctx, `UPDATE koth_machines SET user_flag_handle=NULL WHERE id=$1 AND user_flag_handle=$2`, kothID, b.Handle)
	}
	AuditLog(ctx, "revoke_capture", b.Handle+":"+b.ArenaIP+":"+b.Kind)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

// --- Modular targets ---

// targetID builds a unique, human-readable catalog id from the target name.
func targetID(name string) string {
	s := slugify(name)
	if s == "" {
		s = "target"
	}
	b := make([]byte, 3)
	rand.Read(b)
	return s + "-" + hex.EncodeToString(b)
}

type targetSpec struct {
	Name            string `json:"name"`
	DockerImage     string `json:"docker_image"`
	Tier            string `json:"tier"`
	SSHPort         int    `json:"ssh_port"`
	WebPort         int    `json:"web_port"`
	RootPassword    string `json:"root_password"`
	NeedsFlagInject bool   `json:"needs_flag_inject"`
	KothEnabled     bool   `json:"koth_enabled"`
	UserFlagPath    string `json:"user_flag_path"`
	RootFlagPath    string `json:"root_flag_path"`
	Spin            bool   `json:"spin"` // spin immediately after adding
}

func normalizeTier(t string) string {
	switch t {
	case "easy", "medium", "hard":
		return t
	default:
		return "easy"
	}
}

// AddTarget registers a catalog image by registry reference (it is pulled now so
// a bad reference fails fast), optionally spinning it immediately.
func AddTarget(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var s targetSpec
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil || s.Name == "" || s.DockerImage == "" {
		writeErr(w, 400, "name and docker_image are required")
		return
	}
	id := targetID(s.Name)
	if err := targets.AddReference(ctx, id, s.Name, s.DockerImage, normalizeTier(s.Tier), s.SSHPort, s.WebPort, s.RootPassword, s.NeedsFlagInject, s.KothEnabled, s.UserFlagPath, s.RootFlagPath); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	AuditLog(ctx, "target_add", id+":"+s.DockerImage)
	if s.Spin {
		if err := targets.SpinImage(ctx, id); err != nil {
			writeErr(w, 500, "added but spin failed: "+err.Error())
			return
		}
	}
	writeJSON(w, 200, map[string]string{"ok": "true", "id": id})
}

// UploadTarget accepts a `docker save` tarball (multipart field "file") plus the
// target metadata, loads it, and registers it.
func UploadTarget(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := r.ParseMultipartForm(2 << 30); err != nil { // up to 2 GiB image
		writeErr(w, 400, "invalid upload")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, 400, "missing file")
		return
	}
	defer file.Close()
	name := r.FormValue("name")
	if name == "" {
		writeErr(w, 400, "name is required")
		return
	}
	tmp, err := os.CreateTemp("", "ck-image-*.tar")
	if err != nil {
		writeErr(w, 500, "internal server error")
		return
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, file); err != nil {
		tmp.Close()
		writeErr(w, 500, "failed to save upload")
		return
	}
	tmp.Close()

	id := targetID(name)
	sshPort, _ := strconv.Atoi(r.FormValue("ssh_port"))
	webPort, _ := strconv.Atoi(r.FormValue("web_port"))
	image, err := targets.LoadUpload(ctx, id, name, tmp.Name(), normalizeTier(r.FormValue("tier")),
		sshPort, webPort, r.FormValue("root_password"), r.FormValue("needs_flag_inject") == "true", r.FormValue("koth_enabled") == "true", r.FormValue("user_flag_path"), r.FormValue("root_flag_path"))
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	AuditLog(ctx, "target_upload", id+":"+image)
	writeJSON(w, 200, map[string]string{"ok": "true", "id": id, "image": image})
}

// SpinTarget brings a catalog image online as a live target.
func SpinTarget(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := targets.SpinImage(r.Context(), id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	AuditLog(r.Context(), "target_spin", id)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

// StopTarget tears down a live target instance (by machine id).
func StopTarget(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := targets.StopTarget(r.Context(), id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	AuditLog(r.Context(), "target_stop", id)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

// DeleteImage removes a catalog image. Any live instance should be stopped first.
func DeleteImage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx := r.Context()
	var live int
	db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM koth_machines WHERE image_id=$1 AND status IN ('active','spinning')`, id).Scan(&live)
	if live > 0 {
		writeErr(w, 409, "stop the live instance before deleting the image")
		return
	}
	// Expired machine rows still reference the image via FK; release them (keeping
	// their history, image_id just goes null) so the catalog row can be removed.
	db.Pool.Exec(ctx, `UPDATE koth_machines SET image_id=NULL WHERE image_id=$1 AND status='expired'`, id)
	tag, err := db.Pool.Exec(ctx, `DELETE FROM target_images WHERE id=$1`, id)
	if err != nil {
		writeErr(w, 409, "image is still referenced and could not be deleted")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 404, "image not found")
		return
	}
	AuditLog(ctx, "image_delete", id)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func GetHealthLog(w http.ResponseWriter, r *http.Request) {
	rows, _ := db.Pool.Query(r.Context(), `
		SELECT h.id, COALESCE(image_id,''), COALESCE(host(m.arena_ip),''), failed_step, error_detail, checked_at
		FROM health_check_log h
		LEFT JOIN koth_machines m ON m.id = h.machine_id
		WHERE NOT passed ORDER BY checked_at DESC LIMIT 30
	`)
	if rows != nil {
		defer rows.Close()
	}
	var list []map[string]any
	for rows.Next() {
		var id int64
		var img, ip, step, detail string
		var at time.Time
		rows.Scan(&id, &img, &ip, &step, &detail, &at)
		list = append(list, map[string]any{
			"id": id, "image_id": img, "arena_ip": ip, "failed_step": step,
			"detail": detail, "checked_at": at.Format(time.RFC3339),
		})
	}
	if list == nil {
		list = []map[string]any{}
	}
	writeJSON(w, 200, list)
}

func GetHills(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := db.Pool.Query(ctx, `
		SELECT k.id::text, host(arena_ip), image_name, tier, status, COALESCE(king_handle,''), bounty_pts,
			EXISTS(SELECT 1 FROM kills WHERE koth_id=k.id AND kind='user_flag'),
			EXISTS(SELECT 1 FROM kills WHERE koth_id=k.id AND kind='root_flag'),
			COALESCE(ssh_password,''),
			COALESCE(machine_type,'docker'),
			COALESCE(user_flag_handle,''),
			COALESCE(image_id,''),
			COALESCE(user_flag,''),
			COALESCE(root_flag,'')
		FROM koth_machines k
		WHERE status IN ('active','spinning') ORDER BY started_at DESC
	`)
	if err != nil {
		log.Printf("admin GetHills: %v", err)
		writeErr(w, 500, "internal server error")
		return
	}
	defer rows.Close()

	var list []map[string]any
	for rows.Next() {
		var id, ip, img, tier, status, king, sshPw, machineType, userFlagBy, imageID, userFlag, rootFlag string
		var bounty int
		var userCap, rootCap bool
		rows.Scan(&id, &ip, &img, &tier, &status, &king, &bounty, &userCap, &rootCap, &sshPw, &machineType, &userFlagBy, &imageID, &userFlag, &rootFlag)
		m := map[string]any{
			"id": id, "arena_ip": ip, "image_name": img, "tier": tier, "status": status,
			"king_handle": king, "bounty_pts": bounty,
			"user_flag_captured": userCap, "root_flag_captured": rootCap,
			"user_flag_by": userFlagBy, "machine_type": machineType, "image_id": imageID,
			// Planted flag values + the box password, shown to the instructor so a
			// player's claimed capture can be verified before awarding points.
			"ssh_password":      sshPw,
			"planted_user_flag": userFlag,
			"planted_root_flag": rootFlag,
		}
		list = append(list, m)
	}
	writeJSON(w, 200, list)
}

func PostTicker(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Message string `json:"message"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	if body.Message == "" {
		writeErr(w, 400, "message required")
		return
	}
	db.Pool.Exec(r.Context(), `INSERT INTO ticker_events (message) VALUES ($1)`, body.Message)
	AuditLog(r.Context(), "ticker_post", body.Message)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func GetAuditLog(w http.ResponseWriter, r *http.Request) {
	rows, _ := db.Pool.Query(r.Context(), `
		SELECT id, actor, action, COALESCE(detail,''), created_at
		FROM audit_log ORDER BY created_at DESC LIMIT 100
	`)
	if rows != nil {
		defer rows.Close()
	}
	var list []map[string]any
	for rows.Next() {
		var id int64
		var actor, action, detail string
		var at time.Time
		rows.Scan(&id, &actor, &action, &detail, &at)
		list = append(list, map[string]any{
			"id": id, "actor": actor, "action": action, "detail": detail,
			"created_at": at.Format(time.RFC3339),
		})
	}
	if list == nil {
		list = []map[string]any{}
	}
	writeJSON(w, 200, list)
}

func ClearAuditLog(w http.ResponseWriter, r *http.Request) {
	// Write the audit entry FIRST so the clear-event itself survives the wipe.
	AuditLog(r.Context(), "audit_clear", "")
	db.Pool.Exec(r.Context(), `DELETE FROM audit_log WHERE id < (SELECT MAX(id) FROM audit_log)`)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func DeleteAuditLogEntry(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	db.Pool.Exec(r.Context(), `DELETE FROM audit_log WHERE id=$1`, id)
	AuditLog(r.Context(), "audit_delete_entry", id)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func ClearHealthLog(w http.ResponseWriter, r *http.Request) {
	tag, _ := db.Pool.Exec(r.Context(), `DELETE FROM health_check_log WHERE NOT passed`)
	AuditLog(r.Context(), "healthlog_clear", fmt.Sprintf("%d rows", tag.RowsAffected()))
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func DeleteHealthLogEntry(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	db.Pool.Exec(r.Context(), `DELETE FROM health_check_log WHERE id=$1`, id)
	AuditLog(r.Context(), "healthlog_delete_entry", id)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

// GetGameEvents returns a merged feed of recent game activity for the admin dashboard.
func GetGameEvents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Recent kills with player handle and machine name
	killRows, _ := db.Pool.Query(ctx, `
		SELECT p.handle, k.kind, k.points,
		       COALESCE(km.image_name, '') AS machine, k.submitted_at
		FROM kills k
		JOIN players p ON p.id = k.attacker_id
		LEFT JOIN koth_machines km ON km.id = k.koth_id
		ORDER BY k.submitted_at DESC LIMIT 50
	`)
	var events []map[string]any
	if killRows != nil {
		defer killRows.Close()
		for killRows.Next() {
			var handle, kind, machine string
			var pts int
			var at time.Time
			killRows.Scan(&handle, &kind, &pts, &machine, &at)
			label := map[string]string{
				"user_flag":  "User flag",
				"admin_flag": "Admin flag",
				"root_flag":  "Root flag / DA",
				"koth":       "KotH throne",
				"target":     "Target kill",
				"community":  "Community kill",
			}[kind]
			if label == "" {
				label = kind
			}
			detail := label
			if machine != "" {
				detail += " on " + machine
			}
			events = append(events, map[string]any{
				"type": "kill", "actor": handle, "detail": detail,
				"points": pts, "at": at.Format(time.RFC3339),
			})
		}
	}

	// Recent ticker events (wave bounties, range resets, hill spins)
	tickRows, _ := db.Pool.Query(ctx, `
		SELECT message, created_at FROM ticker_events
		WHERE message NOT LIKE '%tokens rotated%'
		ORDER BY created_at DESC LIMIT 30
	`)
	if tickRows != nil {
		defer tickRows.Close()
		for tickRows.Next() {
			var msg string
			var at time.Time
			tickRows.Scan(&msg, &at)
			events = append(events, map[string]any{
				"type": "event", "actor": "system", "detail": msg,
				"at": at.Format(time.RFC3339),
			})
		}
	}

	// Sort merged by time desc
	sort.Slice(events, func(i, j int) bool {
		return events[i]["at"].(string) > events[j]["at"].(string)
	})
	if len(events) > 60 {
		events = events[:60]
	}
	if events == nil {
		events = []map[string]any{}
	}
	writeJSON(w, 200, events)
}

func PostSitrep(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Message string `json:"message"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	if body.Message == "" {
		writeErr(w, 400, "message required")
		return
	}
	db.Pool.Exec(r.Context(), `INSERT INTO sitrep_events (message, event_type) VALUES ($1,'operator')`, body.Message)
	AuditLog(r.Context(), "sitrep_post", body.Message)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func GetPlayers(w http.ResponseWriter, r *http.Request) {
	rows, _ := db.Pool.Query(r.Context(), `
		SELECT handle, COALESCE(host(arena_ip),''), connected, banned, is_admin, last_heartbeat
		FROM players ORDER BY created_at DESC LIMIT 200
	`)
	list := []map[string]any{}
	if rows == nil {
		writeJSON(w, 200, list)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var h, ip string
		var conn, banned, isAdmin bool
		var hb *time.Time
		rows.Scan(&h, &ip, &conn, &banned, &isAdmin, &hb)
		m := map[string]any{"handle": h, "arena_ip": ip, "connected": conn, "banned": banned, "is_admin": isAdmin}
		if hb != nil {
			m["last_heartbeat"] = hb.Format(time.RFC3339)
		}
		list = append(list, m)
	}
	writeJSON(w, 200, list)
}

func SetPlayerPassword(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if len(req.Password) < 8 {
		writeErr(w, 400, "password must be at least 8 characters")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, 500, "internal error")
		return
	}
	ctx := r.Context()
	tag, err := db.Pool.Exec(ctx, `UPDATE players SET password_hash=$2 WHERE handle=$1`, handle, string(hash))
	if err != nil || tag.RowsAffected() == 0 {
		writeErr(w, 404, "player not found")
		return
	}
	db.Pool.Exec(ctx, `INSERT INTO audit_log (actor, action, detail) VALUES ('admin','password_set',$1)`, handle)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func SetPlayerAdmin(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	var req struct {
		IsAdmin bool `json:"is_admin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	ctx := r.Context()
	tag, err := db.Pool.Exec(ctx, `UPDATE players SET is_admin=$2 WHERE handle=$1`, handle, req.IsAdmin)
	if err != nil || tag.RowsAffected() == 0 {
		writeErr(w, 404, "player not found")
		return
	}
	action := "admin_grant"
	if !req.IsAdmin {
		action = "admin_revoke"
	}
	db.Pool.Exec(ctx, `INSERT INTO audit_log (actor, action, detail) VALUES ('admin',$1,$2)`, action, handle)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func ResetPlayerScore(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	ctx := r.Context()
	db.Pool.Exec(ctx, `UPDATE scores SET points=0, kills=0, deaths=0 WHERE player_id=(SELECT id FROM players WHERE handle=$1)`, handle)
	db.Pool.Exec(ctx, `DELETE FROM kills WHERE attacker_id=(SELECT id FROM players WHERE handle=$1)`, handle)
	db.Pool.Exec(ctx, `INSERT INTO audit_log (actor, action, detail) VALUES ('admin','score_reset',$1)`, handle)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func ExpireHill(w http.ResponseWriter, r *http.Request) {
	ip := chi.URLParam(r, "ip")
	ctx := r.Context()
	var id, cid, kingID, machineType string
	var bounty int
	err := db.Pool.QueryRow(ctx, `
		SELECT id::text, COALESCE(container_id,''), COALESCE(king_player_id::text,''), bounty_pts,
		       COALESCE(machine_type,'docker')
		FROM koth_machines WHERE host(arena_ip)=$1 AND status='active'
	`, ip).Scan(&id, &cid, &kingID, &bounty, &machineType)
	if err != nil {
		writeErr(w, 404, "no active hill at that IP")
		return
	}

	if machineType == "ad" {
		// AD machines are permanent VMs - clear the king without expiring the machine
		var handle string
		db.Pool.QueryRow(ctx, `SELECT handle FROM players WHERE id=$1`, kingID).Scan(&handle)
		db.Pool.Exec(ctx, `
			UPDATE koth_machines SET king_player_id=NULL, king_handle=NULL, king_since=NULL WHERE id=$1
		`, id)
		if handle != "" {
			db.Pool.Exec(ctx, `INSERT INTO ticker_events (message) VALUES ($1)`,
				fmt.Sprintf("Operator cleared king on AD %s (was %s)", ip, handle))
		} else {
			db.Pool.Exec(ctx, `INSERT INTO ticker_events (message) VALUES ($1)`, "Operator cleared AD hill at "+ip)
		}
		writeJSON(w, 200, map[string]string{"ok": "true"})
		return
	}

	db.Pool.Exec(ctx, `UPDATE koth_machines SET status='expired' WHERE id=$1`, id)
	if cid != "" {
		go exec.Command("docker", "rm", "-f", cid).Run()
	}
	if kingID != "" {
		if pid, err := uuid.Parse(kingID); err == nil {
			scoring.AwardPoints(ctx, pid, bounty)
			var handle string
			db.Pool.QueryRow(ctx, `SELECT handle FROM players WHERE id=$1`, kingID).Scan(&handle)
			db.Pool.Exec(ctx, `INSERT INTO ticker_events (message) VALUES ($1)`,
				fmt.Sprintf("KOTH EXPIRED: %s holds throne +%d pts", handle, bounty))
		}
	} else {
		db.Pool.Exec(ctx, `INSERT INTO ticker_events (message) VALUES ($1)`, "Operator expired hill at "+ip)
	}
	AuditLog(ctx, "hill_expire", ip)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func ResetHill(w http.ResponseWriter, r *http.Request) {
	ip := chi.URLParam(r, "ip")
	ctx := r.Context()
	var hillID string
	err := db.Pool.QueryRow(ctx, `
		SELECT id::text
		FROM koth_machines WHERE host(arena_ip)=$1 AND status='active'
	`, ip).Scan(&hillID)
	if err != nil {
		writeErr(w, 404, "no active hill at that IP")
		return
	}
	db.Pool.Exec(ctx, `INSERT INTO audit_log (actor, action, detail) VALUES ('admin','hill_reset',$1)`, ip)

	id, err := uuid.Parse(hillID)
	if err != nil {
		writeErr(w, 500, "internal error")
		return
	}
	go func() {
		if err := koth.ResetHill(context.Background(), id); err != nil {
			log.Printf("admin ResetHill %s: %v", ip, err)
		}
	}()
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func DeletePlayer(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	ctx := r.Context()
	var playerID string
	if err := db.Pool.QueryRow(ctx, `SELECT id FROM players WHERE handle=$1`, handle).Scan(&playerID); err != nil {
		writeErr(w, 404, "player not found")
		return
	}
	// Clear FK references that don't cascade
	db.Pool.Exec(ctx, `DELETE FROM kills WHERE attacker_id=$1`, playerID)
	db.Pool.Exec(ctx, `DELETE FROM koth_holds WHERE player_id=$1`, playerID)
	db.Pool.Exec(ctx, `UPDATE koth_machines SET king_player_id=NULL, king_handle=NULL, king_since=NULL WHERE king_player_id=$1`, playerID)
	db.Pool.Exec(ctx, `UPDATE image_submissions SET player_id=NULL WHERE player_id=$1::uuid`, playerID)
	db.Pool.Exec(ctx, `DELETE FROM players WHERE handle=$1`, handle)
	db.Pool.Exec(ctx, `INSERT INTO audit_log (actor, action, detail) VALUES ('admin','player_delete',$1)`, handle)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func GetChatHistory(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, chat.GetHistory())
}

func DeleteChatMessage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !chat.DeleteMessage(id) {
		writeErr(w, 404, "message not found")
		return
	}
	AuditLog(r.Context(), "chat_message_delete", id)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func SendChatMessage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Text string `json:"text"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if strings.TrimSpace(req.Text) == "" {
		writeErr(w, 400, "empty message")
		return
	}
	m := chat.SendOperator(req.Text)
	db.Pool.Exec(r.Context(), `INSERT INTO audit_log (actor, action, detail) VALUES ('admin','chat_send',$1)`, m.Text)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

func TimeoutChatPlayer(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	var req struct {
		Minutes int `json:"minutes"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Minutes < 1 {
		req.Minutes = 15
	}
	if req.Minutes > 1440 {
		req.Minutes = 1440
	}
	chat.TimeoutPlayer(handle, req.Minutes)
	db.Pool.Exec(r.Context(), `INSERT INTO audit_log (actor, action, detail) VALUES ('admin','chat_timeout',$1)`,
		fmt.Sprintf("%s for %dm", handle, req.Minutes))
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

// ── Known issues (admin CRUD) ────────────────────────────────────────────────

var validIssueSeverity = map[string]bool{"CRITICAL": true, "HIGH": true, "LOW": true}

func ListKnownIssues(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Pool.Query(r.Context(), `
		SELECT id, severity, title, body, sort_order FROM known_issues
		ORDER BY sort_order ASC, id ASC
	`)
	list := []map[string]any{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id int64
			var sev, title, body string
			var order int
			if rows.Scan(&id, &sev, &title, &body, &order) == nil {
				list = append(list, map[string]any{"id": id, "severity": sev, "title": title, "body": body, "sort_order": order})
			}
		}
	}
	writeJSON(w, 200, map[string]any{"issues": list})
}

func CreateKnownIssue(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Severity  string `json:"severity"`
		Title     string `json:"title"`
		Body      string `json:"body"`
		SortOrder int    `json:"sort_order"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	req.Severity = strings.ToUpper(strings.TrimSpace(req.Severity))
	if !validIssueSeverity[req.Severity] {
		req.Severity = "LOW"
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" || len(req.Title) > 200 {
		writeErr(w, 400, "title required (max 200 chars)")
		return
	}
	if len(req.Body) > 4000 {
		req.Body = req.Body[:4000]
	}
	var id int64
	err := db.Pool.QueryRow(r.Context(),
		`INSERT INTO known_issues (severity, title, body, sort_order) VALUES ($1,$2,$3,$4) RETURNING id`,
		req.Severity, req.Title, strings.TrimSpace(req.Body), req.SortOrder).Scan(&id)
	if err != nil {
		writeErr(w, 500, "could not create")
		return
	}
	AuditLog(r.Context(), "known_issue_create", req.Title)
	writeJSON(w, 200, map[string]any{"id": id})
}

func UpdateKnownIssue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Severity  string `json:"severity"`
		Title     string `json:"title"`
		Body      string `json:"body"`
		SortOrder int    `json:"sort_order"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	req.Severity = strings.ToUpper(strings.TrimSpace(req.Severity))
	if !validIssueSeverity[req.Severity] {
		req.Severity = "LOW"
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" || len(req.Title) > 200 {
		writeErr(w, 400, "title required (max 200 chars)")
		return
	}
	if len(req.Body) > 4000 {
		req.Body = req.Body[:4000]
	}
	tag, err := db.Pool.Exec(r.Context(),
		`UPDATE known_issues SET severity=$1, title=$2, body=$3, sort_order=$4 WHERE id=$5`,
		req.Severity, req.Title, strings.TrimSpace(req.Body), req.SortOrder, id)
	if err != nil || tag.RowsAffected() == 0 {
		writeErr(w, 404, "issue not found")
		return
	}
	AuditLog(r.Context(), "known_issue_update", id)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func DeleteKnownIssue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	db.Pool.Exec(r.Context(), `DELETE FROM known_issues WHERE id=$1`, id)
	AuditLog(r.Context(), "known_issue_delete", id)
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ── Invite codes ─────────────────────────────────────────────────────────────

var slugRE = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = slugRE.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 20 {
		s = s[:20]
	}
	return s
}

func randHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

var validFeatureStatus = map[string]bool{
	"open": true, "planned": true, "in_progress": true, "done": true, "declined": true,
}

func ListFeatures(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Pool.Query(r.Context(), `
		SELECT f.id, f.handle, f.title, f.body, f.status, f.created_at,
		       COALESCE(SUM(v.vote),0) AS score, COALESCE(COUNT(v.vote),0) AS vote_count
		FROM feature_requests f
		LEFT JOIN feature_votes v ON v.feature_id = f.id
		GROUP BY f.id
		ORDER BY score DESC, f.created_at DESC
	`)
	list := []map[string]any{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, score, voteCount int64
			var handle, title, body, status string
			var createdAt time.Time
			if rows.Scan(&id, &handle, &title, &body, &status, &createdAt, &score, &voteCount) == nil {
				list = append(list, map[string]any{
					"id": id, "handle": handle, "title": title, "body": body,
					"status": status, "score": score, "vote_count": voteCount,
					"created_at": createdAt.Format(time.RFC3339),
				})
			}
		}
	}
	writeJSON(w, 200, map[string]any{"features": list})
}

func SetFeatureStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Status string `json:"status"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if !validFeatureStatus[req.Status] {
		writeErr(w, 400, "invalid status")
		return
	}
	tag, err := db.Pool.Exec(r.Context(), `UPDATE feature_requests SET status=$1 WHERE id=$2`, req.Status, id)
	if err != nil || tag.RowsAffected() == 0 {
		writeErr(w, 404, "feature not found")
		return
	}
	AuditLog(r.Context(), "feature_status", id+" → "+req.Status)
	writeJSON(w, 200, map[string]any{"ok": true, "status": req.Status})
}

func DeleteFeature(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	db.Pool.Exec(r.Context(), `DELETE FROM feature_requests WHERE id=$1`, id)
	AuditLog(r.Context(), "feature_delete", id)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func SetTickerSpeed(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PxPerSec int `json:"px_per_sec"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.PxPerSec < 5 {
		req.PxPerSec = 5
	}
	if req.PxPerSec > 500 {
		req.PxPerSec = 500
	}
	if err := settings.Set(r.Context(), "ticker_px_per_sec", fmt.Sprintf("%d", req.PxPerSec)); err != nil {
		writeErr(w, 500, "save failed")
		return
	}
	AuditLog(r.Context(), "ticker_speed", fmt.Sprintf("%d px/s", req.PxPerSec))
	writeJSON(w, 200, map[string]any{"ok": true, "px_per_sec": req.PxPerSec})
}

func SetChatSlowmode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Seconds int `json:"seconds"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	chat.SetSlowmode(req.Seconds)
	applied, _ := chat.ModerationState()
	AuditLog(r.Context(), "chat_slowmode", fmt.Sprintf("%ds", applied))
	writeJSON(w, 200, map[string]any{"ok": true, "seconds": applied})
}

func SetChatEmoteOnly(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	chat.SetEmoteOnly(req.Enabled)
	detail := "off"
	if req.Enabled {
		detail = "on"
	}
	AuditLog(r.Context(), "chat_emote_only", detail)
	writeJSON(w, 200, map[string]any{"ok": true, "enabled": req.Enabled})
}

func GetChatMode(w http.ResponseWriter, r *http.Request) {
	sec, on := chat.ModerationState()
	writeJSON(w, 200, map[string]any{"slowmode_seconds": sec, "emote_only": on})
}

func AuditLog(ctx context.Context, action, detail string) {
	db.Pool.Exec(ctx, `INSERT INTO audit_log (actor, action, detail) VALUES ('admin',$1,$2)`, action, detail)
}

func GetFeedback(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Pool.Query(r.Context(), `
		SELECT id, handle, host(arena_ip), image_name, stars, COALESCE(body,''), created_at
		FROM machine_feedback
		ORDER BY created_at DESC
		LIMIT 200
	`)
	if err != nil {
		log.Printf("admin GetFeedback: %v", err)
		writeErr(w, 500, "internal server error")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id int64
		var handle, ip, image, body string
		var stars int
		var createdAt time.Time
		rows.Scan(&id, &handle, &ip, &image, &stars, &body, &createdAt)
		list = append(list, map[string]any{
			"id": id, "handle": handle, "arena_ip": ip, "image_name": image,
			"stars": stars, "body": body, "created_at": createdAt,
		})
	}
	if list == nil {
		list = []map[string]any{}
	}
	writeJSON(w, 200, list)
}

// DeleteFeedback removes a single machine feedback entry (admin only).
func DeleteFeedback(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := db.Pool.Exec(r.Context(), `DELETE FROM machine_feedback WHERE id=$1`, id)
	if err != nil {
		log.Printf("admin DeleteFeedback %s: %v", id, err)
		writeErr(w, 500, "delete failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 404, "not found")
		return
	}
	db.Pool.Exec(r.Context(), `INSERT INTO audit_log (actor, action, detail) VALUES ('admin','feedback_delete',$1)`, id)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

// ClearFeedback nukes all machine feedback entries (admin only).
func ClearFeedback(w http.ResponseWriter, r *http.Request) {
	tag, err := db.Pool.Exec(r.Context(), `DELETE FROM machine_feedback`)
	if err != nil {
		log.Printf("admin ClearFeedback: %v", err)
		writeErr(w, 500, "clear failed")
		return
	}
	db.Pool.Exec(r.Context(), `INSERT INTO audit_log (actor, action, detail) VALUES ('admin','feedback_clear',$1)`, fmt.Sprintf("%d rows", tag.RowsAffected()))
	writeJSON(w, 200, map[string]any{"ok": true, "deleted": tag.RowsAffected()})
}

// PurgeScores zeroes all player scores and deletes all kill records.
func PurgeScores(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	db.Pool.Exec(ctx, `UPDATE scores SET points=0, kills=0, deaths=0`)
	db.Pool.Exec(ctx, `DELETE FROM kills`)
	db.Pool.Exec(ctx, `INSERT INTO audit_log (actor, action, detail) VALUES ('admin','purge_scores','all scores and kills cleared')`)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}

// PurgeActivity deletes all kill activity records without touching scores.
func PurgeActivity(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	db.Pool.Exec(ctx, `DELETE FROM kills`)
	db.Pool.Exec(ctx, `INSERT INTO audit_log (actor, action, detail) VALUES ('admin','purge_activity','kill activity log cleared')`)
	writeJSON(w, 200, map[string]string{"ok": "true"})
}
