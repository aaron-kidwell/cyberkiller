'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { adminFetch, resolveRuntimeAPI } from '../lib/api'

type Hill = {
  id: string; arena_ip: string; image_name: string; tier: string; status: string
  king_handle: string; bounty_pts: number
  user_flag_captured: boolean; root_flag_captured: boolean
  machine_type?: string
}
type Stats = {
  online_players: number; active_targets: number
  kills_24h: number
  ticker_px_per_sec?: number
}
type HealthFail = { id: number; image_id: string; arena_ip: string; failed_step: string; detail: string; checked_at: string }
type AuditEntry = { id: number; actor: string; action: string; detail: string; created_at: string }

const TIER_LABEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }
const TIER_CLASS: Record<string, string> = { easy: 'tier-easy', medium: 'tier-medium', hard: 'tier-hard' }

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [hills, setHills] = useState<Hill[]>([])
  const [healthLog, setHealthLog] = useState<HealthFail[]>([])
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([])
  const [apiOk, setApiOk] = useState<boolean | null>(null)
  const [ticker, setTicker] = useState('')
  const [sitrep, setSitrep] = useState('')
  const [flash, setFlash] = useState<{ msg: string; ok: boolean } | null>(null)
  const [chatMsgs, setChatMsgs] = useState<{ id: string; handle: string; text: string; ts?: number; system?: boolean }[]>([])
  const [chatReply, setChatReply] = useState('')
  const [timeoutHandle, setTimeoutHandle] = useState('')
  const [timeoutMins, setTimeoutMins] = useState(15)
  const [slowmodeSec, setSlowmodeSec] = useState(0)
  const [emoteOnly, setEmoteOnly] = useState(false)
  const [tickerSpeed, setTickerSpeed] = useState(40)
  const [features, setFeatures] = useState<any[]>([])
  const [knownIssues, setKnownIssues] = useState<any[]>([])
  const [niSev, setNiSev] = useState('LOW')
  const [niTitle, setNiTitle] = useState('')
  const [niBody, setNiBody] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const notify = (msg: string, ok = true) => {
    setFlash({ msg, ok })
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setFlash(null), 4000)
  }

  const loadChat = useCallback(async () => {
    const msgs = await adminFetch('/admin/chat/history').catch(() => [])
    setChatMsgs((msgs || []).filter((m: any) => !m.system).slice(-50).reverse())
  }, [])

  const load = useCallback(async () => {
    try {
      const [h, hi, st, hl, al, cm, ft, ki] = await Promise.all([
        fetch(`${resolveRuntimeAPI()}/health`).then(r => r.json()),
        adminFetch('/admin/hills').catch(() => []),
        fetch(`${resolveRuntimeAPI()}/api/v1/stats`).then(r => r.json()),
        adminFetch('/admin/health-log').catch(() => []),
        adminFetch('/admin/audit-log').catch(() => []),
        adminFetch('/admin/chat/mode').catch(() => ({ slowmode_seconds: 0, emote_only: false })),
        adminFetch('/admin/features').catch(() => ({ features: [] })),
        adminFetch('/admin/known-issues').catch(() => ({ issues: [] })),
      ])
      setApiOk(h.status === 'ok')
      setHills(hi || [])
      setStats(st)
      setHealthLog(hl || [])
      setAuditLog(al || [])
      if (cm) {
        setSlowmodeSec(cm.slowmode_seconds ?? 0)
        setEmoteOnly(!!cm.emote_only)
      }
      if (typeof st?.ticker_px_per_sec === 'number') setTickerSpeed(st.ticker_px_per_sec)
      setFeatures(ft?.features || [])
      setKnownIssues(ki?.issues || [])
    } catch { setApiOk(false) }
  }, [])

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t) }, [load])
  useEffect(() => { loadChat(); const t = setInterval(loadChat, 5000); return () => clearInterval(t) }, [loadChat])

  const act = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn(); notify(label); load() }
    catch (e: any) { notify(e.message, false) }
  }

  // Scenario machines (AD / corp) are managed on their dedicated pages - the
  // dashboard only lists the rotating KOTH hills to avoid duplicating controls.
  const dockerHills = hills.filter(h => !h.machine_type || h.machine_type === 'docker')

  return (
    <div>
      <div className="page-header">
        <div className="page-title">OPERATOR DASHBOARD</div>
        <div className="page-sub">Range overview and quick controls</div>
      </div>

      {flash && (
        <div className={`flash ${flash.ok ? 'flash-ok' : 'flash-err'}`}>{flash.msg}</div>
      )}

      {/* Stats row */}
      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-label">API STATUS</div>
          <div className={`stat-value ${apiOk ? 'green' : 'mag'}`}>{apiOk == null ? '…' : apiOk ? 'OK' : 'DOWN'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">PLAYERS ONLINE</div>
          <div className="stat-value mag">{stats?.online_players ?? '-'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">ACTIVE TARGETS</div>
          <div className="stat-value">{stats?.active_targets ?? '-'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">KILLS / 24H</div>
          <div className="stat-value green">{stats?.kills_24h ?? '-'}</div>
        </div>
      </div>

      {/* Live targets (managed on the Targets page) */}
      <div className="section">
        <div className="section-head">
          <span className="section-title">LIVE TARGETS ({dockerHills.length})</span>
          <a className="btn" href="/images" style={{ marginLeft: 'auto', textDecoration: 'none' }}>Manage targets →</a>
        </div>
        {dockerHills.length === 0 ? (
          <div className="section-body" style={{ color: 'var(--txt-dim)', fontFamily: 'var(--body)', fontSize: '0.85rem' }}>
            No targets live. Add one on the <a href="/images" style={{ color: 'var(--cyan)' }}>Targets</a> page.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="ck-table">
              <thead>
                <tr>
                  <th>IP</th><th>Image</th><th>Difficulty</th><th>Flags</th>
                  <th>Holder</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dockerHills.map(h => (
                  <tr key={h.arena_ip + h.status}>
                    <td><code>{h.arena_ip}</code></td>
                    <td>{h.image_name}</td>
                    <td><span className={`badge ${TIER_CLASS[h.tier] || 'badge-dim'}`}>{TIER_LABEL[h.tier] || h.tier}</span></td>
                    <td>
                      <span style={{ color: h.user_flag_captured ? 'var(--green)' : 'var(--txt-dim)' }}>
                        U{h.user_flag_captured ? '✓' : '-'}
                      </span>
                      {' '}
                      <span style={{ color: h.root_flag_captured ? 'var(--green)' : 'var(--txt-dim)' }}>
                        R{h.root_flag_captured ? '✓' : '-'}
                      </span>
                    </td>
                    <td>{h.king_handle ? <span style={{ color: 'var(--mag)' }}>{h.king_handle}</span> : <span style={{ color: 'var(--txt-dim)' }}>-</span>}</td>
                    <td>
                      <button className="btn btn-xs"
                        style={{ borderColor: 'var(--cyan)', color: 'var(--cyan)' }}
                        onClick={() => {
                          if (!confirm(`Reset target at ${h.arena_ip}?\n\nThis destroys and restarts the container from a clean image. Captures and activity on this machine are erased.`)) return
                          act(`Resetting target ${h.arena_ip}…`, () =>
                            adminFetch(`/admin/hills/${h.arena_ip}/reset`, { method: 'POST' }))
                        }}>
                        Reset
                      </button>
                      <button className="btn btn-xs btn-danger"
                        onClick={() => {
                          if (!confirm(`Stop target at ${h.arena_ip}?\n\nThis retires the machine and frees its IP slot.`)) return
                          act(`Stopped target ${h.arena_ip}`, () =>
                            adminFetch(`/admin/hills/${h.arena_ip}/expire`, { method: 'POST' }))
                        }}>
                        Stop
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Broadcast */}
      <div className="section">
        <div className="section-head">
          <span className="section-title">BROADCAST</span>
        </div>
        <div className="section-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div className="form-label">TICKER - scrolling banner on hub</div>
            <input className="form-input" value={ticker} onChange={e => setTicker(e.target.value)}
              placeholder="e.g. Double points hour - go!" onKeyDown={e => {
                if (e.key === 'Enter' && ticker.trim()) {
                  act('Ticker posted', () => adminFetch('/admin/ticker', { method: 'POST', body: JSON.stringify({ message: ticker }) }).then(() => setTicker('')))
                }
              }} />
            <button className="btn btn-sm btn-cyan" style={{ marginTop: 8 }} disabled={!ticker.trim()}
              onClick={() => act('Ticker posted', () => adminFetch('/admin/ticker', { method: 'POST', body: JSON.stringify({ message: ticker }) }).then(() => setTicker('')))}>
              Post to Ticker
            </button>
            <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--txt-dim)', letterSpacing: '0.08em' }}>SCROLL SPEED</span>
              <input
                type="range"
                min={5}
                max={200}
                step={5}
                value={tickerSpeed}
                onChange={e => setTickerSpeed(Number(e.target.value))}
                onMouseUp={e => {
                  const v = Number((e.target as HTMLInputElement).value)
                  act(`Ticker speed → ${v} px/s`, () =>
                    adminFetch('/admin/ticker/speed', { method: 'POST', body: JSON.stringify({ px_per_sec: v }) }))
                }}
                style={{ flex: 1, minWidth: 120 }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--cyan)', minWidth: 60, textAlign: 'right' }}>
                {tickerSpeed} px/s
              </span>
            </div>
          </div>
          <div>
            <div className="form-label">SITREP - status line at top of hub</div>
            <textarea className="form-input" style={{ minHeight: 60 }} value={sitrep} onChange={e => setSitrep(e.target.value)}
              placeholder="e.g. 3 targets live - have at it" />
            <button className="btn btn-sm btn-cyan" style={{ marginTop: 8 }} disabled={!sitrep.trim()}
              onClick={() => act('Sitrep updated', () => adminFetch('/admin/sitrep', { method: 'POST', body: JSON.stringify({ message: sitrep }) }).then(() => setSitrep('')))}>
              Update Sitrep
            </button>
          </div>
        </div>
      </div>

      {/* Failed health checks */}
      <div className="section">
        <div className="section-head">
          <span className="section-title mag">FAILED HEALTH CHECKS ({healthLog.length})</span>
          {healthLog.length > 0 && (
            <button className="btn btn-xs btn-danger" style={{ marginLeft: 'auto' }}
              onClick={() => {
                if (!confirm('Clear all failed health checks?')) return
                adminFetch('/admin/health-log', { method: 'DELETE' })
                  .then(() => setHealthLog([]))
                  .catch(() => notify('Clear failed', false))
              }}>
              Clear All
            </button>
          )}
        </div>
        {healthLog.length === 0 ? (
          <div className="section-body" style={{ color: 'var(--txt-dim)', fontFamily: 'var(--body)', fontSize: '0.85rem' }}>
            No failed health checks.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="ck-table">
              <thead><tr><th>Time</th><th>IP</th><th>Image</th><th>Failed Step</th><th>Detail</th><th></th></tr></thead>
              <tbody>
                {healthLog.map(e => (
                  <tr key={e.id}>
                    <td style={{ fontSize: '0.75rem', color: 'var(--txt-dim)' }}>{new Date(e.checked_at).toLocaleString()}</td>
                    <td><code>{e.arena_ip || '-'}</code></td>
                    <td style={{ fontSize: '0.78rem' }}>{e.image_id}</td>
                    <td><span className="badge badge-red">{e.failed_step}</span></td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--txt-dim)', maxWidth: 260 }}>{e.detail}</td>
                    <td>
                      <button className="btn btn-xs btn-danger"
                        onClick={() => {
                          adminFetch(`/admin/health-log/${e.id}`, { method: 'DELETE' })
                            .then(() => setHealthLog(prev => prev.filter(x => x.id !== e.id)))
                            .catch(() => notify('Delete failed', false))
                        }}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Data management */}
      <div className="section">
        <div className="section-head">
          <span className="section-title mag">DATA MANAGEMENT</span>
        </div>
        <div className="section-body">
          <div className="section-sub" style={{ color: 'var(--red)', marginBottom: 16 }}>
            Destructive - these actions cannot be undone.
          </div>
          <div className="action-row">
            <button className="btn btn-danger"
              onClick={() => {
                if (!confirm('PURGE ALL SCORES?\n\nThis will zero every player\'s points and kills and delete all kill records. This cannot be undone.')) return
                act('All scores and kills purged', () => adminFetch('/admin/scores', { method: 'DELETE' }))
              }}>
              ✕ Purge All Scores
            </button>
            <button className="btn btn-danger"
              onClick={() => {
                if (!confirm('PURGE KILL ACTIVITY?\n\nThis clears the kill log (scores are kept). This cannot be undone.')) return
                act('Kill activity log purged', () => adminFetch('/admin/kills', { method: 'DELETE' }))
              }}>
              ✕ Purge Kill Activity
            </button>
          </div>
          <div style={{ marginTop: 10, fontSize: '0.72rem', color: 'var(--txt-dim)' }}>
            "Purge All Scores" resets every player to 0 pts / 0 kills and clears the kill log.
            "Purge Kill Activity" only removes the activity feed - point totals stay.
          </div>
        </div>
      </div>

      {/* Chat moderation */}
      <div className="section">
        <div className="section-head">
          <span className="section-title">CHAT MODERATION</span>
        </div>
        <div className="section-body">
          {/* Reply in chat (posts as operator) */}
          <div style={{ marginBottom: 16 }}>
            <div className="form-label">REPLY IN CHAT - posts to the live hub chat as operator</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="form-input"
                style={{ flex: 1, minWidth: 220 }}
                placeholder="Message players in chat…"
                value={chatReply}
                onChange={e => setChatReply(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && chatReply.trim()) {
                    act('Replied in chat', () => adminFetch('/admin/chat/send', { method: 'POST', body: JSON.stringify({ text: chatReply }) }).then(() => setChatReply('')))
                  }
                }}
              />
              <button
                className="btn btn-sm btn-cyan"
                disabled={!chatReply.trim()}
                onClick={() => act('Replied in chat', () => adminFetch('/admin/chat/send', { method: 'POST', body: JSON.stringify({ text: chatReply }) }).then(() => setChatReply('')))}
              >
                Send
              </button>
            </div>
          </div>

          {/* Timeout form */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <span className="form-label" style={{ marginBottom: 0 }}>TIMEOUT PLAYER</span>
            <input
              className="form-input sm"
              style={{ width: 160 }}
              placeholder="handle"
              value={timeoutHandle}
              onChange={e => setTimeoutHandle(e.target.value)}
            />
            <select
              className="form-input sm"
              style={{ width: 100 }}
              value={timeoutMins}
              onChange={e => setTimeoutMins(Number(e.target.value))}
            >
              <option value={5}>5 min</option>
              <option value={15}>15 min</option>
              <option value={60}>60 min</option>
              <option value={1440}>24 hr</option>
            </select>
            <button
              className="btn btn-xs btn-danger"
              disabled={!timeoutHandle.trim()}
              onClick={() => {
                if (!confirm(`Time out ${timeoutHandle} for ${timeoutMins} minutes?`)) return
                act(`Timed out ${timeoutHandle} for ${timeoutMins}m`, () =>
                  adminFetch(`/admin/chat/timeout/${timeoutHandle}`, { method: 'POST', body: JSON.stringify({ minutes: timeoutMins }) }))
                setTimeoutHandle('')
              }}
            >
              Timeout
            </button>
          </div>

          {/* Slowmode + emote-only */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <span className="form-label" style={{ marginBottom: 0 }}>SLOWMODE</span>
            <select
              className="form-input sm"
              style={{ width: 110 }}
              value={slowmodeSec}
              onChange={e => {
                const v = Number(e.target.value)
                setSlowmodeSec(v)
                act(v === 0 ? 'Slowmode off' : `Slowmode ${v}s`, () =>
                  adminFetch('/admin/chat/slowmode', { method: 'POST', body: JSON.stringify({ seconds: v }) }))
              }}
            >
              <option value={0}>off</option>
              <option value={3}>3s</option>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
              <option value={300}>5 min</option>
            </select>
            <span style={{ width: 12 }} />
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={emoteOnly}
                onChange={e => {
                  const v = e.target.checked
                  setEmoteOnly(v)
                  act(v ? 'Emote-only ON' : 'Emote-only OFF', () =>
                    adminFetch('/admin/chat/emote-only', { method: 'POST', body: JSON.stringify({ enabled: v }) }))
                }}
              />
              EMOTE-ONLY MODE
            </label>
          </div>

          {/* Message list */}
          {chatMsgs.length === 0 ? (
            <div style={{ color: 'var(--txt-dim)', fontSize: '0.82rem' }}>No messages yet.</div>
          ) : (
            <div className="table-scroll" style={{ maxHeight: 320 }}>
              <table className="ck-table">
                <thead><tr><th>Time</th><th>Handle</th><th>Message</th><th></th></tr></thead>
                <tbody>
                  {chatMsgs.map(m => (
                    <tr key={m.id}>
                      <td style={{ color: 'var(--txt-dim)', fontSize: '0.7rem', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                        {m.ts ? new Date(m.ts * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}
                      </td>
                      <td style={{ color: 'var(--cyan)', fontWeight: 600, whiteSpace: 'nowrap' }}>{m.handle}</td>
                      <td style={{ fontSize: '0.8rem', wordBreak: 'break-word', maxWidth: 400 }}>{m.text}</td>
                      <td>
                        <button
                          className="btn btn-xs btn-danger"
                          onClick={() => {
                            adminFetch(`/admin/chat/messages/${m.id}`, { method: 'DELETE' })
                              .then(() => setChatMsgs(prev => prev.filter(x => x.id !== m.id)))
                              .catch(() => notify('Delete failed', false))
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Known issues */}
      <div className="section">
        <div className="section-head">
          <span className="section-title">KNOWN ISSUES ({knownIssues.length})</span>
        </div>
        <div className="section-body">
          {/* Create form */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap' }}>
            <select className="form-input sm" style={{ width: 110 }} value={niSev} onChange={e => setNiSev(e.target.value)}>
              <option value="LOW">LOW</option>
              <option value="HIGH">HIGH</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
            <input className="form-input sm" style={{ width: 240 }} placeholder="title" value={niTitle} onChange={e => setNiTitle(e.target.value)} />
            <input className="form-input sm" style={{ flex: 1, minWidth: 200 }} placeholder="description (what's happening / what to do)" value={niBody} onChange={e => setNiBody(e.target.value)} />
            <button className="btn btn-sm btn-cyan" disabled={!niTitle.trim()}
              onClick={() => act('Issue added', () =>
                adminFetch('/admin/known-issues', { method: 'POST', body: JSON.stringify({ severity: niSev, title: niTitle.trim(), body: niBody.trim(), sort_order: (knownIssues.length + 1) }) })
                  .then(() => { setNiTitle(''); setNiBody(''); setNiSev('LOW'); load() }))}>
              Add Issue
            </button>
          </div>

          {knownIssues.length === 0 ? (
            <div style={{ color: 'var(--txt-dim)', fontSize: '0.85rem' }}>No known issues posted.</div>
          ) : (
            <div className="table-scroll" style={{ maxHeight: 360 }}>
              <table className="ck-table">
                <thead><tr><th>Sev</th><th>Title / Description</th><th></th></tr></thead>
                <tbody>
                  {knownIssues.map(iss => (
                    <tr key={iss.id}>
                      <td>
                        <select className="form-input sm" style={{ width: 100 }} value={iss.severity}
                          onChange={e => {
                            const severity = e.target.value
                            act('Issue updated', () =>
                              adminFetch(`/admin/known-issues/${iss.id}`, { method: 'PUT', body: JSON.stringify({ ...iss, severity }) })
                                .then(() => setKnownIssues(prev => prev.map(x => x.id === iss.id ? { ...x, severity } : x))))
                          }}>
                          <option value="LOW">LOW</option>
                          <option value="HIGH">HIGH</option>
                          <option value="CRITICAL">CRITICAL</option>
                        </select>
                      </td>
                      <td style={{ maxWidth: 460 }}>
                        <div style={{ color: 'var(--txt-bright)', fontWeight: 600 }}>{iss.title}</div>
                        {iss.body && <div style={{ fontSize: '0.75rem', color: 'var(--txt-dim)', marginTop: 2 }}>{iss.body}</div>}
                      </td>
                      <td>
                        <button className="btn btn-xs btn-danger"
                          onClick={() => { if (confirm(`Delete "${iss.title}"?`)) act('Issue deleted', () =>
                            adminFetch(`/admin/known-issues/${iss.id}`, { method: 'DELETE' })
                              .then(() => setKnownIssues(prev => prev.filter(x => x.id !== iss.id)))) }}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Feature requests */}
      <div className="section">
        <div className="section-head">
          <span className="section-title">FEATURE REQUESTS ({features.length})</span>
        </div>
        <div className="section-body">
          {features.length === 0 ? (
            <div style={{ color: 'var(--txt-dim)', fontSize: '0.85rem' }}>No suggestions yet.</div>
          ) : (
            <div className="table-scroll" style={{ maxHeight: 420 }}>
              <table className="ck-table">
                <thead><tr><th>Score</th><th>Title</th><th>By</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {features.map(f => (
                    <tr key={f.id}>
                      <td style={{ fontFamily: 'var(--hud)', color: f.score > 0 ? 'var(--green)' : f.score < 0 ? 'var(--red)' : 'var(--txt)' }}>
                        {f.score}
                      </td>
                      <td style={{ maxWidth: 320 }}>
                        <div style={{ color: 'var(--txt-bright)', fontWeight: 600 }}>{f.title}</div>
                        {f.body && <div style={{ fontSize: '0.72rem', color: 'var(--txt-dim)', marginTop: 2 }}>{f.body}</div>}
                      </td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--txt-dim)' }}>{f.handle}</td>
                      <td>
                        <select
                          className="form-input sm"
                          style={{ width: 130 }}
                          value={f.status}
                          onChange={e => {
                            const status = e.target.value
                            act(`Feature → ${status}`, () =>
                              adminFetch(`/admin/features/${f.id}/status`, { method: 'POST', body: JSON.stringify({ status }) })
                                .then(() => setFeatures(prev => prev.map(x => x.id === f.id ? { ...x, status } : x))))
                          }}
                        >
                          <option value="open">Open</option>
                          <option value="planned">Planned</option>
                          <option value="in_progress">In Progress</option>
                          <option value="done">Shipped</option>
                          <option value="declined">Declined</option>
                        </select>
                      </td>
                      <td>
                        <button className="btn btn-xs btn-danger"
                          onClick={() => {
                            if (!confirm(`Delete "${f.title}"?`)) return
                            act('Feature deleted', () =>
                              adminFetch(`/admin/features/${f.id}`, { method: 'DELETE' })
                                .then(() => setFeatures(prev => prev.filter(x => x.id !== f.id))))
                          }}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Audit / deployment log */}
      <div className="section">
        <div className="section-head">
          <span className="section-title">DEPLOYMENT LOG</span>
          {auditLog.length > 0 && (
            <button className="btn btn-xs btn-danger" style={{ marginLeft: 'auto' }}
              onClick={() => {
                if (!confirm('Clear all deployment log entries?')) return
                adminFetch('/admin/audit-log', { method: 'DELETE' })
                  .then(() => setAuditLog([]))
                  .catch(() => notify('Clear failed', false))
              }}>
              Clear All
            </button>
          )}
        </div>
        {auditLog.length === 0 ? (
          <div className="section-body" style={{ color: 'var(--txt-dim)', fontFamily: 'var(--body)', fontSize: '0.85rem' }}>
            No events recorded yet.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="ck-table">
              <thead><tr><th>Time</th><th>Actor</th><th>Event</th><th>Detail</th><th></th></tr></thead>
              <tbody>
                {auditLog.map(e => {
                  const isErr = e.action.includes('fail') || e.action.includes('disabled')
                  const isSys = e.actor === 'system'
                  return (
                    <tr key={e.id}>
                      <td style={{ fontSize: '0.75rem', color: 'var(--txt-dim)', whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleString()}</td>
                      <td style={{ fontSize: '0.75rem', color: isSys ? 'var(--txt-dim)' : 'var(--cyan)' }}>{e.actor}</td>
                      <td><span className={`badge ${isErr ? 'badge-red' : 'badge-dim'}`}>{e.action}</span></td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--txt-dim)', maxWidth: 340, wordBreak: 'break-all' }}>{e.detail || '-'}</td>
                      <td>
                        <button className="btn btn-xs btn-danger"
                          onClick={() => {
                            adminFetch(`/admin/audit-log/${e.id}`, { method: 'DELETE' })
                              .then(() => setAuditLog(prev => prev.filter(x => x.id !== e.id)))
                              .catch(() => notify('Delete failed', false))
                          }}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
