'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { API, TIER_COLOR, TIER_LABEL, authFetch, resolveRuntimeAPI } from '../lib/api'
import { ArenaChat } from './ArenaChat'
import { RadioBar } from './RadioBar'
import { ShareCard } from './ShareCard'
import { deriveBadges } from '../lib/badges'

type Machine = {
  type: string
  arena_ip: string
  tier: string
  cred_hint?: string
  intel_hint?: string
  has_intel?: boolean
  king_handle?: string
  king_since_secs?: number
  bounty_pts?: number
  ttl_secs?: number
  image_name?: string
  open_ports?: { port: number; service: string }[]
  ports_on_host?: boolean
  koth?: boolean
  user_flag_points?: number
  root_flag_points?: number
  user_flag_captured?: boolean
  root_flag_captured?: boolean
  user_flag_by?: string
  root_flag_by?: string
  avg_stars?: number
  reset_votes?: number
  reset_threshold?: number
  my_reset_vote?: boolean
  admin_flag_points?: number
  admin_flag_captured?: boolean
  // AD-specific
  os?: string
  ad_domain?: string
  is_domain_controller?: boolean
  health_ok?: boolean
}

type Stats = {
  online_players: number
  active_targets: number
  kills_24h: number
  updated_at?: string
  user_flag_points?: number
  root_flag_points?: number
  connected?: Array<{ handle: string }>
  ticker_px_per_sec?: number
}

function fmtSecs(s: number) {
  if (s < 0) s = 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function useTickingValue(serverVal: number, direction: 'down' | 'up' = 'down') {
  const [val, setVal] = useState(serverVal)
  const serverRef = useRef(serverVal)

  useEffect(() => {
    serverRef.current = serverVal
    setVal(serverVal)
  }, [serverVal])

  useEffect(() => {
    const t = setInterval(() => {
      setVal(v => direction === 'down' ? Math.max(0, v - 1) : v + 1)
    }, 1000)
    return () => clearInterval(t)
  }, [direction])

  return val
}

function KingTimer({ secs }: { secs: number }) {
  const display = useTickingValue(secs, 'up')
  return <span style={{ fontSize: '0.68rem', color: 'var(--txt-dim)', fontFamily: 'var(--hud)' }}>{fmtSecs(display)} held</span>
}

function CardTTL({ secs }: { secs: number }) {
  const display = useTickingValue(secs)
  const urgent = display < 300
  return (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: '0.62rem', color: 'var(--txt-dim)', letterSpacing: '0.08em' }}>EXPIRES IN</span>
      <span style={{ fontFamily: 'var(--hud)', fontSize: '0.72rem', color: urgent ? 'var(--red)' : 'var(--txt-dim)' }}>
        {fmtSecs(Math.max(0, display))}
      </span>
    </div>
  )
}

