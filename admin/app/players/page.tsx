'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { adminFetch, WEB_URL } from '../../lib/api'

type Player = {
  handle: string; arena_ip: string; connected: boolean
  banned: boolean; is_admin: boolean; last_heartbeat?: string
}

function SetPasswordModal({ handle, onClose, onDone }: { handle: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [pw, setPw] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pw.length < 8) { setErr('Min 8 characters'); return }
    setSaving(true)
    try {
      await adminFetch(`/admin/players/${handle}/set-password`, { method: 'POST', body: JSON.stringify({ password: pw }) })
      onDone(`Password set for ${handle}`)
      onClose()
    } catch (ex: any) {
      setErr(ex.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={submit} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '28px 32px', width: 340, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontFamily: 'var(--hud)', fontSize: '0.75rem', color: 'var(--mag)', letterSpacing: '0.1em' }}>
          SET PASSWORD - @{handle}
        </div>
        <div>
          <label className="form-label">New Password</label>
          <input className="form-input" type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="min 8 characters" autoFocus />
        </div>
        {err && <div style={{ fontSize: '0.75rem', color: 'var(--red)' }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Set Password'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

export default function PlayersPage() {
  const [list, setList] = useState<Player[]>([])
  const [search, setSearch] = useState('')
  const [pwModal, setPwModal] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ msg: string; ok: boolean } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const notify = (msg: string, ok = true) => {
    setFlash({ msg, ok })
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setFlash(null), 4000)
  }

  const load = useCallback(() => {
    adminFetch('/admin/players').then(setList).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn(); notify(label); load() }
    catch (e: any) { notify(e.message, false) }
  }

  const filtered = list.filter(p =>
    !search || p.handle.toLowerCase().includes(search.toLowerCase()) || p.arena_ip?.includes(search)
  )

  const fmtTime = (t?: string) => {
    if (!t) return '-'
    const d = new Date(t)
    const diff = Math.floor((Date.now() - d.getTime()) / 1000)
    if (diff < 120) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return d.toLocaleDateString()
  }

  const online = list.filter(p => p.connected).length
  const banned = list.filter(p => p.banned).length

  return (
    <div>
      <div className="page-header">
        <div className="page-title">PLAYERS</div>
        <div className="page-sub">{list.length} registered · {online} online · {banned} banned</div>
      </div>

      {flash && <div className={`flash ${flash.ok ? 'flash-ok' : 'flash-err'}`}>{flash.msg}</div>}
      {pwModal && <SetPasswordModal handle={pwModal} onClose={() => setPwModal(null)} onDone={msg => notify(msg)} />}

      <div className="section">
        <div className="section-head">
          <span className="section-title">ALL PLAYERS ({filtered.length})</span>
          <input
            className="form-input sm"
            style={{ width: 220 }}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search handle or IP…"
          />
        </div>
        <div className="table-scroll">
          <table className="ck-table">
            <thead>
              <tr>
                <th>Handle</th>
                <th>Arena IP</th>
                <th>Status</th>
                <th>Last Seen</th>
                <th>Admin</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.handle}>
                  <td>
                    <a href={`${WEB_URL}/player/${p.handle}`} target="_blank" rel="noreferrer"
                      style={{ color: 'var(--txt-bright)', fontWeight: 600 }}>
                      {p.handle}
                    </a>
                  </td>
                  <td><code>{p.arena_ip || '-'}</code></td>
                  <td>
                    {p.banned
                      ? <span className="badge badge-red">BANNED</span>
                      : p.connected
                        ? <><span className="live-dot" /><span className="badge badge-green">ONLINE</span></>
                        : <span className="badge badge-dim">offline</span>
                    }
                  </td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--txt-dim)' }}>{fmtTime(p.last_heartbeat)}</td>
                  <td>
                    {p.is_admin
                      ? <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>ADMIN</span>
                      : <span className="badge badge-dim" style={{ fontSize: '0.65rem' }}>-</span>
                    }
                  </td>
                  <td>
                    <div className="action-row">
                      {p.connected && !p.banned && (
                        <button className="btn btn-xs"
                          onClick={() => act(`Kicked ${p.handle}`, () => adminFetch(`/admin/players/${p.handle}/kick`, { method: 'POST' }))}>
                          Kick
                        </button>
                      )}
                      <button className="btn btn-xs" style={{ borderColor: 'var(--cyan)', color: 'var(--cyan)' }}
                        onClick={() => {
                          if (!confirm(`Reset all scores for ${p.handle}?`)) return
                          act(`Score reset: ${p.handle}`, () => adminFetch(`/admin/players/${p.handle}/reset-score`, { method: 'POST' }))
                        }}>
                        Reset Score
                      </button>
                      <button className="btn btn-xs" style={{ borderColor: 'var(--txt-dim)', color: 'var(--txt-dim)' }}
                        onClick={() => setPwModal(p.handle)}>
                        Set Password
                      </button>
                      <button className={`btn btn-xs ${p.is_admin ? 'btn-danger' : ''}`}
                        style={!p.is_admin ? { borderColor: 'var(--mag)', color: 'var(--mag)' } : {}}
                        onClick={() => {
                          const msg = p.is_admin
                            ? `Revoke admin from ${p.handle}?`
                            : `Grant admin access to ${p.handle}?\n\nThey will be able to log into the control room with their handle and password.`
                          if (!confirm(msg)) return
                          act(p.is_admin ? `Admin revoked: ${p.handle}` : `Admin granted: ${p.handle}`, () =>
                            adminFetch(`/admin/players/${p.handle}/set-admin`, { method: 'POST', body: JSON.stringify({ is_admin: !p.is_admin }) }))
                        }}>
                        {p.is_admin ? 'Revoke Admin' : 'Grant Admin'}
                      </button>
                      <button className={`btn btn-xs ${p.banned ? '' : 'btn-danger'}`}
                        onClick={() => act(p.banned ? `Unbanned ${p.handle}` : `Banned ${p.handle}`, () =>
                          adminFetch(`/admin/players/${p.handle}/ban`, { method: 'POST', body: JSON.stringify({ banned: !p.banned }) }))}>
                        {p.banned ? 'Unban' : 'Ban'}
                      </button>
                      <button className="btn btn-xs btn-danger"
                        onClick={() => {
                          if (!confirm(`Permanently delete ${p.handle} and all their data?`)) return
                          act(`Deleted ${p.handle}`, () => adminFetch(`/admin/players/${p.handle}`, { method: 'DELETE' }))
                        }}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--txt-dim)', padding: '24px' }}>No players found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
