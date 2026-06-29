'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { adminFetch } from '../../lib/api'

type Settings = Record<string, string>

const SECTIONS = [
  {
    title: 'ANNOUNCEMENTS',
    color: 'var(--mag)',
    sub: 'Pops up for players on first login. Bump the version to re-show it to everyone after you change it.',
    fields: [
      { key: 'announcement_active',  label: 'Show announcement',  tip: 'true = players see the popup on first login + via the NEWS button', type: 'select', options: ['true', 'false'] },
      { key: 'announcement_title',   label: 'Title',              tip: 'Headline of the announcement popup', type: 'text' },
      { key: 'announcement_body',    label: 'Body',               tip: 'The announcement text. Line breaks are preserved.', type: 'textarea' },
      { key: 'announcement_version', label: 'Version',            tip: 'Increment this whenever you change the announcement to re-show it to all players (they only auto-see each version once).', type: 'number' },
    ],
  },
  {
    title: 'SCORING',
    color: 'var(--cyan)',
    sub: 'Point values read live by the hub - changes take effect immediately.',
    fields: [
      { key: 'user_flag_points',     label: 'User flag points',     tip: 'Points awarded for a user.txt (foothold) capture',  type: 'number' },
      { key: 'root_flag_points',     label: 'Root flag points',     tip: 'Points awarded for a root.txt capture',             type: 'number' },
      { key: 'koth_points_per_tick', label: 'KOTH points / tick',   tip: 'Points the throne holder earns each tick on King-of-the-Hill targets. Default: 10', type: 'number' },
      { key: 'koth_tick_seconds',    label: 'KOTH tick interval (s)', tip: 'Seconds between KOTH scoring ticks. Takes effect live. Default: 60', type: 'number' },
    ],
  },
  {
    title: 'CONNECTION & HEARTBEAT',
    color: 'var(--red)',
    sub: 'Controls how quickly the arena marks an idle player offline.',
    fields: [
      { key: 'heartbeat_timeout_s', label: 'Heartbeat timeout (s)', tip: 'Seconds without a heartbeat before a player is marked offline. The hub pings while open. Default: 15', type: 'number' },
    ],
  },
  {
    title: 'REGISTRATION',
    color: 'var(--amber)',
    sub: 'Control who can register and the shared invite code.',
    fields: [
      { key: 'signup_mode',        label: 'Signup mode',  tip: 'open = anyone can register (code optional). code/closed = invite-only: the invite code below is required.', type: 'select', options: ['open','code','closed'] },
      { key: 'signup_invite_code', label: 'Invite code',   tip: 'The shared code players enter to register (when signup mode is code or closed).', type: 'text' },
    ],
  },
  {
    title: 'HUB TEXT',
    color: 'var(--cyan)',
    sub: 'Copy shown to players on the hub - no deploy needed.',
    fields: [
      { key: 'hub_default_sitrep',    label: 'Default sitrep',          tip: 'Shown when no operator sitrep has been posted', type: 'textarea' },
      { key: 'hub_connect_warning',   label: 'Connect tab warning',     tip: 'Safety notice players see before joining',       type: 'textarea' },
    ],
  },
]

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({})
  const [dirty, setDirty] = useState(false)
  const [flash, setFlash] = useState<{ msg: string; ok: boolean } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const notify = (msg: string, ok = true) => {
    setFlash({ msg, ok })
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setFlash(null), 5000)
  }

  const load = useCallback(async () => {
    const s = await adminFetch('/admin/settings').catch(() => ({}))
    setSettings(s)
    setDirty(false)
  }, [])

  useEffect(() => { load() }, [load])

  const set = (key: string, value: string) => {
    setSettings(s => ({ ...s, [key]: value }))
    setDirty(true)
  }

  const save = async () => {
    try {
      await adminFetch('/admin/settings', { method: 'PUT', body: JSON.stringify(settings) })
      notify('All settings saved')
      setDirty(false)
    } catch (e: any) {
      notify(e.message, false)
    }
  }

  const fmtInterval = (secs: string) => {
    const n = parseInt(secs)
    if (!n) return ''
    const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60)
    return h > 0 ? ` (${h}h${m > 0 ? ` ${m}m` : ''})` : m > 0 ? ` (${m}m)` : ` (${n}s)`
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div className="page-title">ALL SETTINGS</div>
          <div className="page-sub">Every configurable aspect of the arena - stored in DB, effective immediately.</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          {dirty && <span style={{ fontSize: '0.72rem', color: 'var(--amber)' }}>Unsaved changes</span>}
          <button className="btn btn-primary" onClick={save}>Save All Settings</button>
        </div>
      </div>

      {flash && <div className={`flash ${flash.ok ? 'flash-ok' : 'flash-err'}`}>{flash.msg}</div>}

      {SECTIONS.map(sec => (
        <div key={sec.title} className="section" style={{ borderTop: `2px solid ${sec.color}` }}>
          <div className="section-head">
            <span className="section-title" style={{ color: sec.color }}>{sec.title}</span>
          </div>
          <div className="section-body">
            <div className="section-sub">{sec.sub}</div>
            <div className="form-grid">
              {sec.fields.map(f => (
                <div key={f.key} className="form-group">
                  <label className="form-label" title={f.tip}>
                    {f.label}
                    {'  '}<span style={{ color: 'var(--txt-dim)', fontSize: '0.62rem', cursor: 'help', borderBottom: '1px dotted var(--txt-dim)' }} title={f.tip}>?</span>
                    {f.key.endsWith('_interval_s') && settings[f.key] && (
                      <span style={{ color: 'var(--txt-dim)', marginLeft: 4 }}>{fmtInterval(settings[f.key])}</span>
                    )}
                  </label>
                  {f.type === 'textarea' ? (
                    <textarea
                      className="form-input"
                      value={settings[f.key] ?? ''}
                      onChange={e => set(f.key, e.target.value)}
                    />
                  ) : f.type === 'select' ? (
                    <select className="form-input" value={settings[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}>
                      {f.options?.map(o => (
                        <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="form-input"
                      type={f.type}
                      value={settings[f.key] ?? ''}
                      onChange={e => set(f.key, e.target.value)}
                    />
                  )}
                  <div className="form-hint">{f.tip}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}

      {/* Raw settings - everything else in DB */}
      <div className="section">
        <div className="section-head">
          <span className="section-title">ALL DB SETTINGS (raw)</span>
        </div>
        <div className="section-body">
          <div className="section-sub">All keys currently stored in the settings table. Edit above to change them.</div>
          <div className="table-scroll">
            <table className="ck-table">
              <thead><tr><th>Key</th><th>Value</th></tr></thead>
              <tbody>
                {Object.entries(settings).sort().map(([k, v]) => (
                  <tr key={k}>
                    <td><code>{k}</code></td>
                    <td style={{ color: 'var(--txt-dim)', fontSize: '0.78rem', maxWidth: 400 }}>{v || <em>-</em>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: '14px 0', background: 'var(--bg)', borderTop: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center' }}>
        {dirty && <span style={{ fontSize: '0.78rem', color: 'var(--amber)' }}>● Unsaved changes</span>}
        <button className="btn btn-primary" onClick={save}>Save All Settings</button>
        <button className="btn" onClick={load}>Discard</button>
      </div>
    </div>
  )
}
