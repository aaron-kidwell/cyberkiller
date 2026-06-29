'use client'

import { useState } from 'react'

// Normalized machine shape both scenarios map into.
export type SMachine = {
  key: string          // unique row id (machine id or arena_ip)
  name: string
  subtitle?: string    // domain (GOAD) / role (MERIDIAN)
  arena_ip: string
  localIP?: string     // direct LAN/VM IP (hit it without the arena VPN)
  tier: string
  healthy: boolean
  king_handle?: string
  user_flag_by?: string
  badge?: string       // 'DC' | 'Linux' | 'Member' | role
  userCap: boolean
  adminCap?: boolean   // GOAD only
  rootCap: boolean
}

export type RowAction = {
  label: string
  color?: string
  confirm?: (m: SMachine) => string
  run: (m: SMachine) => Promise<unknown>
  disabled?: (m: SMachine) => boolean
}

export type HeaderAction = {
  label: string
  primary?: boolean
  color?: string
  confirm?: string
  disabled?: boolean
  run: () => Promise<unknown>
}

const TIER_CLASS: Record<string, string> = { easy: 'tier-easy', medium: 'tier-medium', hard: 'tier-hard' }
const TIER_LABEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

export function ScenarioMachines(props: {
  title: string
  live: boolean
  liveNote: string
  machines: SMachine[]
  loading: boolean
  error?: string
  showAdminFlag?: boolean
  emptyHint: React.ReactNode
  headerActions: HeaderAction[]
  rowActions: RowAction[]
  footer?: React.ReactNode
  onRefresh: () => void
}) {
  const { title, live, liveNote, machines, loading, error, showAdminFlag, emptyHint,
    headerActions, rowActions, footer, onRefresh } = props
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const fire = async (id: string, label: string, run: () => Promise<unknown>, after = true) => {
    setBusy(id); setMsg('')
    try {
      const res: any = await run()
      setMsg(`${label}: ${res?.status || res?.detail || (res?.ok != null ? (res.ok ? 'reachable' : res.detail || 'unreachable') : 'ok')}`)
      if (after) setTimeout(onRefresh, 1200)
    } catch (e: any) {
      setMsg(`${label} failed: ${e.message}`)
    } finally { setBusy(null) }
  }

  const online = machines.filter(m => m.healthy).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>{title}</h1>
          <span style={{
            fontSize: '0.68rem', letterSpacing: '0.08em', padding: '2px 8px', borderRadius: 3,
            border: `1px solid ${live ? 'var(--green)' : 'var(--border)'}`,
            color: live ? 'var(--green)' : 'var(--txt-dim)',
          }}>{live ? 'LIVE' : 'STAGED'}</span>
          {machines.length > 0 && (
            <span style={{ fontSize: '0.72rem', color: 'var(--txt-dim)' }}>{online}/{machines.length} reachable</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={onRefresh}>Refresh</button>
          {headerActions.map(a => (
            <button key={a.label}
              className={a.primary ? 'btn btn-primary' : 'btn'}
              style={{ borderColor: a.color, color: a.color }}
              disabled={a.disabled || busy === `h:${a.label}`}
              onClick={() => { if (a.confirm && !confirm(a.confirm)) return; fire(`h:${a.label}`, a.label, a.run) }}>
              {busy === `h:${a.label}` ? '…' : a.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4,
        padding: '8px 12px', marginBottom: 16, fontSize: '0.8rem',
        color: live ? 'var(--cyan)' : 'var(--txt-dim)',
      }}>{liveNote}</div>

      {msg && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4,
          padding: '8px 12px', marginBottom: 16, fontSize: '0.8rem', color: 'var(--cyan)' }}>{msg}</div>
      )}
      {error && <div style={{ color: 'var(--red)', marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div style={{ color: 'var(--txt-dim)' }}>Loading…</div>
      ) : machines.length === 0 ? (
        <div style={{ background: 'var(--bg2)', border: '1px dashed var(--border)', borderRadius: 4,
          padding: 32, textAlign: 'center', color: 'var(--txt-dim)', fontSize: '0.82rem' }}>{emptyHint}</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {machines.map(m => (
            <div key={m.key} style={{
              background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4,
              padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 16,
              opacity: m.healthy ? 1 : 0.6,
            }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                background: m.healthy ? 'var(--green)' : 'var(--red)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
                  {m.name}
                  {m.subtitle && <span style={{ color: 'var(--txt-dim)', fontWeight: 400 }}> - {m.subtitle}</span>}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--txt-dim)', marginTop: 2 }}>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{m.arena_ip}</span>
                  {m.localIP && <span style={{ color: 'var(--cyan)' }}> &nbsp;(lan {m.localIP})</span>}
                  &nbsp;·&nbsp;
                  <span className={TIER_CLASS[m.tier] || ''}>{TIER_LABEL[m.tier] || m.tier}</span>
                  {m.badge && <> &nbsp;·&nbsp; {m.badge}</>}
                  &nbsp;·&nbsp; {m.healthy ? 'reachable' : 'unreachable'}
                  {m.user_flag_by && <span style={{ color: 'var(--cyan)', marginLeft: 8 }}>User: {m.user_flag_by}</span>}
                  {m.king_handle && <span style={{ color: 'var(--mag)', marginLeft: 8 }}>King: {m.king_handle}</span>}
                  &nbsp;·&nbsp;
                  <span style={{ color: m.userCap ? 'var(--green)' : 'var(--txt-dim)' }}>U</span>
                  {showAdminFlag && <span style={{ color: m.adminCap ? 'var(--green)' : 'var(--txt-dim)' }}>A</span>}
                  <span style={{ color: m.rootCap ? 'var(--green)' : 'var(--txt-dim)' }}>R</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {rowActions.map(a => (
                  <button key={a.label} className="btn"
                    style={{ fontSize: '0.72rem', padding: '4px 10px', borderColor: a.color, color: a.color }}
                    disabled={(a.disabled?.(m)) || busy === `${m.key}:${a.label}`}
                    onClick={() => { if (a.confirm && !confirm(a.confirm(m))) return; fire(`${m.key}:${a.label}`, `${a.label} ${m.name}`, () => a.run(m)) }}>
                    {busy === `${m.key}:${a.label}` ? '…' : a.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {footer && (
        <div style={{ marginTop: 32, padding: 16, background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 4, fontSize: '0.78rem', color: 'var(--txt-dim)', lineHeight: 1.7 }}>{footer}</div>
      )}
    </div>
  )
}