// fmtHeld renders how long the current king has held a hill, e.g. "4m" or "1h 2m".
function fmtHeld(secs: number): string {
  if (secs < 60) return `${secs}s`
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function FeedbackWidget({ arenaIP, imageName, handle, currentStars = 0 }: {
  arenaIP: string; imageName: string; handle: string; currentStars?: number
}) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(0)
  const [stars, setStars] = useState(0)
  const [body, setBody] = useState('')
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!stars) return
    setSubmitting(true)
    try {
      await fetch(`${resolveRuntimeAPI()}/koth/feedback`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arena_ip: arenaIP, image_name: imageName, stars, body }),
      })
      setDone(true)
      setOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) return (
    <div style={{ marginTop: 10, fontSize: '0.7rem', color: 'var(--green)' }}>✓ Feedback sent</div>
  )

  const displayStars = currentStars > 0 ? currentStars : 0

  return (
    <div style={{ marginTop: 10 }}>
      {!open ? (
        <button
          onClick={() => { setOpen(true); if (displayStars && !stars) setStars(displayStars) }}
          style={{
            background: 'none', border: '1px solid var(--border)', cursor: 'pointer',
            padding: '3px 8px', fontSize: '0.68rem', color: 'var(--txt-dim)',
            letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <span style={{ color: 'var(--amber)', letterSpacing: 1 }}>
            {'★'.repeat(displayStars)}{'☆'.repeat(5 - displayStars)}
          </span>
          <span>{displayStars > 0 ? 'Rated' : 'Rate'}</span>
        </button>
      ) : (
        <div style={{
          background: 'var(--panel)', border: '1px solid var(--border)',
          padding: '10px 12px', marginTop: 4,
        }}>
          <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
            {[1,2,3,4,5].map(n => (
              <button
                key={n}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setStars(n)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '1.2rem', padding: '0 1px',
                  color: n <= (hover || stars) ? 'var(--amber)' : 'var(--txt-dim)',
                  transition: 'color 0.1s',
                }}
              >★</button>
            ))}
            {stars > 0 && (
              <span style={{ fontSize: '0.65rem', color: 'var(--txt-dim)', alignSelf: 'center', marginLeft: 4 }}>
                {['','Terrible','Bad','OK','Good','Great'][stars]}
              </span>
            )}
          </div>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Comments (optional)…"
            maxLength={500}
            rows={2}
            style={{
              width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
              color: 'var(--txt)', padding: '6px 8px', fontSize: '0.75rem',
              resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button
              onClick={submit}
              disabled={!stars || submitting}
              style={{
                background: stars ? 'var(--cyan)' : 'var(--border)', border: 'none',
                color: stars ? 'var(--bg)' : 'var(--txt-dim)', cursor: stars ? 'pointer' : 'default',
                padding: '4px 12px', fontSize: '0.7rem', letterSpacing: '0.05em',
              }}
            >
              {submitting ? 'Sending…' : 'Send'}
            </button>
            <button
              onClick={() => { setOpen(false); setStars(0); setBody('') }}
              style={{
                background: 'none', border: '1px solid var(--border)', cursor: 'pointer',
                padding: '4px 10px', fontSize: '0.7rem', color: 'var(--txt-dim)',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Content-aware ticker: measures the rendered width of one half and sets the
// animation duration so the scroll speed stays constant in pixels-per-second,
// regardless of how many items are in the feed. Speed is admin-controlled via
// /admin/ticker/speed (stored in settings.ticker_px_per_sec).
function Ticker({
  items,
  colorFor,
  relTime,
  pxPerSec,
}: {
  items: { message: string; at: string }[]
  colorFor: (msg: string) => string
  relTime: (at: string) => string
  pxPerSec: number
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [duration, setDuration] = useState(60)

  useEffect(() => {
    if (!innerRef.current) return
    const measure = () => {
      const half = innerRef.current?.querySelector('.ticker-half') as HTMLElement | null
      if (!half) return
      const w = half.offsetWidth
      if (w > 0) setDuration(Math.max(15, w / Math.max(5, pxPerSec)))
    }
    measure()
    // Re-measure on window resize so layout changes (sidebar collapse, etc.)
    // don't break the speed. ResizeObserver on the half catches font-load
    // reflow too.
    const ro = new ResizeObserver(measure)
    const half = innerRef.current.querySelector('.ticker-half')
    if (half) ro.observe(half)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [items, pxPerSec])

  return (
    <div className="ticker" style={{ flexShrink: 0 }}>
      <div className="ticker-inner" ref={innerRef} style={{ animationDuration: `${duration}s` }}>
        {[0, 1].map(half => (
          <div className="ticker-half" key={half} aria-hidden={half === 1}>
            {items.map((ev, i) => (
              <span key={i} style={{ color: colorFor(ev.message) }}>
                {ev.message}
                {ev.at && <span style={{ color: 'var(--txt-dim)', fontSize: '0.75em', marginLeft: 4 }}>{relTime(ev.at)}</span>}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function HubApp() {
  const [tab, setTab] = useState<'radar' | 'activity' | 'scores' | 'scoring' | 'rules'>('radar')
  const [machines, setMachines] = useState<Machine[]>([])
  const [activity, setActivity] = useState<{ hot: any[]; kills: any[]; flags: any[] }>({ hot: [], kills: [], flags: [] })
  const [scores, setScores] = useState<any[]>([])
  const [cardEvent, setCardEvent] = useState<{ headline: string; subline: string } | null>(null)
  const [sitrep, setSitrep] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [ticker, setTicker] = useState<{ message: string; at: string }[]>([])
  // Achievement toasts (bottom-right): fire on the viewer's own capture / first-blood / bounty / new badge.
  const [toasts, setToasts] = useState<{ id: number; glyph: string; title: string; detail: string }[]>([])
  const prevPts = useRef<number | null>(null)
  const prevBadgeIds = useRef<Set<string> | null>(null)
  const toastSeq = useRef(0)
  const pushToast = useCallback((glyph: string, title: string, detail: string) => {
    const id = ++toastSeq.current
    setToasts(t => [...t.slice(-3), { id, glyph, title, detail }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6000)
  }, [])
  const [hudTime, setHudTime] = useState('')
  const [hudCopied, setHudCopied] = useState(false)
  const [handle, setHandle] = useState('')
  // inviteToken state is gone, session lives in an HttpOnly cookie. Where the
  // UI previously checked `inviteToken &&` to mean "is logged in", we now check
  // `handle &&` (handle is set the same way in localStorage on login).
  // Kept as an inert no-op for now to avoid touching every JSX reference.
  const inviteToken = handle // truthy iff logged in
  const [sessionExpired, setSessionExpired] = useState(false)
  // Init null - stable across SSR and the first client render. Reading localStorage in
  // the initializer made SSR render null (login gate) but the client render false
  // (connecting), an instant hydration mismatch -> React #422 that crashed the whole
  // hub. The mount effect below re-seeds from localStorage AFTER hydration (no flash).
  const [connected, setConnected] = useState<boolean | null>(null)
  // Gate the entire hub render until mounted client-side: SSR and the first client
  // render are then identical (a stable loader), which eliminates EVERY possible
  // hydration mismatch (localStorage, Date/relative-time, window.location, etc.) that
  // could throw React #422 and crash the hub. The hub is an authed dashboard, so
  // client-only render costs nothing.
  const [mounted, setMounted] = useState(false)
  // Track whether we've done at least one successful poll yet (so we show a brief
  // loading state instead of the sign-in gate before we know).
  const [firstPollDone, setFirstPollDone] = useState(false)
  const [resetVoting, setResetVoting] = useState<Record<string, boolean>>({})
  const [resetVoted, setResetVoted] = useState<Record<string, boolean>>({})
  const [rangeVotes, setRangeVotes] = useState<{ votes: number; threshold: number } | null>(null)
  const [rangeResetVoting, setRangeResetVoting] = useState(false)
  const [rangeResetVoted, setRangeResetVoted] = useState(false)
  const [rangeResetConfirming, setRangeResetConfirming] = useState(false)
  const rangeConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [resetToast, setResetToast] = useState('')

  // Auto-generate a context-aware sitrep from live state.
  // Falls back to the admin-set message only when it contains something custom.
  const displaySitrep = useMemo(() => {
    const DEFAULT_PREFIXES = ['arena standing by', 'arena online']
    const isDefault = !sitrep || DEFAULT_PREFIXES.some(p => sitrep.toLowerCase().startsWith(p))

    const allMachines = machines.filter(m => m.type === 'corp' || m.type === 'koth' || m.type === 'target')
    const online = stats?.online_players ?? 0

    if (allMachines.length === 0) {
      if (!isDefault) return sitrep
      return online > 0
        ? `${online} operator${online !== 1 ? 's' : ''} online, arena standing by, machines not yet live`
        : 'Arena standing by, no operators connected'
    }

    if (!isDefault) return sitrep

    const kings = allMachines.filter(m => m.king_handle)
    const parts: string[] = []

    if (kings.length === 0) {
      parts.push(`${allMachines.length} machine${allMachines.length !== 1 ? 's' : ''} live, throne is empty`)
    } else if (kings.length === 1) {
      const k = kings[0]
      const label = k.ad_domain ? k.ad_domain.split('.')[0].toUpperCase() : (k.tier?.toUpperCase() ?? k.image_name ?? 'HILL')
      parts.push(`${k.king_handle} is king of ${label}`)
    } else {
      const top = [...kings].sort((a, b) => (b.king_since_secs ?? 0) - (a.king_since_secs ?? 0))[0]
      const contested = kings.length
      parts.push(`${top.king_handle} leads · ${contested} hill${contested !== 1 ? 's' : ''} contested`)
    }

    if (online > 0) parts.push(`${online} operator${online !== 1 ? 's' : ''} engaged`)

    if ((stats?.kills_24h ?? 0) > 0) parts.push(`${stats!.kills_24h} kill${stats!.kills_24h !== 1 ? 's' : ''} in 24h`)

    return parts.join(' · ')
  }, [sitrep, machines, stats])

  function tickerColor(msg: string): string {
    const m = msg.toLowerCase()
    if (m.includes('flag') || m.includes('captured') || m.includes('root') || m.includes('user_flag') || m.includes('admin_flag')) return 'var(--green)'
    if (m.includes('king') || m.includes('holding') || m.includes('bounty') || m.includes('throne')) return 'var(--mag)'
    if (m.includes('reset') || m.includes('domain') || m.includes('provisioning') || m.includes('live')) return 'var(--red)'
    if (m.includes('joined') || m.includes('connected') || m.includes('online')) return 'var(--cyan)'
    if (m.includes('intel') || m.includes('drop')) return 'var(--yellow, #facc15)'
    return 'var(--txt-dim)'
  }

  function relTime(at: string): string {
    const diff = Math.floor((Date.now() - new Date(at).getTime()) / 1000)
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    return `${Math.floor(diff / 3600)}h ago`
  }

  useEffect(() => {
    setMounted(true)
    // Re-seed connected from localStorage AFTER hydration (safe here - client only).
    // Avoids the login-gate flash for logged-in users without an SSR/client mismatch.
    if (localStorage.getItem('ck_player_handle')) setConnected(c => (c === null ? false : c))
    setHandle(localStorage.getItem('ck_player_handle') || '')
    // ISO 8601 UTC, second precision (e.g. 2026-06-15T13:57:59Z).
    const tick = () => setHudTime(new Date().toISOString().replace(/\.\d+Z$/, 'Z'))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  const refresh = useCallback(async () => {
    try {
      // Fetch arena/stats separately so we can detect 401 (session expired) and
      // surface a banner instead of silently degrading to "agent offline".
      const statsResp = await authFetch(`/arena/stats`)
      if (statsResp.status === 401) {
        // Session cookie expired/stale. The early return below skips the
        // connected-state logic AND setFirstPollDone, which otherwise leaves the
        // hub hung on "CONNECTING TO ARENA" forever. Surface the login prompt
        // instead (connected=null renders the sign-in screen).
        setSessionExpired(true)
        setConnected(null)
        setFirstPollDone(true)
        return
      }
      setSessionExpired(false)
      const [r, a, s, sit, st, tick, rrv] = await Promise.all([
        authFetch(`/radar`).then(x => x.json()),
        authFetch(`/activity`).then(x => x.json()),
        authFetch(`/scores`).then(x => x.json()),
        authFetch(`/sitrep/latest`).then(x => x.json()),
        statsResp.json(),
        authFetch(`/ticker/events`).then(x => x.json()),
        authFetch(`/range-reset/votes`).then(x => x.json()).catch(() => null),
      ])
      setMachines(r.machines || [])
      setActivity(a)
      setScores(s.leaderboard || [])
      // Achievement toasts for the viewing player: diff their points (capture / first-blood
      // / bounty) and their derived badges since the last poll. Skips the first poll.
      // Wrapped in its own try: this is cosmetic. A throw here (e.g. deriveBadges on
      // unexpected leaderboard data) must NOT break the poll, or firstPollDone never
      // gets set and the hub hangs forever on "CONNECTING TO ARENA".
      try {
        const myH = localStorage.getItem('ck_player_handle') || ''
        const meRow = myH ? (s.leaderboard || []).find((e: any) => e.handle === myH) : null
        if (meRow) {
          const pts = meRow.points ?? 0
          if (prevPts.current !== null && pts > prevPts.current) {
            const delta = pts - prevPts.current
            const caps = [...(a.flags || []), ...(a.kills || [])].filter((c: any) => c.handle === myH)
            if (caps.some((c: any) => c.first_blood)) pushToast('🩸', 'FIRST BLOOD', `+${delta} pts`)
            else if (caps.length) pushToast('🚩', 'FLAG CAPTURED', `+${delta} pts`)
            else pushToast('👑', 'BOUNTY', `+${delta} pts`)
          }
          prevPts.current = pts
          const myBadges = deriveBadges({ points: pts, kills: meRow.kills, koth_crowns: meRow.koth_crowns, rank: meRow.rank } as any)
          const ids = new Set(myBadges.map(b => b.id))
          if (prevBadgeIds.current !== null) {
            myBadges.forEach(b => { if (!prevBadgeIds.current!.has(b.id)) pushToast(b.glyph, 'NEW BADGE', b.label) })
          }
          prevBadgeIds.current = ids
        }
      } catch (e) { console.error('[hub] badge/toast processing skipped (non-fatal):', e) }
      setSitrep(sit.message || '')
      setStats(st)
      if (rrv) setRangeVotes(rrv)
      setTicker(tick.events || [])
      // null = not logged in (sign-in gate); true = logged in (show the hub).
      // There is no agent: being logged in is all it takes to be "in".
      const h = localStorage.getItem('ck_player_handle')
      if (!h) {
        setConnected(null)
        setHandle('')
      } else {
        setHandle(h)
        setConnected(true)
        // Presence ping so the online count reflects who has the hub open.
        fetch(`${resolveRuntimeAPI()}/heartbeat`, { method: 'POST', credentials: 'include' }).catch(() => {})
      }
    } catch (e) {
      console.error('[hub] poll failed:', e)
    } finally {
      // ALWAYS mark the first poll done - even on error - so the hub can never hang
      // on "CONNECTING TO ARENA". On error it falls through to the agent/login state.
      setFirstPollDone(true)
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [refresh])

  const voteReset = async (arenaIP: string) => {
    if (!handle) return
    if (!confirm(`Vote to reset ${arenaIP}?\n\nThis rolls the machine back to its clean state for everyone once enough players vote. Any progress on it is wiped.`)) return
    setResetVoting(v => ({ ...v, [arenaIP]: true }))
    try {
      const r = await fetch(`${resolveRuntimeAPI()}/koth/${arenaIP}/vote-reset`, {
        method: 'POST',
        credentials: 'include',
      })
      const d = await r.json()
      if (r.ok) {
        if (d.reset) {
          setResetVoted(v => ({ ...v, [arenaIP]: false }))
          setMachines(ms => ms.map(m =>
            m.arena_ip === arenaIP
              ? { ...m, reset_votes: 0, reset_threshold: d.threshold, my_reset_vote: false, king_handle: '', king_since_secs: 0 }
              : m
          ))
          setResetToast(`Vote passed, ${arenaIP} is resetting, back shortly`)
          setTimeout(() => setResetToast(''), 6000)
        } else if (typeof d.cooldown_secs === 'number' && d.cooldown_secs > 0) {
          setResetToast(`Reset on cooldown, try again in ${d.cooldown_secs}s`)
          setTimeout(() => setResetToast(''), 5000)
        } else {
          setResetVoted(v => ({ ...v, [arenaIP]: true }))
          setMachines(ms => ms.map(m =>
            m.arena_ip === arenaIP ? { ...m, reset_votes: d.votes, reset_threshold: d.threshold, my_reset_vote: true } : m
          ))
          setResetToast(`Reset vote recorded, ${d.votes}/${d.threshold}`)
          setTimeout(() => setResetToast(''), 4000)
        }
      } else {
        console.error('[vote-reset]', r.status, d?.error)
      }
    } catch (e) {
      console.error('[vote-reset] fetch failed:', e)
    } finally {
      setResetVoting(v => ({ ...v, [arenaIP]: false }))
    }
  }

  const voteRangeReset = async () => {
    if (!handle) return
    if (!rangeResetConfirming) {
      setRangeResetConfirming(true)
      if (rangeConfirmTimer.current) clearTimeout(rangeConfirmTimer.current)
      rangeConfirmTimer.current = setTimeout(() => setRangeResetConfirming(false), 4000)
      return
    }
    setRangeResetConfirming(false)
    if (rangeConfirmTimer.current) clearTimeout(rangeConfirmTimer.current)
    setRangeResetVoting(true)
    try {
      const r = await fetch(`${resolveRuntimeAPI()}/range-reset/vote`, {
        method: 'POST',
        credentials: 'include',
      })
      const d = await r.json()
      if (r.ok) {
        setRangeVotes({ votes: d.votes, threshold: d.threshold })
        if (d.reset) {
          setRangeResetVoted(false)
        } else {
          setRangeResetVoted(true)
        }
      } else {
        console.error('[range-reset]', r.status, d?.error)
      }
    } catch (e) {
      console.error('[range-reset] fetch failed:', e)
    } finally {
      setRangeResetVoting(false)
    }
  }

  const targets = machines.filter(m => m.type === 'target')
  const hills = machines.filter(m => m.type === 'koth')
  // Corp (MERIDIAN) boxes are Linux network nodes - rendered with king/flags/connect.
  const adMachines = machines.filter(m => m.type === 'corp')
  const ttlPct = (secs: number, max = 2700) => Math.min(100, Math.max(0, (secs / max) * 100))


  // Until mounted client-side, render a stable loader identical on server + client.
  // This is what guarantees no hydration mismatch can crash the hub (React #422).
  if (!mounted) {
    return (
      <div className="hub-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ color: 'var(--txt-dim)', fontFamily: 'var(--hud)', fontSize: '0.8rem', letterSpacing: '0.15em' }}>⟳ LOADING…</div>
      </div>
    )
  }

  if (connected === null) {
    return (
      <div className="hub-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="ck-reveal" style={{ maxWidth: 440, textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontFamily: 'var(--hud)', fontSize: '0.65rem', color: 'var(--mag)', letterSpacing: '0.2em', marginBottom: 16 }}>
            ACCESS RESTRICTED
          </div>
          <h2 style={{ fontFamily: 'var(--hud)', fontSize: '1.4rem', color: 'var(--txt-bright)', marginBottom: 12 }}>
            Operatives only
          </h2>
          <p style={{ fontFamily: 'var(--body)', color: 'var(--txt-dim)', fontSize: '0.9rem', lineHeight: 1.7, marginBottom: 28 }}>
            Sign in to access the arena hub.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/signup" className="btn-mag" style={{ width: 'auto' }}>REGISTER →</Link>
            <Link href="/login" className="btn-mag"
              style={{ background: 'transparent', color: 'var(--cyan)', border: '1px solid var(--cyan)', width: 'auto' }}>
              LOGIN →
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Loading state: we have a handle but haven't done the first stats poll yet
  if (connected === false && !firstPollDone) {
    return (
      <div className="hub-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--txt-dim)', fontFamily: 'var(--hud)', fontSize: '0.8rem', letterSpacing: '0.15em' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ck-ghost.png" alt="" aria-hidden className="connect-ghost"
            style={{ width: 110, height: 'auto', display: 'block', margin: '0 auto 20px' }} />
          ⟳ CONNECTING TO ARENA…
        </div>
      </div>
    )
  }

  return (
    <div className="hub-app">
      {/* Reset-vote toast (vote recorded / passed) */}
      {resetToast && (
        <div style={{
          position: 'fixed', bottom: 32, right: 32, zIndex: 9001,
          background: '#0a0014', border: '2px solid var(--cyan)',
          padding: '14px 22px', borderRadius: 4,
          boxShadow: '0 0 24px rgba(0,200,255,0.25)',
          animation: 'fadeIn 0.3s ease',
        }}>
          <span style={{ fontFamily: 'var(--hud)', fontSize: '0.82rem', color: 'var(--cyan)', letterSpacing: '0.08em' }}>
            ↺ {resetToast}
          </span>
        </div>
      )}

      {/* Achievement toasts (capture / first-blood / bounty / new badge) - bottom-right stack */}
      {toasts.length > 0 && (
        <div style={{ position: 'fixed', bottom: 32, right: 32, zIndex: 9002, display: 'flex', flexDirection: 'column-reverse', gap: 10, pointerEvents: 'none' }}>
          {toasts.map(t => (
            <div key={t.id} style={{
              background: '#0e0a18', border: '2px solid var(--mag)',
              padding: '12px 18px', boxShadow: '0 0 24px rgba(232,52,198,0.35)',
              display: 'flex', alignItems: 'center', gap: 12, minWidth: 200,
              animation: 'fadeIn 0.3s ease',
            }}>
              <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>{t.glyph}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontFamily: 'var(--hud)', fontSize: '0.8rem', color: 'var(--mag)', letterSpacing: '0.1em' }}>{t.title}</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--txt-bright)' }}>{t.detail}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* SITREP, if the message already starts with its own ALLCAPS label
          (e.g. "SIGINT, ...", "INTEL, ..."), use that instead of "SITREP". */}
      {(() => {
        const m = displaySitrep.match(/^([A-Z]{3,10})\s*[--]\s*(.*)/)
        const label = m ? m[1] : 'SITREP'
        const body = m ? m[2] : displaySitrep
        return (
          <div className="hub-sitrep">
            <strong style={{ color: 'var(--mag)', marginRight: 8 }}>{label}</strong>
            {body}
          </div>
        )
      })()}

      {/* HUD bar */}
      <div className="hub-hud">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span className="hud-label">ARENA HUB</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--txt-dim)' }}>
            <span className="live-dot" />LIVE
          </span>
          <span
            onClick={() => {
              navigator.clipboard?.writeText(hudTime)
              setHudCopied(true)
              setTimeout(() => setHudCopied(false), 1200)
            }}
            title="Click to copy"
            style={{ fontSize: '0.68rem', color: hudCopied ? 'var(--green)' : 'var(--txt-dim)', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
          >
            {hudCopied ? 'copied ✓' : hudTime}
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          <span className="hud-stat">ONLINE <b className="mag">{stats?.online_players ?? '-'}</b></span>
          <span className="hud-stat">MACHINES <b>{hills.length + targets.length + adMachines.length}</b></span>
          <span className="hud-stat">KILLS/24H <b>{stats?.kills_24h ?? '-'}</b></span>
        </div>
      </div>

      {sessionExpired && (
        <div style={{
          background: 'rgba(244, 63, 94, 0.12)',
          borderTop: '1px solid var(--red)',
          borderBottom: '1px solid var(--red)',
          color: 'var(--red)',
          padding: '10px 18px',
          fontFamily: 'var(--hud)',
          fontSize: '0.78rem',
          letterSpacing: '0.08em',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexShrink: 0,
        }}>
          <span>⚠ SESSION EXPIRED, log in again to see live arena state.</span>
          <a href="/login" style={{ color: 'var(--cyan)', textDecoration: 'underline', fontWeight: 600 }}>
            LOG IN →
          </a>
        </div>
      )}

      {/* Ticker, two identical halves so the -50% loop wraps seamlessly.
          Hover anywhere pauses. Animation duration is content-aware (set
          dynamically via ref) so 5 events and 50 events scroll at the same
          visual pixels-per-second instead of the same wall-clock cycle. */}
      {ticker.length > 0 && (
        <Ticker items={ticker} colorFor={tickerColor} relTime={relTime} pxPerSec={stats?.ticker_px_per_sec ?? 40} />
      )}

      {/* Tabs */}
      <div className="hub-tabs">
        {([
          ['radar', 'Radar'],
          ['activity', 'Activity'],
          ['scores', 'Scores'],
          ['scoring', 'Scoring'],
          ['rules', 'Rules'],
        ] as const).map(([t, label]) => (
          <button key={t} type="button" className={`hub-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
        {handle ? (
          <Link href={`/player/${handle}`} className="hub-tab-link">My profile →</Link>
        ) : (
          <Link href="/signup" className="hub-tab-link" style={{ color: 'var(--mag)' }}>Register →</Link>
        )}
        <Link href="/contribute" className="hub-tab-link hub-tab-link-end">Contribute →</Link>
      </div>

      <div className="hub-body">
        {/* key={tab} remounts the panel on tab change so the CSS reveal re-fires
            (a gentle rise-in) and the scroll resets to the top - the tab content
            is derived from props/state, so remounting is side-effect-free. */}
        <div className="hub-main ck-reveal" key={tab}>

          {/* ── RADAR ── */}
          {tab === 'radar' && (
            <>
              {!handle && (
                <div style={{
                  background: 'var(--panel)', borderLeft: '3px solid var(--mag)',
                  padding: '12px 16px', marginBottom: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                }}>
                  <span style={{ fontFamily: 'var(--body)', fontSize: '0.9rem', color: 'var(--txt-dim)' }}>
                    No handle set, <Link href="/signup" style={{ color: 'var(--mag)', fontWeight: 600 }}>register an account</Link> to earn points and appear on the leaderboard.
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Link href="/signup" className="btn-mag" style={{ fontSize: '0.68rem', padding: '8px 14px' }}>REGISTER</Link>
                    <Link href="/login" className="hub-tab" style={{ border: '1px solid var(--border)' }}>LOGIN</Link>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
                <div className="hp-label" style={{ color: 'var(--cyan)', marginBottom: 0 }}>
                  MACHINES{' '}
                  <span style={{ color: 'var(--txt-dim)', fontWeight: 400 }}>[{targets.length + hills.length + adMachines.length} live]</span>
                </div>
                {handle && inviteToken && (
                  <button
                    onClick={voteRangeReset}
                    disabled={rangeResetVoting || rangeResetVoted}
                    style={{
                      fontSize: '0.68rem', padding: '5px 10px', cursor: 'pointer',
                      background: rangeResetConfirming ? 'var(--red)22' : 'none',
                      border: `1px solid ${rangeResetConfirming ? 'var(--red)' : rangeResetVoted ? 'var(--txt-dim)' : 'var(--red)'}`,
                      color: rangeResetVoted ? 'var(--txt-dim)' : 'var(--red)',
                      borderRadius: 3, opacity: rangeResetVoted ? 0.5 : 1,
                      transition: 'background 0.15s',
                    }}
                  >
                    {rangeResetVoting ? 'Voting…' : rangeResetVoted
                      ? `Voted (${rangeVotes?.votes ?? 1}/${rangeVotes?.threshold ?? 5})`
                      : rangeResetConfirming
                        ? 'CONFIRM RANGE RESET?'
                        : `Reset Range${rangeVotes?.votes ? ` (${rangeVotes.votes}/${rangeVotes.threshold})` : ''}`}
                  </button>
                )}
              </div>
              <div className="tgrid ck-stagger">
                {[...hills, ...targets, ...adMachines].map(m => {
                  const isAD = m.type === 'corp'
                  const c = TIER_COLOR[m.tier] || (isAD ? '#a855f7' : '#22d3ee')
                  const userPts = m.user_flag_points ?? stats?.user_flag_points ?? 150
                  const rootPts = m.root_flag_points ?? stats?.root_flag_points ?? 400
                  return (
                    <div key={m.arena_ip + m.type} className="tcard" style={{ borderTop: `2px solid ${c}`, opacity: m.health_ok === false ? 0.45 : 1 }}>
                      <div className="tcard-ip" style={{ color: c }}>
                        {m.arena_ip}
                      </div>
                      <span className="tier-badge" style={{ color: c, borderColor: c }}>
                        {(TIER_LABEL[m.tier] || m.tier).toUpperCase()}
                      </span>
                      {m.koth && (
                        <span className="tier-badge" style={{ color: 'var(--mag)', borderColor: 'var(--mag)', marginLeft: 6 }}>
                          👑 KING OF THE HILL
                        </span>
                      )}
                      {m.koth && (
                        <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(232,52,198,0.08)', borderLeft: '2px solid var(--mag)' }}>
                          {m.king_handle ? (
                            <div style={{ fontSize: '0.78rem' }}>
                              <span style={{ color: 'var(--mag)', fontWeight: 600 }}>👑 {m.king_handle === handle ? 'YOU hold' : m.king_handle + ' holds'}</span>
                              <span style={{ color: 'var(--txt-dim)' }}> the hill{m.king_since_secs ? ` · ${fmtHeld(m.king_since_secs)}` : ''}</span>
                            </div>
                          ) : (
                            <div style={{ fontSize: '0.78rem', color: 'var(--txt-dim)' }}>Throne unclaimed - take it.</div>
                          )}
                          <div style={{ fontSize: '0.68rem', color: 'var(--txt-dim)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                            root? hold the hill: <span style={{ color: 'var(--cyan)' }}>echo {handle || 'YOURHANDLE'} &gt; /root/king.txt</span>
                          </div>
                        </div>
                      )}
                      {m.health_ok === false && (
                        <div style={{ marginTop: 6, fontSize: '0.68rem', color: 'var(--red)', letterSpacing: '0.05em' }}>
                          ✕ UNREACHABLE
                        </div>
                      )}
                      <div className="flag-row" style={{ marginTop: 8 }}>
                        <span className={`flag-pill${m.user_flag_captured ? ' captured' : ''}`}>
                          {m.user_flag_captured ? '✓ ' : ''}USER {userPts}pts
                        </span>
                        <span className={`flag-pill${m.root_flag_captured ? ' captured' : ''}`}>
                          {m.root_flag_captured ? '✓ ROOT' : 'ROOT'} {rootPts}pts
                        </span>
                      </div>
                      {m.user_flag_by ? (
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ color: 'var(--txt-dim)', fontSize: '0.68rem' }}>USER FLAG</span>
                          <span
                            role="link"
                            tabIndex={0}
                            onClick={() => window.open(`/player/${m.user_flag_by}`, '_blank')}
                            onKeyDown={e => e.key === 'Enter' && window.open(`/player/${m.user_flag_by}`, '_blank')}
                            style={{
                              color: m.user_flag_by === handle ? 'var(--green)' : 'var(--red)',
                              fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
                            }}
                          >
                            {m.user_flag_by === handle ? '★ YOU' : m.user_flag_by}
                          </span>
                        </div>
                      ) : null}
                      {m.king_handle ? (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ color: 'var(--txt-dim)', fontSize: '0.68rem' }}>KING</span>
                            <span
                              role="link"
                              tabIndex={0}
                              onClick={() => window.open(`/player/${m.king_handle}`, '_blank')}
                              onKeyDown={e => e.key === 'Enter' && window.open(`/player/${m.king_handle}`, '_blank')}
                              style={{
                                color: m.king_handle === handle ? 'var(--green)' : 'var(--red)',
                                fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
                              }}
                            >
                              {m.king_handle === handle ? '★ YOU' : m.king_handle}
                            </span>
                            {(m.king_since_secs ?? 0) > 0 && (
                              <KingTimer secs={m.king_since_secs!} />
                            )}
                            {m.king_handle === handle && (
                              <button type="button"
                                onClick={() => setCardEvent({
                                  headline: 'HELD THE THRONE',
                                  subline: `king of ${m.image_name || m.arena_ip}`,
                                })}
                                title="Share this"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mag)', fontSize: '0.78rem', padding: 0 }}>
                                ✦
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginTop: 8, fontSize: '0.72rem', color: 'var(--txt-dim)' }}>
                          THRONE VACANT
                        </div>
                      )}
                      {!isAD && (m.ttl_secs ?? 0) > 0 && <CardTTL secs={m.ttl_secs!} />}
                      {(m.type === 'koth' || isAD) && inviteToken && (
                        <div style={{ marginTop: 10 }}>
                          {(() => {
                            const voted = m.my_reset_vote || resetVoted[m.arena_ip]
                            const voting = resetVoting[m.arena_ip]
                            const votes = m.reset_votes ?? 0
                            const threshold = m.reset_threshold ?? 5
                            return (
                              <button
                                type="button"
                                disabled={voted || voting}
                                onClick={() => voteReset(m.arena_ip)}
                                style={{
                                  background: 'none',
                                  border: `1px solid ${voted ? 'var(--txt-dim)' : 'var(--red)'}44`,
                                  borderRadius: 4,
                                  padding: '4px 10px',
                                  fontSize: '0.65rem',
                                  fontFamily: 'var(--hud)',
                                  letterSpacing: '0.08em',
                                  color: voted ? 'var(--txt-dim)' : 'var(--red)',
                                  cursor: voted || voting ? 'default' : 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  opacity: voted ? 0.6 : 1,
                                }}
                              >
                                <span>{voting ? '…' : voted ? '✓ VOTED' : '↺ VOTE RESET'}</span>
                                <span style={{ color: 'var(--txt-dim)', fontSize: '0.6rem' }}>
                                  {votes}/{threshold}
                                </span>
                              </button>
                            )
                          })()}
                        </div>
                      )}
                      <FeedbackWidget
                        arenaIP={m.arena_ip}
                        imageName={m.image_name || m.arena_ip}
                        handle={handle}
                        currentStars={m.avg_stars ?? 0}
                      />
                    </div>
                  )
                })}
              </div>
              {targets.length + hills.length + adMachines.length === 0 && (
                <div className="ck-empty">
                  <div className="ck-empty-title">NO CONTACTS ON RADAR</div>
                  <p className="ck-empty-body">
                    The control plane may still be spinning up targets. Machines appear here the moment they come online.
                  </p>
                </div>
              )}
            </>
          )}

          {/* ── ACTIVITY / LIVE TRACKER ── */}
          {tab === 'activity' && (
            <div>
              {/* Battle status bar */}
              <div style={{
                display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center',
              }}>
                <span style={{ fontSize: '0.62rem', color: 'var(--mag)', fontFamily: 'var(--hud)', letterSpacing: '0.15em' }}>
                  LIVE TRACKER
                </span>
                <span style={{ fontSize: '0.62rem', color: 'var(--txt-dim)' }}>
                  <span className="live-dot" />UPDATING
                </span>
                {stats && (
                  <>
                    <span style={{ fontSize: '0.72rem', color: 'var(--txt-dim)' }}>
                      {stats.online_players} online · {hills.length + targets.length + adMachines.length} machines
                    </span>
                  </>
                )}
              </div>

              {/* Kill feed, admin/root/koth only */}
              <div className="hp-label" style={{ color: 'var(--green)', marginBottom: 8 }}>KILL FEED</div>
              {(activity.kills || []).length === 0 && (
                <div className="ck-empty" style={{ marginTop: 8 }}>
                  <div className="ck-empty-title">NO KILLS YET</div>
                  <p className="ck-empty-body">First capture of the round lands here, and earns first blood.</p>
                </div>
              )}
              <div className="ck-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(activity.kills || []).map((k: any, i: number) => {
                  const kindColor = k.kind === 'root_flag' ? 'var(--red)' : k.kind === 'koth' ? 'var(--mag)' : 'var(--cyan)'
                  return (
                    <div key={i} className="ck-feed-row" style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 12px', background: i === 0 ? 'var(--panel)' : 'transparent',
                      borderLeft: i === 0 ? `3px solid ${kindColor}` : '3px solid transparent',
                      fontSize: '0.82rem',
                    }}>
                      <span style={{
                        fontFamily: 'var(--hud)', fontSize: '0.62rem', letterSpacing: '0.08em',
                        color: kindColor, minWidth: 70,
                      }}>
                        {k.kind === 'root_flag' ? 'ROOT' : k.kind.replace(/_/g, ' ').toUpperCase()}
                      </span>
                      <strong style={{ color: 'var(--green)' }}>+{k.points}</strong>
                      <Link href={`/player/${k.handle}`} target="_blank" rel="noreferrer" style={{ color: 'var(--txt-bright)' }}>{k.handle}</Link>
                      {k.arena_ip && <code style={{ fontSize: '0.68rem', color: 'var(--txt-dim)' }}>{k.arena_ip}</code>}
                      {k.first_blood && (
                        <span style={{ fontSize: '0.6rem', color: 'var(--red)', border: '1px solid var(--red)', padding: '1px 5px', letterSpacing: '0.06em' }}>FIRST BLOOD</span>
                      )}
                      <span style={{ color: 'var(--txt-dim)', fontSize: '0.72rem', marginLeft: 'auto' }}>{k.ago} ago</span>
                      {k.handle === handle && (
                        <button type="button"
                          onClick={() => setCardEvent({
                            headline: k.first_blood ? 'FIRST BLOOD' : (k.kind === 'root_flag' ? 'ROOTED THE BOX' : 'OWNED A MACHINE'),
                            subline: `${k.kind === 'root_flag' ? 'root' : k.kind.replace(/_/g, ' ')} on ${k.arena_ip || 'the arena'}`,
                          })}
                          title="Share this"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mag)', fontSize: '0.78rem', padding: 0 }}>
                          ✦
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Flag captures, user_flag foothold events */}
              {(activity.flags || []).length > 0 && (
                <>
                  <div className="hp-label" style={{ color: 'var(--amber)', marginBottom: 8, marginTop: 20 }}>FLAG CAPTURES</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(activity.flags || []).map((k: any, i: number) => (
                      <div key={i} className="ck-feed-row" style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '6px 12px', fontSize: '0.78rem',
                        borderLeft: '3px solid var(--amber)',
                      }}>
                        <span style={{ fontFamily: 'var(--hud)', fontSize: '0.62rem', color: 'var(--amber)', minWidth: 70 }}>USER FLAG</span>
                        <strong style={{ color: 'var(--amber)' }}>+{k.points}</strong>
                        <Link href={`/player/${k.handle}`} target="_blank" rel="noreferrer" style={{ color: 'var(--txt-bright)' }}>{k.handle}</Link>
                        {k.arena_ip && <code style={{ fontSize: '0.68rem', color: 'var(--txt-dim)' }}>{k.arena_ip}</code>}
                        {k.first_blood && (
                          <span style={{ fontSize: '0.6rem', color: 'var(--red)', border: '1px solid var(--red)', padding: '1px 5px' }}>FIRST BLOOD</span>
                        )}
                        <span style={{ color: 'var(--txt-dim)', fontSize: '0.72rem', marginLeft: 'auto' }}>{k.ago} ago</span>
                        {k.handle === handle && (
                          <button type="button"
                            onClick={() => setCardEvent({
                              headline: k.first_blood ? 'FIRST BLOOD' : 'GOT A FOOTHOLD',
                              subline: `user flag on ${k.arena_ip || 'the arena'}`,
                            })}
                            title="Share this"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mag)', fontSize: '0.78rem', padding: 0 }}>
                            ✦
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── SCORES ── */}
          {tab === 'scores' && (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                <div className="hp-label" style={{ color: 'var(--cyan)', fontSize: '0.85rem' }}>◢ KILL LEADERBOARD ◣</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--txt-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}>
                  RANKED BY KILLS · POINTS = TIEBREAKER
                </div>
              </div>
              {handle && (
                <p className="hint" style={{ marginBottom: 12 }}>
                  <Link href={`/player/${handle}`} style={{ color: 'var(--mag)' }}>Your profile</Link>
                  {' · '}
                  <Link href={`/player/${handle}/edit`} style={{ color: 'var(--cyan)' }}>Customize</Link>
                </p>
              )}
              <div className="score-hdr"><span>#</span><span>HANDLE</span><span>KILLS</span><span>POINTS</span></div>
              {scores.map((s: any, i: number) => {
                const c = i === 0 ? 'var(--mag)' : i === 1 ? 'var(--cyan)' : i === 2 ? 'var(--purple)' : 'var(--txt-dim)'
                const medal = i === 0 ? '◆' : i === 1 ? '◇' : i === 2 ? '◇' : ''
                return (
                  <div key={s.handle} className="score-row" style={{
                    borderLeft: i < 3 ? `3px solid ${c}` : undefined,
                    background: i === 0 ? 'rgba(232,52,198,0.05)' : undefined,
                    transition: 'background 0.2s',
                  }}>
                    <span style={{ fontFamily: 'var(--hud)', color: c, fontWeight: i < 3 ? 700 : 400 }}>
                      {medal} {s.rank}
                    </span>
                    <Link href={`/player/${s.handle}`} target="_blank" rel="noreferrer" style={{
                      color: i === 0 ? 'var(--mag)' : 'var(--txt-bright)',
                      fontWeight: i < 3 ? 600 : 400,
                    }}>{s.handle}</Link>
                    <span style={{
                      fontFamily: 'var(--hud)',
                      color: i === 0 ? 'var(--mag)' : 'var(--red)',
                      fontSize: i === 0 ? '1.1rem' : undefined,
                      fontWeight: i < 3 ? 700 : 400,
                    }}>{s.kills}</span>
                    <span style={{ fontFamily: 'var(--hud)', color: 'var(--cyan)', opacity: 0.8, textAlign: 'right' }}>
                      {s.points}
                      {s.longest_reign_secs > 0 && (
                        <span title="longest king-of-the-hill reign" style={{ display: 'block', fontSize: '0.6rem', color: 'var(--mag)', opacity: 0.9 }}>
                          👑 {fmtHeld(s.longest_reign_secs)}
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
              {scores.length === 0 && (
                <div className="ck-empty">
                  <div className="ck-empty-title">LEADERBOARD EMPTY</div>
                  <p className="ck-empty-body">No kills on the board yet. Be the first to put your handle up top.</p>
                </div>
              )}
            </>
          )}

          {/* ── SCORING ── */}
          {tab === 'scoring' && <ScoringTab stats={stats} />}

          {/* ── RULES ── */}
          {tab === 'rules' && <RulesTab />}
        </div>

        <ArenaChat onThrone={(e) => {
          if (e.text) pushToast('👑', 'THRONE', e.text)
          if (e.arena_ip) setMachines(prev => prev.map(mm => mm.arena_ip === e.arena_ip ? { ...mm, king_handle: e.handle || '', king_since_secs: 0 } : mm))
        }} />
      </div>

      {cardEvent && (() => {
        const me = (scores || []).find((s: any) => s.handle === handle)
        return (
          <ShareCard
            stats={{
              handle: handle || 'operative',
              rank: me?.rank,
              points: me?.points,
              kills: me?.kills,
              koth_crowns: me?.koth_crowns,
              title: me?.title,
            }}
            headline={cardEvent.headline}
            subline={cardEvent.subline}
            onClose={() => setCardEvent(null)}
          />
        )
      })()}

      <footer className="hub-footer">
        {handle ? (
          <>
            <Link href={`/player/${handle}`}>Profile: <strong>{handle}</strong></Link>
            <span className="hub-footer-sep">·</span>
            <Link href={`/player/${handle}/edit`}>Customize</Link>
            <span className="hub-footer-sep">·</span>
            <Link href="/contribute" style={{ color: 'var(--txt-dim)' }}>Contribute a machine</Link>
            <span className="hub-footer-sep">·</span>
            <Link href="/report" style={{ color: 'var(--txt-dim)' }}>Report a problem</Link>
            <span className="hub-footer-sep">·</span>
            <Link href="/feedback" style={{ color: 'var(--txt-dim)' }}>Give feedback</Link>
            <span className="hub-footer-sep">·</span>
            <a href="https://monitor-the-situation.com/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--txt-dim)' }}>OSINT</a>
            <span className="hub-footer-sep">·</span>
            <a href="https://1337skills.com/cheatsheets/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--txt-dim)' }}>Cheatsheets</a>
            <span className="hub-footer-sep">·</span>
            <Link href="/known-issues" style={{ color: 'var(--txt-dim)' }}>Known Issues</Link>
            <span className="hub-footer-sep">·</span>
            <Link href="/wanted-features" style={{ color: 'var(--txt-dim)' }}>Wanted Features</Link>
          </>
        ) : (
          <>
            <Link href="/signup" style={{ color: 'var(--mag)' }}>Register an account</Link>
            <span className="hub-footer-sep">·</span>
            <Link href="/login" style={{ color: 'var(--cyan)' }}>Log in</Link>
          </>
        )}
      </footer>

      <RadioBar autoplay={true} />
    </div>
  )
}

// ── SCORING TAB ───────────────────────────────────────────────────────────────

function ScoringTab({ stats }: { stats: Stats | null }) {
  const userPts = stats?.user_flag_points ?? 150
  const rootPts = stats?.root_flag_points ?? 400

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="hp-label" style={{ color: 'var(--cyan)' }}>HOW TO CAPTURE</div>
      <p className="hint" style={{ marginTop: 8, lineHeight: 1.7 }}>
        You prove a capture by <strong style={{ color: 'var(--txt-bright)' }}>writing your hub handle into the flag file</strong>.
        The platform reads it server-side and awards you automatically - no submission box, no instructor.
        Get a foothold and claim the user flag; escalate to root and claim the root flag.
      </p>

      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <ScoreBox label="USER FLAG" value={`+${userPts}`} hint="foothold: any shell on the box" color="var(--cyan)" />
        <ScoreBox label="ROOT FLAG" value={`+${rootPts}`} hint="full root / administrator" color="var(--mag)" />
      </div>

      <div style={{ marginTop: 28 }}>
        <div className="hp-label" style={{ color: 'var(--mag)' }}>CLAIM A FLAG</div>
        <p className="hint" style={{ marginTop: 10 }}>
          Once you have the access it requires, write your handle into the flag file (find
          <code> user.txt</code> / <code>root.txt</code> on the box - the path varies):
        </p>
        <pre className="connect-pre" style={{ fontSize: '0.78rem', whiteSpace: 'pre-wrap' }}>{`echo "$(whoami-on-hub)" > user.txt    # foothold -> user flag
echo "yourhandle" > /root/root.txt    # after root -> root flag`}</pre>
        <p className="hint" style={{ marginTop: 10 }}>
          On <strong style={{ color: 'var(--mag)' }}>King of the Hill</strong> boxes, also hold the throne:
          <code> echo yourhandle &gt; /root/king.txt</code> - you earn points every tick while your handle stays there.
        </p>
      </div>

      <div style={{ marginTop: 28 }}>
        <div className="hp-label" style={{ color: 'var(--mag)' }}>LEADERBOARD RANKING</div>
        <p className="hint" style={{ marginTop: 8 }}>
          Ranked by <strong style={{ color: 'var(--txt-bright)' }}>kills</strong> first, points as the tiebreaker.
          A &quot;kill&quot; is a root capture; user flags add points without a kill.
        </p>
      </div>
    </div>
  )
}

function ScoreBox({ label, value, hint, color }: { label: string; value: string; hint: string; color: string }) {
  return (
    <div style={{
      background: 'var(--panel)', border: `1px solid ${color}66`, padding: '14px 16px',
      borderRadius: 2, borderLeft: `3px solid ${color}`,
    }}>
      <div style={{ fontFamily: 'var(--hud)', fontSize: '0.62rem', color, letterSpacing: '0.12em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--hud)', fontSize: '1.6rem', color: 'var(--txt-bright)', marginBottom: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--txt-dim)' }}>{hint}</div>
    </div>
  )
}

// ── RULES TAB ────────────────────────────────────────────────────────────────

function RulesTab() {
  return (
    <div style={{ maxWidth: 760 }}>
      <div className="hp-label" style={{ color: 'var(--mag)' }}>ARENA RULES</div>
      <p className="hint" style={{ marginTop: 8, lineHeight: 1.7 }}>
        Short version: hack the range, not the platform. Don&apos;t be a dick to other players.
        If a rule isn&apos;t obvious from this page, ask in chat or open a report.
      </p>

      <Rule color="var(--red)" title="SCOPE">
        <ul style={{ paddingLeft: 18, marginTop: 6 }}>
          <li>In scope: the target machines on the range network (the IPs shown on the Radar).</li>
          <li>Out of scope: the platform itself, the API, the web hub, the chat service, and the host running it.</li>
          <li>Found a real vuln in the platform? Use the &quot;Report a problem&quot; link in the footer.</li>
        </ul>
      </Rule>

      <Rule color="var(--amber, #f59e0b)" title="DON'T BREAK THE GAME FOR OTHERS">
        <ul style={{ paddingLeft: 18, marginTop: 6 }}>
          <li>Don&apos;t change credentials other players might need to get in.</li>
          <li>Don&apos;t shut down the services others are enumerating. Modify, don&apos;t disable.</li>
          <li>A target can be respawned clean from the admin panel if it ends up wedged.</li>
        </ul>
      </Rule>

      <Rule color="var(--cyan)" title="FLAGS">
        <ul style={{ paddingLeft: 18, marginTop: 6 }}>
          <li>Each box has a user flag (foothold) and a root flag - find <code>user.txt</code> / <code>root.txt</code> on the box.</li>
          <li>Capture by writing your hub handle into the flag file; the platform reads it and awards you automatically.</li>
          <li>The user flag needs a foothold shell; the root flag needs root.</li>
        </ul>
      </Rule>

      <Rule color="var(--green)" title="CHAT &amp; COMMUNITY">
        <ul style={{ paddingLeft: 18, marginTop: 6 }}>
          <li>Be kind, respectful, and helpful. Look out for each other.</li>
          <li>Sharing techniques and methodology is good; pasting full chains/flags spoils it.</li>
          <li>No harassment, slurs, or doxxing. Moderators can mute / ban without warning.</li>
        </ul>
      </Rule>

      <Rule color="var(--txt-dim)" title="LEGAL / SAFETY">
        <ul style={{ paddingLeft: 18, marginTop: 6 }}>
          <li>Attack from a dedicated VM (Kali, Parrot), not your daily machine.</li>
          <li>These boxes are intentionally vulnerable and meant only for this isolated lab.</li>
          <li>This is for learning. Don&apos;t use techniques learned here against systems you aren&apos;t authorized to test.</li>
        </ul>
      </Rule>
    </div>
  )
}

function Rule({ color, title, children }: { color: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 20,
      background: 'var(--panel)', border: '1px solid var(--border)', borderLeft: `3px solid ${color}`,
      padding: '14px 18px', borderRadius: 2,
      color: 'var(--txt-dim)', fontSize: '0.88rem', lineHeight: 1.6,
    }}>
      <div style={{ fontFamily: 'var(--hud)', fontSize: '0.7rem', color, letterSpacing: '0.12em', marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  )
}
