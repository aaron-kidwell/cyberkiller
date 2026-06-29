'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { resolveRuntimeAPI, saveAdminCreds } from '../../lib/api'

export default function AdminLoginPage() {
  const router = useRouter()
  const [handle, setHandle] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!handle.trim() || !pass) return
    setErr('')
    setLoading(true)
    try {
      // Probe a lightweight admin endpoint to verify credentials
      const res = await fetch(`${resolveRuntimeAPI()}/admin/audit-log`, {
        headers: {
          'X-Admin-User': handle.trim(),
          'X-Admin-Pass': pass,
        },
      })
      if (res.status === 401) {
        setErr('Invalid credentials')
        return
      }
      if (!res.ok) {
        setErr('Server error - try again')
        return
      }
      saveAdminCreds(handle.trim(), pass)
      router.push('/')
    } catch {
      setErr('Could not reach the API server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <form onSubmit={submit} style={{
        background: 'var(--panel)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '36px 40px', width: 360,
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ck-logo-300.png" alt="CYBERKILLER" style={{ height: 64, width: 'auto' }} />
          <div style={{ fontFamily: 'var(--hud)', fontSize: '1.1rem', color: 'var(--mag)', letterSpacing: '0.1em' }}>
            CONTROL ROOM
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label className="form-label">Handle</label>
          <input
            className="form-input"
            value={handle}
            onChange={e => setHandle(e.target.value)}
            placeholder="CyberKiller"
            autoFocus
            autoComplete="username"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label className="form-label">Password</label>
          <input
            className="form-input"
            type="password"
            value={pass}
            onChange={e => setPass(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>

        {err && (
          <div style={{ fontSize: '0.78rem', color: 'var(--red)' }}>{err}</div>
        )}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || !handle.trim() || !pass}
          style={{ marginTop: 4 }}
        >
          {loading ? 'Verifying…' : 'Sign In'}
        </button>
      </form>
    </div>
  )
}
