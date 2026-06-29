'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { resolveRuntimeAPI } from '../../lib/api'

export default function LoginPage() {
  const router = useRouter()

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('ck_player_handle')) {
      router.replace('/')
    }
  }, [router])
  const [handle, setHandle] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)


  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await fetch(`${resolveRuntimeAPI()}/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: handle.trim(), password }),
      })
      const data = await r.json()
      if (!r.ok) {
        setError(data.error || 'Login failed')
      } else {
        // Session token is in an HttpOnly cookie; only the handle lives in localStorage.
        localStorage.setItem('ck_player_handle', data.handle)
        window.dispatchEvent(new Event('storage'))
        router.push(`/player/${data.handle}`)
      }
    } catch {
      setError('Could not reach the arena server')
    } finally {
      setLoading(false)
    }
  }


  return (
    <div className="auth-shell">
      <div style={{ maxWidth: 480, width: '100%' }}>
        <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--cyan)', marginBottom: 14 }}>
          ARENA LOGIN
        </div>
        <h1 style={{ fontFamily: 'var(--hud)', fontSize: '1.8rem', color: 'var(--mag)', marginBottom: 8 }}>
          SIGN IN
        </h1>
        <p style={{ fontFamily: 'var(--body)', color: 'var(--txt-dim)', marginBottom: 32, fontSize: '0.95rem', lineHeight: 1.65 }}>
          Enter your handle and password to access your operative profile.
        </p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6, letterSpacing: '0.06em' }}>
              HANDLE
            </label>
            <input
              className="chat-input"
              style={{ fontSize: '1rem', padding: '10px 12px' }}
              value={handle}
              onChange={e => setHandle(e.target.value)}
              placeholder="your-handle"
              required
              autoFocus
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6, letterSpacing: '0.06em' }}>
              PASSWORD
            </label>
            <input
              className="chat-input"
              style={{ fontSize: '1rem', padding: '10px 12px' }}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div style={{ color: 'var(--red)', fontSize: '0.88rem', padding: '10px 12px', background: 'var(--panel)', borderLeft: '3px solid var(--red)' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn-mag"
            disabled={loading}
            style={{ opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'SIGNING IN…' : 'SIGN IN →'}
          </button>
        </form>


        <p style={{ marginTop: 24, fontSize: '0.82rem', color: 'var(--txt-dim)', fontFamily: 'var(--body)' }}>
          No account?{' '}
          <Link href="/signup" style={{ color: 'var(--cyan)' }}>Register here</Link>
          {' · '}
          <Link href="/hub" style={{ color: 'var(--txt-dim)' }}>Back to Hub</Link>
        </p>
      </div>
    </div>
  )
}
