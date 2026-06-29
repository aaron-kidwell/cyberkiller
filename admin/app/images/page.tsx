'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { adminFetch, getAdminCreds, resolveRuntimeAPI } from '../../lib/api'

type CatalogImage = {
  id: string
  name: string
  docker_image: string
  tier: string
  description?: string
  ssh_port: number
  web_port: number
  enabled: boolean
  fail_count: number
  source: string
  needs_flag_inject: boolean
  live: boolean
}

type LiveTarget = {
  id: string
  arena_ip: string
  image_name: string
  tier: string
  status: string
  king_handle: string
  user_flag_by: string
  image_id: string
  ssh_password: string
  planted_user_flag: string
  planted_root_flag: string
  user_flag_captured: boolean
  root_flag_captured: boolean
}

const blankForm = { name: '', docker_image: '', tier: 'easy', ssh_port: 22, web_port: 80, root_password: '', needs_flag_inject: false, koth_enabled: false, user_flag_path: '/home/ckplayer/user.txt', root_flag_path: '/root/root.txt', spin: true }

export default function TargetsPage() {
  const [catalog, setCatalog] = useState<CatalogImage[]>([])
  const [live, setLive] = useState<LiveTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState<{ msg: string; ok: boolean } | null>(null)
  const [form, setForm] = useState({ ...blankForm })
  const [handles, setHandles] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  const notify = (msg: string, ok = true) => {
    setFlash({ msg, ok })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setFlash(null), 4000)
  }

  const load = useCallback(async () => {
    try {
      const [imgs, hills] = await Promise.all([adminFetch('/admin/images'), adminFetch('/admin/hills')])
      setCatalog(imgs ?? [])
      setLive((hills ?? []).filter((h: LiveTarget) => h.status === 'active' || h.status === 'spinning'))
      setError('')
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t) }, [load])

  const post = async (path: string, body?: object) => {
    setBusy(true)
    try {
      const res = await adminFetch(path, { method: body ? 'POST' : 'POST', body: body ? JSON.stringify(body) : undefined })
      load()
      return res
    } catch (e: any) { notify(e.message, false); throw e } finally { setBusy(false) }
  }

  const addReference = async () => {
    if (!form.name || !form.docker_image) { notify('name and image are required', false); return }
    try {
      await post('/admin/targets', form)
      notify(form.spin ? `${form.name} added and spinning` : `${form.name} added`)
      setForm({ ...blankForm })
    } catch { /* notified */ }
  }

  const upload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file || !form.name) { notify('pick a .tar and set a name', false); return }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', form.name)
      fd.append('tier', form.tier)
      fd.append('ssh_port', String(form.ssh_port))
      fd.append('web_port', String(form.web_port))
      fd.append('root_password', form.root_password)
      fd.append('needs_flag_inject', String(form.needs_flag_inject))
      fd.append('koth_enabled', String(form.koth_enabled))
      fd.append('user_flag_path', form.user_flag_path)
      fd.append('root_flag_path', form.root_flag_path)
      const { user, pass } = getAdminCreds()
      const res = await fetch(`${resolveRuntimeAPI()}/admin/targets/upload`, {
        method: 'POST',
        headers: { 'X-Admin-User': user, 'X-Admin-Pass': pass },
        body: fd,
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'upload failed')
      notify(`${form.name} loaded`)
      setForm({ ...blankForm })
      if (fileRef.current) fileRef.current.value = ''
      load()
    } catch (e: any) { notify(e.message, false) } finally { setBusy(false) }
  }

  const award = async (t: LiveTarget, kind: 'user_flag' | 'root_flag') => {
    const handle = (handles[t.arena_ip] || '').trim()
    if (!handle) { notify('enter a player handle first', false); return }
    try {
      await post('/admin/award', { handle, arena_ip: t.arena_ip, kind })
      notify(`awarded ${kind === 'root_flag' ? 'root' : 'user'} on ${t.arena_ip} to ${handle}`)
    } catch { /* notified */ }
  }
  const revoke = async (t: LiveTarget, kind: 'user_flag' | 'root_flag') => {
    const handle = (handles[t.arena_ip] || '').trim()
    if (!handle) { notify('enter a player handle first', false); return }
    try {
      await post('/admin/revoke', { handle, arena_ip: t.arena_ip, kind })
      notify(`revoked ${kind === 'root_flag' ? 'root' : 'user'} on ${t.arena_ip} from ${handle}`)
    } catch { /* notified */ }
  }

  const f = (k: keyof typeof form, v: any) => setForm(s => ({ ...s, [k]: v }))

  return (
    <div>
      <div className="page-header">
        <div className="page-title">TARGETS</div>
        <div className="page-sub">
          Add a Docker target by registry reference or by uploading a saved image, set the login it should use,
          and the platform spins it on the range and plants flags. Award captures to players below.
        </div>
      </div>

      {flash && <div className={`flash ${flash.ok ? 'flash-ok' : 'flash-err'}`}>{flash.msg}</div>}
      {error && <div style={{ color: 'var(--red)', marginBottom: 16 }}>{error}</div>}

      {/* Add target */}
      <div className="section">
        <div className="section-head"><span className="section-title">ADD A TARGET</span></div>
        <div className="section-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <label>Name
            <input className="form-input" value={form.name} onChange={e => f('name', e.target.value)} placeholder="Vulnerable Web App" />
          </label>
          <label>Docker image (registry reference)
            <input className="form-input" value={form.docker_image} onChange={e => f('docker_image', e.target.value)} placeholder="vulhub/struts2:s2-045" />
          </label>
          <label>Difficulty
            <select className="form-input" value={form.tier} onChange={e => f('tier', e.target.value)}>
              <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
            </select>
          </label>
          <label>Login password <span style={{ color: 'var(--txt-dim)' }}>(blank = random)</span>
            <input className="form-input" value={form.root_password} onChange={e => f('root_password', e.target.value)} placeholder="auto" />
          </label>
          <label>SSH port
            <input className="form-input" type="number" value={form.ssh_port} onChange={e => f('ssh_port', Number(e.target.value))} />
          </label>
          <label>Web port
            <input className="form-input" type="number" value={form.web_port} onChange={e => f('web_port', Number(e.target.value))} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end' }}>
            <input type="checkbox" checked={form.needs_flag_inject} onChange={e => f('needs_flag_inject', e.target.checked)} />
            Inject flags (image has no CK entrypoint)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end' }}>
            <input type="checkbox" checked={form.koth_enabled} onChange={e => f('koth_enabled', e.target.checked)} />
            King of the Hill (auto-score the throne holder)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end' }}>
            <input type="checkbox" checked={form.spin} onChange={e => f('spin', e.target.checked)} />
            Spin immediately
          </label>
          {form.needs_flag_inject && (
            <>
              <label>User flag path
                <input className="form-input" value={form.user_flag_path} onChange={e => f('user_flag_path', e.target.value)} placeholder="/home/ckplayer/user.txt" />
              </label>
              <label>Root flag path
                <input className="form-input" value={form.root_flag_path} onChange={e => f('root_flag_path', e.target.value)} placeholder="/root/root.txt" />
              </label>
            </>
          )}
        </div>
        <div className="section-body" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-cyan" disabled={busy} onClick={addReference}>Add by reference</button>
          <span style={{ color: 'var(--txt-dim)' }}>or upload a <code>docker save</code> tarball:</span>
          <input ref={fileRef} type="file" accept=".tar" />
          <button className="btn" disabled={busy} onClick={upload}>Upload + load</button>
        </div>
      </div>

      {/* Live targets */}
      <div className="section">
        <div className="section-head">
          <span className="section-title">LIVE TARGETS ({live.length})</span>
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={load}>Refresh</button>
        </div>
        {live.length === 0 ? (
          <div className="section-body" style={{ color: 'var(--txt-dim)', fontSize: '0.85rem' }}>Nothing live. Add a target above and spin it.</div>
        ) : (
          <div className="table-scroll">
            <table className="ck-table">
              <thead><tr>
                <th>IP</th><th>Image</th><th>Status</th><th>Login</th><th>Planted flags</th><th>Award to</th><th></th>
              </tr></thead>
              <tbody>
                {live.map(t => (
                  <tr key={t.id}>
                    <td style={{ fontFamily: 'var(--hud)' }}>{t.arena_ip}</td>
                    <td>{t.image_name}</td>
                    <td>{t.status === 'spinning' ? <span className="badge">spinning…</span> : <span style={{ color: 'var(--green)' }}>active</span>}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--txt-dim)' }}>root / {t.ssh_password || '-'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--txt-dim)' }}>
                      <div>user: {t.planted_user_flag || '-'} {t.user_flag_captured && '✓'}</div>
                      <div>root: {t.planted_root_flag || '-'} {t.root_flag_captured && '✓'}</div>
                    </td>
                    <td>
                      <input className="form-input sm" placeholder="handle" style={{ width: 110 }}
                        value={handles[t.arena_ip] || ''} onChange={e => setHandles(h => ({ ...h, [t.arena_ip]: e.target.value }))} />
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        <button className="btn btn-xs" disabled={busy} onClick={() => award(t, 'user_flag')}>+User</button>
                        <button className="btn btn-xs btn-cyan" disabled={busy} onClick={() => award(t, 'root_flag')}>+Root</button>
                        <button className="btn btn-xs" disabled={busy} title="revoke user" onClick={() => revoke(t, 'user_flag')}>−U</button>
                        <button className="btn btn-xs" disabled={busy} title="revoke root" onClick={() => revoke(t, 'root_flag')}>−R</button>
                      </div>
                    </td>
                    <td>
                      <button className="btn btn-xs" disabled={busy} onClick={() => post(`/admin/targets/${t.id}/stop`).then(() => notify(`stopped ${t.arena_ip}`)).catch(() => {})}>Stop</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Catalog */}
      <div className="section">
        <div className="section-head"><span className="section-title">CATALOG ({catalog.length})</span></div>
        {loading ? (
          <div className="section-body" style={{ color: 'var(--txt-dim)' }}>Loading…</div>
        ) : catalog.length === 0 ? (
          <div className="section-body" style={{ color: 'var(--txt-dim)', fontSize: '0.85rem' }}>No images yet.</div>
        ) : (
          <div className="table-scroll">
            <table className="ck-table">
              <thead><tr>
                <th>Name</th><th>Image</th><th>Difficulty</th><th>Source</th><th>Health</th><th>Enabled</th><th></th>
              </tr></thead>
              <tbody>
                {catalog.map(img => (
                  <tr key={img.id} style={{ opacity: img.enabled ? 1 : 0.55 }}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{img.name}{img.live && <span className="badge badge-green" style={{ marginLeft: 6 }}>live</span>}</div>
                      {img.needs_flag_inject && <div style={{ fontSize: '0.7rem', color: 'var(--txt-dim)' }}>flag-inject</div>}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--txt-dim)' }}>{img.docker_image}</td>
                    <td style={{ textTransform: 'capitalize' }}>{img.tier}</td>
                    <td style={{ color: 'var(--txt-dim)', fontSize: '0.75rem' }}>{img.source}</td>
                    <td>{img.fail_count > 0 ? <span className="badge badge-red">{img.fail_count} fails</span> : <span style={{ color: 'var(--green)', fontSize: '0.78rem' }}>OK</span>}</td>
                    <td>
                      <button className={`btn btn-xs ${img.enabled ? 'btn-cyan' : ''}`}
                        onClick={() => adminFetch(`/admin/images/${img.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !img.enabled }) }).then(load).catch(e => notify(e.message, false))}>
                        {img.enabled ? 'ON' : 'OFF'}
                      </button>
                    </td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-xs" disabled={busy || img.live} onClick={() => post(`/admin/targets/${img.id}/spin`).then(() => notify(`spinning ${img.name}`)).catch(() => {})}>Spin</button>
                      <button className="btn btn-xs" disabled={busy || img.live}
                        onClick={() => { if (confirm(`Delete ${img.name} from the catalog?`)) adminFetch(`/admin/images/${img.id}`, { method: 'DELETE' }).then(load).then(() => notify(`${img.name} deleted`)).catch(e => notify(e.message, false)) }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
