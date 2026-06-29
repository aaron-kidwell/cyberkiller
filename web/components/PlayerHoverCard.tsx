'use client'

import { useEffect, useState, useRef } from 'react'
import { API, resolveRuntimeAPI } from '../lib/api'

type Profile = {
  handle: string
  avatar_url?: string | null
  title?: string | null
  bio?: string | null
  color_accent?: string | null
  theme_preset?: string | null
  points?: number
  rank?: number
  kills?: number
  deaths?: number
  koth_crowns?: number
  login_streak?: number
}

const THEME_ACCENT: Record<string, string> = {
  neon_ghost: '#e834c6', synthwave: '#ff2ec4', matrix: '#00ff66',
  vaporwave: '#ff6ad5', acid: '#a3e635', midnight: '#22d3ee',
  bloodmoon: '#f43f5e', phosphor: '#7fffd4',
}

function profileAccent(p: Profile, fallback: string): string {
  if (p.color_accent && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(p.color_accent)) return p.color_accent
  if (p.theme_preset && THEME_ACCENT[p.theme_preset]) return THEME_ACCENT[p.theme_preset]
  return fallback
}

// Per-handle profile cache so repeated hovers don't re-fetch.
// 60s TTL is fine, profile stats don't change minute-to-minute.
type CacheEntry = { data: Profile | null; expires: number }
const profileCache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<Profile | null>>()

function fetchProfile(handle: string): Promise<Profile | null> {
  const now = Date.now()
  const hit = profileCache.get(handle)
  if (hit && hit.expires > now) return Promise.resolve(hit.data)
  const existing = inflight.get(handle)
  if (existing) return existing
  const p = fetch(`${resolveRuntimeAPI()}/player/${encodeURIComponent(handle)}`)
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      profileCache.set(handle, { data: d, expires: Date.now() + 60_000 })
      inflight.delete(handle)
      return d
    })
    .catch(() => {
      inflight.delete(handle)
      return null
    })
  inflight.set(handle, p)
  return p
}

type Props = {
  handle: string
  anchorRect: DOMRect
  accent?: string
  onClose: () => void
}

export function PlayerHoverCard({ handle, anchorRect, accent: anchorAccent = '#22d3ee', onClose }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchProfile(handle).then(p => {
      if (!alive) return
      setProfile(p)
      setLoading(false)
    })
    return () => { alive = false }
  }, [handle])

  // Pull accent from the fetched profile once loaded; until then use the
  // anchor (chat handle color) so the card opens with a sensible border.
  const accent = profile ? profileAccent(profile, anchorAccent) : anchorAccent

  // Position: prefer right of anchor; fall back to left if it would overflow.
  // Vertically anchored to the top of the row, clamped to viewport.
  const cardW = 280
  const cardH = 220
  const padding = 8
  let left = anchorRect.right + padding
  if (typeof window !== 'undefined' && left + cardW > window.innerWidth) {
    left = Math.max(padding, anchorRect.left - cardW - padding)
  }
  let top = anchorRect.top
  if (typeof window !== 'undefined' && top + cardH > window.innerHeight) {
    top = Math.max(padding, window.innerHeight - cardH - padding)
  }

  const initial = (handle[0] || '?').toUpperCase()

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => { /* keep open while pointer is on card */ }}
      onMouseLeave={onClose}
      style={{
        position: 'fixed',
        top,
        left,
        width: cardW,
        background: 'var(--panel, #0a0a14)',
        border: `1px solid ${accent}`,
        boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 24px ${accent}33`,
        padding: 14,
        zIndex: 1000,
        fontFamily: 'var(--body)',
        color: 'var(--txt)',
        pointerEvents: 'auto',
      }}
    >
      {loading && (
        <div style={{ fontSize: '0.72rem', color: 'var(--txt-dim)', letterSpacing: '0.1em' }}>LOADING…</div>
      )}
      {!loading && !profile && (
        <div style={{ fontSize: '0.78rem', color: 'var(--txt-dim)' }}>Player not found</div>
      )}
      {!loading && profile && (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
            <div style={{
              width: 56, height: 56, flexShrink: 0,
              border: `2px solid ${accent}`,
              background: 'rgba(255,255,255,0.04)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <span style={{ fontFamily: 'var(--hud)', color: accent, fontSize: '1.6rem' }}>{initial}</span>
              )}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{
                fontFamily: 'var(--hud)', color: accent,
                fontSize: '1.05rem', letterSpacing: '0.04em',
                textShadow: `0 0 8px ${accent}66`,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {profile.handle}
              </div>
              {profile.title && (
                <div style={{
                  fontSize: '0.78rem', color: 'var(--txt-dim)',
                  fontStyle: 'italic', marginTop: 3,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{profile.title}</div>
              )}
              {profile.rank ? (
                <div style={{ fontSize: '0.65rem', color: 'var(--txt-dim)', letterSpacing: '0.12em', marginTop: 4 }}>
                  RANK #{profile.rank}
                </div>
              ) : null}
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 6,
            marginBottom: 10,
          }}>
            <Stat label="PTS"   value={profile.points ?? 0}        accent={accent} />
            <Stat label="KILLS" value={profile.kills ?? 0}         accent={accent} />
            <Stat label="KOTH"  value={profile.koth_crowns ?? 0}   accent={accent} />
            <Stat label="STRK"  value={profile.login_streak ?? 0}  accent={accent} />
          </div>

          <a
            href={`/player/${profile.handle}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'block', textAlign: 'center',
              fontSize: '0.7rem', letterSpacing: '0.12em',
              padding: '6px 0', textDecoration: 'none',
              color: accent, border: `1px solid ${accent}44`,
            }}
          >
            VIEW PROFILE →
          </a>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div style={{
      background: `${accent}0d`, border: `1px solid ${accent}22`,
      padding: '6px 4px', textAlign: 'center',
    }}>
      <div style={{ fontFamily: 'var(--hud)', color: accent, fontSize: '0.95rem', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '0.52rem', color: 'var(--txt-dim)', letterSpacing: '0.1em', marginTop: 3 }}>{label}</div>
    </div>
  )
}
