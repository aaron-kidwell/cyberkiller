'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { API, resolveRuntimeAPI } from '../../../../lib/api'

export default function ChangePasswordPage() {
  const { handle } = useParams<{ handle: string }>()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState('')
  const [isError, setIsError] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (next !== confirm) {
      setMsg('Passwords do not match')
      setIsError(true)
      return
    }
    if (next.length < 12) {
      setMsg('Password must be at least 12 characters')
      setIsError(true)
      return
    }
    setLoading(true)
    setMsg('')
    try {
      // ck_agent_token = invite token (used only as fallback for accounts without a password yet)
      const inviteToken = localStorage.getItem('ck_agent_token') ?? ''
      const r = await fetch(`${resolveRuntimeAPI()}/player/${handle}/password`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: next, invite_token: inviteToken }),
      })
      const d = await r.json()
      if (r.ok) {
        // Server set a fresh session cookie. Just refresh the displayed agent token.
        if (d.invite_token) localStorage.setItem('ck_agent_token', d.invite_token)
        setMsg('Password updated. All other sessions are logged out + a new agent invite token has been issued.')
        setIsError(false)
        setCurrent(''); setNext(''); setConfirm('')
      } else {
        setMsg(d.error || 'Failed to update password')
        setIsError(true)
      }
    } catch {
      setMsg('Could not reach the arena server')
      setIsError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="landing-scroll">
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '48px 24px' }}>
        <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--cyan)', marginBottom: 14 }}>
          ACCOUNT SECURITY
        </div>
        <h1 style={{ fontFamily: 'var(--hud)', fontSize: '1.8rem', color: 'var(--mag)', marginBottom: 8 }}>
          CHANGE PASSWORD
        </h1>
        <p style={{ fontFamily: 'var(--body)', color: 'var(--txt-dim)', marginBottom: 32, fontSize: '0.95rem', lineHeight: 1.65 }}>
          Update the password for <strong style={{ color: 'var(--txt-bright)' }}>{handle}</strong>.
          If you never set a password during registration, leave the current password blank.
        </p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6, letterSpacing: '0.06em' }}>
              CURRENT PASSWORD
            </label>
            <input
              className="chat-input"
              style={{ fontSize: '1rem', padding: '10px 12px' }}
              type="password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              placeholder="leave blank if no password set"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6, letterSpacing: '0.06em' }}>
              NEW PASSWORD <span style={{ color: 'var(--txt-dim)' }}>(min 12 chars)</span>
            </label>
            <input
              className="chat-input"
              style={{ fontSize: '1rem', padding: '10px 12px' }}
              type="password"
              value={next}
              onChange={e => setNext(e.target.value)}
              placeholder="new password"
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6, letterSpacing: '0.06em' }}>
              CONFIRM NEW PASSWORD
            </label>
            <input
              className="chat-input"
              style={{ fontSize: '1rem', padding: '10px 12px' }}
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="confirm new password"
              required
            />
            {confirm.length > 0 && next !== confirm && (
              <p style={{ color: 'var(--red)', fontSize: '0.78rem', marginTop: 6, marginBottom: 0, fontFamily: 'var(--body)' }}>
                Passwords do not match
              </p>
            )}
          </div>

          {msg && (
            <div style={{
              padding: '10px 12px', fontSize: '0.88rem',
              background: 'var(--panel)',
              borderLeft: `3px solid ${isError ? 'var(--red)' : 'var(--green)'}`,
              color: isError ? 'var(--red)' : 'var(--green)',
            }}>
              {msg}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="submit" className="btn-mag" disabled={loading} style={{ opacity: loading ? 0.6 : 1 }}>
              {loading ? 'UPDATING…' : 'UPDATE PASSWORD →'}
            </button>
            <Link href={`/player/${handle}/edit`} style={{ fontSize: '0.82rem', color: 'var(--txt-dim)' }}>
              ← Back to profile edit
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
