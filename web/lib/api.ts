// Build-time API base - used at SSR + initial render so HTML matches between
// server and client (no hydration mismatch). For runtime adaptive behavior
// (LAN vs public access without router hairpin), call resolveRuntimeAPI()
// inside useEffect/event handlers - never at render time, or React will throw
// hydration errors and cause refetch storms (HTTP 429).
export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

export function resolveRuntimeAPI(): string {
  if (typeof window !== 'undefined' && window.location.hostname) {
    // On HTTPS (via Caddy), WebSocket goes through port 443 - use origin as-is.
    // On HTTP (local dev), API is on :8080.
    if (window.location.protocol === 'https:') {
      return window.location.origin
    }
    return `http://${window.location.hostname}:8080`
  }
  return API
}

export function wsURL(path: string) {
  // WS connects after mount - safe to use runtime resolution.
  const base = resolveRuntimeAPI().replace(/^http/, 'ws')
  return `${base}${path}`
}

// clearLocalSession wipes the client-side "logged in" markers. The real session
// is an HttpOnly cookie + a 24h server token; these localStorage hints (handle /
// agent token) never expire on their own, so clear them when the server says the
// session is gone - otherwise the UI keeps looking logged in after expiry.
export function clearLocalSession() {
  if (typeof window === 'undefined') return
  localStorage.removeItem('ck_player_handle')
  localStorage.removeItem('ck_agent_token')
}

// authFetch sends the HttpOnly session cookie via credentials: 'include'.
// The cookie is set by /login, /signup, /password-change, /reset-token responses.
// JS cannot read or set it, so an XSS payload can't exfiltrate the session.
// On a 401 it clears the stale local login markers so the client reflects the
// true (logged-out) state instead of showing a phantom session.
export async function authFetch(path: string, init?: RequestInit) {
  // Resolve the API at the host the user is actually browsing (not the build-time
  // baked host). This keeps the session cookie same-site: if the page is served
  // from one host and the API call goes to another, the browser treats the cookie
  // as cross-site and won't send it, which silently logs the user out.
  const url = path.startsWith('http') ? path : `${resolveRuntimeAPI()}${path}`
  const res = await fetch(url, { ...init, credentials: 'include' })
  if (res.status === 401) clearLocalSession()
  return res
}

export const TIER_COLOR: Record<string, string> = {
  easy:   '#22d3ee',
  medium: '#8b5cf6',
  hard:   '#e834c6',
}

export const TIER_LABEL: Record<string, string> = {
  easy:   'Easy',
  medium: 'Medium',
  hard:   'Hard',
}

// Public synthwave / ambient streams for the hub radio. External streams, so no
// backend is involved - the browser plays them directly.
export const RADIO_STATIONS = [
  { id: 'ebsm',        name: 'EBSM',                short: 'EBSM',        url: 'https://stream.nightride.fm/ebsm.mp3' },
  { id: 'nightride',   name: 'Nightride.fm',        short: 'Nightride',   url: 'https://stream.nightride.fm/nightride.mp3' },
  { id: 'darksynth',   name: 'Darksynth',           short: 'Darksynth',   url: 'https://stream.nightride.fm/darksynth.mp3' },
  { id: 'chillsynth',  name: 'Chillsynth FM',       short: 'Chillsynth',  url: 'https://stream.nightride.fm/chillsynth.mp3' },
  { id: 'datawave',    name: 'Datawave FM',          short: 'Datawave',    url: 'https://stream.nightride.fm/datawave.mp3' },
  { id: 'spacesynth',  name: 'Spacesynth FM',        short: 'Spacesynth',  url: 'https://stream.nightride.fm/spacesynth.mp3' },
  { id: 'horrorsynth', name: 'Horrorsynth',          short: 'Horror',      url: 'https://stream.nightride.fm/horrorsynth.mp3' },
  { id: 'nightwave',   name: 'Nightwave Plaza',      short: 'Nightwave',   url: 'https://radio.plaza.one/mp3' },
  { id: 'digitalis',   name: 'SomaFM: Digitalis',   short: 'Digitalis',   url: 'https://ice6.somafm.com/digitalis-128-mp3' },
  { id: 'dronezone',   name: 'SomaFM: Drone Zone',  short: 'Drone',       url: 'https://ice6.somafm.com/dronezone-128-mp3' },
] as const

