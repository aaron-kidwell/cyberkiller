'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { API, resolveRuntimeAPI } from '../../../../lib/api'

export default function PlayerSettingsPage() {
  const { handle } = useParams<{ handle: string }>()
  const router = useRouter()

  // Password change
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)

  // Delete account
  const [delPw, setDelPw] = useState('')
  const [delConfirm, setDelConfirm] = useState('')
  const [delMsg, setDelMsg] = useState('')
  const [delLoading, setDelLoading] = useState(false)

  useEffect(() => {
    const mine = localStorage.getItem('ck_player_handle')
    if (mine !== handle) router.push(`/player/${handle}`)
  }, [handle, router])

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPw !== confirmPw) { setPwMsg('Passwords do not match'); setPwErr(true); return }
    if (newPw.length < 12) { setPwMsg('Password must be at least 12 characters'); setPwErr(true); return }
    setPwLoading(true); setPwMsg('')
    try {
      const r = await fetch(`${resolveRuntimeAPI()}/player/${handle}/password`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: curPw, new_password: newPw }),
      })
      const d = await r.json()
      if (r.ok) {
        // Server rotated the session cookie; other sessions are logged out.
        setPwMsg('Password updated. Other sessions have been logged out.')
        setPwErr(false)
        setCurPw(''); setNewPw(''); setConfirmPw('')
      } else {
        setPwMsg(d.error || 'Failed'); setPwErr(true)
      }
    } catch { setPwMsg('Could not reach server'); setPwErr(true) }
    finally { setPwLoading(false) }
  }

  const deleteAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (delConfirm !== handle) { setDelMsg(`Type your handle "${handle}" to confirm`); return }
    setDelLoading(true); setDelMsg('')
    try {
      const r = await fetch(`${resolveRuntimeAPI()}/player/${handle}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: delPw }),
      })
      const d = await r.json()
      if (r.ok) {
        localStorage.removeItem('ck_player_handle')
        window.dispatchEvent(new Event('storage'))
        router.push('/')
      } else {
        setDelMsg(d.error || 'Failed'); setDelLoading(false)
      }
    } catch { setDelMsg('Could not reach server'); setDelLoading(false) }
  }

  const section = (title: string, color = 'var(--cyan)') => (
    <div style={{ fontSize: '0.65rem', letterSpacing: '0.18em', color, fontFamily: 'var(--hud)', marginBottom: 14 }}>
      {title}
    </div>
  )

  return (
    <div className="landing-scroll">
      <div style={{ maxWidth: 580, margin: '0 auto', padding: '48px 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
          <div>
            <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--txt-dim)', marginBottom: 8 }}>
              ACCOUNT SETTINGS
            </div>
            <h1 style={{ fontFamily: 'var(--hud)', fontSize: '1.6rem', color: 'var(--mag)', margin: 0 }}>
              @{handle}
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href={`/player/${handle}`} style={{ fontSize: '0.75rem', color: 'var(--txt-dim)' }}>← Profile</Link>
            <span style={{ color: 'var(--border)' }}>·</span>
            <Link href={`/player/${handle}/edit`} style={{ fontSize: '0.75rem', color: 'var(--cyan)' }}>Customize</Link>
          </div>
        </div>


        {/* ── CHANGE PASSWORD ── */}
        <div style={{ marginBottom: 40 }}>
          {section('CHANGE PASSWORD', 'var(--mag)')}
          <form onSubmit={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6 }}>
                CURRENT PASSWORD <span style={{ color: 'var(--txt-dim)' }}>(leave blank if none set)</span>
              </label>
              <input className="chat-input" type="password" value={curPw} onChange={e => setCurPw(e.target.value)}
                style={{ fontSize: '1rem', padding: '10px 12px' }} placeholder="current password" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6 }}>
                NEW PASSWORD <span style={{ color: 'var(--txt-dim)' }}>(min 12 chars)</span>
              </label>
              <input className="chat-input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                style={{ fontSize: '1rem', padding: '10px 12px' }} placeholder="new password" required />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6 }}>
                CONFIRM NEW PASSWORD
              </label>
              <input className="chat-input" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                style={{ fontSize: '1rem', padding: '10px 12px' }} placeholder="confirm password" required />
              {confirmPw.length > 0 && newPw !== confirmPw && (
                <p style={{ color: 'var(--red)', fontSize: '0.78rem', marginTop: 6, marginBottom: 0, fontFamily: 'var(--body)' }}>
                  Passwords do not match
                </p>
              )}
            </div>
            {pwMsg && (
              <div style={{ padding: '10px 12px', fontSize: '0.88rem', background: 'var(--panel)', borderLeft: `3px solid ${pwErr ? 'var(--red)' : 'var(--green)'}`, color: pwErr ? 'var(--red)' : 'var(--green)' }}>
                {pwMsg}
              </div>
            )}
            <button type="submit" className="btn-mag" disabled={pwLoading} style={{ alignSelf: 'flex-start', opacity: pwLoading ? 0.6 : 1 }}>
              {pwLoading ? 'UPDATING…' : 'UPDATE PASSWORD →'}
            </button>
          </form>
        </div>

        {/* ── DELETE ACCOUNT ── */}
        <div style={{ marginBottom: 40 }}>
          {section('DANGER ZONE', 'var(--red)')}
          <div style={{ border: '1px solid var(--red)33', padding: '20px' }}>
            <p style={{ color: 'var(--txt-dim)', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: 20 }}>
              Permanently delete your account, kill history, and scores. This cannot be undone.
            </p>
            <form onSubmit={deleteAccount} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6 }}>
                  PASSWORD <span style={{ color: 'var(--txt-dim)' }}>(required if set)</span>
                </label>
                <input className="chat-input" type="password" value={delPw} onChange={e => setDelPw(e.target.value)}
                  style={{ fontSize: '1rem', padding: '10px 12px' }} placeholder="your password" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--red)', marginBottom: 6 }}>
                  TYPE YOUR HANDLE TO CONFIRM: <strong>{handle}</strong>
                </label>
                <input className="chat-input" value={delConfirm} onChange={e => setDelConfirm(e.target.value)}
                  style={{ fontSize: '1rem', padding: '10px 12px', borderColor: delConfirm === handle ? 'var(--red)' : undefined }}
                  placeholder={handle} required />
              </div>
              {delMsg && (
                <div style={{ padding: '10px 12px', fontSize: '0.88rem', background: 'var(--panel)', borderLeft: '3px solid var(--red)', color: 'var(--red)' }}>
                  {delMsg}
                </div>
              )}
              <button type="submit" disabled={delLoading || delConfirm !== handle}
                style={{ alignSelf: 'flex-start', background: 'transparent', border: '1px solid var(--red)', color: 'var(--red)', padding: '10px 20px', fontFamily: 'var(--hud)', fontSize: '0.72rem', letterSpacing: '0.1em', cursor: delConfirm !== handle ? 'not-allowed' : 'pointer', opacity: delConfirm !== handle ? 0.4 : delLoading ? 0.6 : 1 }}>
                {delLoading ? 'DELETING…' : 'DELETE MY ACCOUNT'}
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  )
}
