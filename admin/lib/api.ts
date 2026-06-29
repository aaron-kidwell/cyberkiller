export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
export const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || 'https://cyberkiller.net'

// Resolve the API at the host the panel is actually served from, so it works
// however the operator reaches it (localhost, tunnel, or LAN IP) without a
// build-time baked host. HTTPS (behind a proxy) uses the same origin.
export function resolveRuntimeAPI(): string {
  if (typeof window !== 'undefined' && window.location.hostname) {
    if (window.location.protocol === 'https:') return window.location.origin
    return `http://${window.location.hostname}:8080`
  }
  return API
}

export function getAdminCreds() {
  if (typeof window === 'undefined') return { user: '', pass: '' }
  return {
    user: localStorage.getItem('ck_admin_user') || '',
    pass: localStorage.getItem('ck_admin_pass') || '',
  }
}

export function saveAdminCreds(user: string, pass: string) {
  localStorage.setItem('ck_admin_user', user)
  localStorage.setItem('ck_admin_pass', pass)
}

export function clearAdminCreds() {
  localStorage.removeItem('ck_admin_user')
  localStorage.removeItem('ck_admin_pass')
}

export function adminHeaders(extra?: Record<string, string>) {
  const { user, pass } = getAdminCreds()
  return {
    'Content-Type': 'application/json',
    'X-Admin-User': user,
    'X-Admin-Pass': pass,
    ...extra,
  }
}

export async function adminFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${resolveRuntimeAPI()}${path}`, {
    ...init,
    headers: { ...adminHeaders(), ...init?.headers },
  })
  if (res.status === 401) {
    clearAdminCreds()
    if (typeof window !== 'undefined') window.location.href = '/login'
    throw new Error('unauthorized')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'request failed')
  }
  return res.json()
}
