package chat

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"sync"
	"time"
)

// 7TV emote sets - pulled periodically and exposed to the chat client.
// Map is name → CDN URL of the 2x.webp variant (64×64), which animates natively
// in <img> tags and is small enough for chat.
//
// Sources are merged in order; later sources override earlier ones on name
// collision. Each source can optionally filter out emotes by name regex.

type emoteSource struct {
	id   string         // 7TV emote set ID
	deny *regexp.Regexp // drop emotes whose name matches (case-insensitive); nil = keep all
}

// streamerFaces removes emotes that are just streamer faces / niche persona
// memes. Keeps universal reactions (KEKW, PepeHands, peepoSad, monkaW, etc).
var streamerFaces = regexp.MustCompile(`(?i)` +
	`fors|batfors|copesen` + // forsen
	`|paja|pajlad` + // pajlada
	`|leppunen|aiden|gabew|gabenget|ibana[n]?` + // misc streamers
	`|lookingatyou|envoylook|mason|offworlder|oompa|donaldpls` + // "looking at you" persona series
	`|borgir|gayge|dentist`,
)

// safeEmoteName - only allow plain identifiers so 7TV-uploaded emotes with
// HTML-like names (e.g. "<table><tr>...Bedge") or numeric-spam can't slip
// into the picker. React would escape them anyway, but cleaner to drop.
var safeEmoteName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,31}$`)

// pinnedEmotes - individually curated emotes that always appear regardless of
// what's in the source sets. name → 7TV emote ID.
var pinnedEmotes = map[string]string{
	"catJAM": "01F6MQ33FG000FFJ97ZB8MWV52",
	"ratJAM": "01F6QV6G8R0000TEKRM6BFG0Z3",
}

var emoteSources = []emoteSource{
	// Forsen's curated set - 255 emotes, great Twitch-culture base. Drop
	// forsen/pajlada/etc-named faces.
	{id: "01HYKFJXVG000A9JQ25Y1DG5SJ", deny: streamerFaces},
	// Pajlada's set - dance/JAM/clap memes (gachiJAM, gopherDance, etc).
	{id: "01F7GF1ZV8000EFV6JZ29CKEDB", deny: streamerFaces},
	// 7TV global set - universal community emotes layered on top last so
	// canonical names win on collision.
	{id: "global", deny: streamerFaces},
}

const (
	emoteRefresh    = 6 * time.Hour
	emoteHTTPClient = 30 * time.Second
)

var (
	emotesMu sync.RWMutex
	emotes   = map[string]string{}
)

type sevenTVResponse struct {
	Emotes []struct {
		Name string `json:"name"`
		Data struct {
			Host struct {
				URL   string `json:"url"`
				Files []struct {
					Name string `json:"name"`
				} `json:"files"`
			} `json:"host"`
		} `json:"data"`
	} `json:"emotes"`
}

// Emotes returns a snapshot of the cached 7TV global emote map.
func Emotes() map[string]string {
	emotesMu.RLock()
	defer emotesMu.RUnlock()
	out := make(map[string]string, len(emotes))
	for k, v := range emotes {
		out[k] = v
	}
	return out
}

// EmotesHandler serves the cached emote map as JSON.
func EmotesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	json.NewEncoder(w).Encode(Emotes())
}

// StartEmoteFetcher kicks off a background goroutine that refreshes the emote
// map from 7TV on startup and every emoteRefresh thereafter.
func StartEmoteFetcher() {
	go func() {
		// First fetch is best-effort; failure leaves the map empty and the
		// frontend falls back to its built-in unicode set.
		// Retry a few times on startup - container DNS often isn't ready immediately.
		for attempt := 1; attempt <= 5; attempt++ {
			if err := refreshEmotes(context.Background()); err != nil {
				log.Printf("[chat] 7TV fetch attempt %d failed: %v", attempt, err)
				time.Sleep(time.Duration(attempt) * 5 * time.Second)
				continue
			}
			break
		}
		t := time.NewTicker(emoteRefresh)
		defer t.Stop()
		for range t.C {
			if err := refreshEmotes(context.Background()); err != nil {
				log.Printf("[chat] 7TV refresh failed: %v", err)
			}
		}
	}()
}

func fetchEmoteSet(ctx context.Context, id string) (*sevenTVResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, emoteHTTPClient)
	defer cancel()
	url := "https://7tv.io/v3/emote-sets/" + id
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("User-Agent", "cyberkiller-chat/1.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var parsed sevenTVResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	return &parsed, nil
}

func refreshEmotes(ctx context.Context) error {
	next := make(map[string]string, 256)
	var anyOK bool
	for _, src := range emoteSources {
		parsed, err := fetchEmoteSet(ctx, src.id)
		if err != nil {
			log.Printf("[chat] 7TV fetch %s failed: %v", src.id, err)
			continue
		}
		anyOK = true
		kept := 0
		for _, e := range parsed.Emotes {
			if e.Name == "" || e.Data.Host.URL == "" {
				continue
			}
			if !safeEmoteName.MatchString(e.Name) {
				continue
			}
			if src.deny != nil && src.deny.MatchString(e.Name) {
				continue
			}
			next[e.Name] = "https:" + e.Data.Host.URL + "/2x.webp"
			kept++
		}
		log.Printf("[chat] 7TV set %s: %d/%d kept after filter", src.id, kept, len(parsed.Emotes))
	}
	if !anyOK {
		return context.DeadlineExceeded
	}
	// Pinned emotes always present - built from a hardcoded URL pattern, no
	// extra fetch needed since 7TV CDN URLs are stable for a given emote ID.
	for name, id := range pinnedEmotes {
		next[name] = "https://cdn.7tv.app/emote/" + id + "/2x.webp"
	}
	emotesMu.Lock()
	emotes = next
	emotesMu.Unlock()
	log.Printf("[chat] emote map refreshed: %d total (incl. %d pinned)", len(next), len(pinnedEmotes))
	return nil
}

// kept for compatibility with the legacy single-source path (no longer used)
func legacyParse(parsed *sevenTVResponse, next map[string]string) {
	for _, e := range parsed.Emotes {
		if e.Name == "" || e.Data.Host.URL == "" {
			continue
		}
		next[e.Name] = "https:" + e.Data.Host.URL + "/2x.webp"
	}
}
