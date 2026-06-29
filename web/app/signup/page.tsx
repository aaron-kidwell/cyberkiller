'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { resolveRuntimeAPI, authFetch, clearLocalSession } from '../../lib/api'
import { E } from '../../components/E'

type SignupResult = {
  player_id: string
  handle: string
  invite_token: string
}

export default function SignupPage() {
  const router = useRouter()

  useEffect(() => {
    // Only bounce to the hub if there's a REAL, still-valid session. A leftover
    // ck_player_handle from an expired session must not block sign-up - verify
    // against the server (authFetch clears the stale marker on 401).
    if (typeof window === 'undefined' || !localStorage.getItem('ck_player_handle')) return
    authFetch('/sitrep/latest')
      .then(r => { if (r.ok) router.replace('/'); else clearLocalSession() })
      .catch(() => {})
  }, [router])
  const [handle, setHandle] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [codeRequired, setCodeRequired] = useState(false)
  const [result, setResult] = useState<SignupResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch(`${resolveRuntimeAPI()}/signup/mode`)
      .then(r => r.json())
      .then(d => setCodeRequired(!!d?.code_required))
      .catch(() => {})
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 12) {
      setError('Password required, must be at least 12 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const r = await fetch(`${resolveRuntimeAPI()}/signup`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: handle.trim(), invite_code: inviteCode.trim(), password }),
      })
      const data = await r.json()
      if (!r.ok) {
        setError(data.error || 'Registration failed')
      } else {
        setResult(data)
        // Session token is in an HttpOnly cookie set by the server.
        localStorage.setItem('ck_player_handle', data.handle)
        window.dispatchEvent(new Event('storage'))
      }
    } catch {
      setError('Could not reach the arena server')
    } finally {
      setLoading(false)
    }
  }

  if (result) {
    return (
      <div className="auth-shell">
        <div style={{ maxWidth: 600, width: '100%' }}>
          <div style={{ marginBottom: 20, fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--green)' }}>
            REGISTRATION COMPLETE
          </div>
          <h2 style={{ fontFamily: 'var(--hud)', fontSize: '1.4rem', color: 'var(--txt-bright)', marginBottom: 24 }}>
            You&apos;re in, {result.handle}
          </h2>

          <p className="hint" style={{ marginBottom: 24, lineHeight: 1.7 }}>
            You&apos;re logged in. Head to the hub to see the live targets and where to reach
            them, then attack from your own VM. Capture the flags
            (<code style={{ color: 'var(--cyan)' }}>/home/ckplayer/user.txt</code> and
            <code style={{ color: 'var(--cyan)' }}> /root/root.txt</code>) and report them to
            your instructor to score.
          </p>

          <div className="warn-box" style={{ marginBottom: 24 }}>
            <strong style={{ color: 'var(--red)' }}>Use a dedicated attack VM</strong>
            <p style={{ marginTop: 8, fontFamily: 'var(--body)', color: 'var(--txt-dim)', fontSize: '0.9rem' }}>
              Attack from a Kali/Parrot VM, not your daily machine. The targets are
              intentionally vulnerable.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link href="/hub" className="btn-mag">ENTER THE HUB →</Link>
            <Link href={`/player/${result.handle}`} className="btn-mag"
              style={{ background: 'transparent', color: 'var(--cyan)', border: '1px solid var(--cyan)' }}>
              MY PROFILE →
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="landing-scroll">
      <div className="ck-reveal" style={{ maxWidth: 520, margin: '0 auto', padding: '48px 24px' }}>
        <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--cyan)', marginBottom: 14 }}>
          <E id="signup.eyebrow">ARENA REGISTRATION</E>
        </div>
        <h1 style={{ fontFamily: 'var(--hud)', fontSize: '1.8rem', color: 'var(--mag)', marginBottom: 8 }}>
          <E id="signup.title">CREATE ACCOUNT</E>
        </h1>
        <p style={{ fontFamily: 'var(--body)', color: 'var(--txt-dim)', marginBottom: 32, fontSize: '0.95rem', lineHeight: 1.65 }}>
          <E id="signup.subtitle">Register your handle to join the arena, then log in and start attacking the range from your own VM.</E>
        </p>

        <div className="warn-box">
          <strong style={{ color: 'var(--red)' }}><E id="signup.warning.title">Isolated attack VM required</E></strong>
          <p style={{ marginTop: 6, fontFamily: 'var(--body)', color: 'var(--txt-dim)', fontSize: '0.88rem' }}>
            <E id="signup.warning.body">You must connect with a dedicated Kali or Parrot VM, not your personal machine. Range machines only are in scope.</E>
          </p>
        </div>

        <form onSubmit={submit} style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {codeRequired && (
            <div style={{
              border: '1px solid var(--mag)', background: 'rgba(232,52,198,0.06)',
              padding: '14px 14px 12px', borderRadius: 2,
            }}>
              <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--mag)', marginBottom: 6, letterSpacing: '0.08em' }}>
                INVITE CODE <span style={{ color: 'var(--red)' }}>*</span>{' '}
                <span style={{ color: 'var(--txt-dim)' }}>(required, ask the operator)</span>
              </label>
              <input
                className="chat-input"
                style={{ fontSize: '1rem', padding: '10px 12px', borderColor: 'var(--mag)' }}
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                placeholder="paste your invite code here"
                required
                autoFocus
              />
              <p style={{ fontFamily: 'var(--body)', color: 'var(--txt-dim)', fontSize: '0.8rem', marginTop: 8, marginBottom: 0, lineHeight: 1.5 }}>
                Enter the invite code your instructor or the range operator gave you.
              </p>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6, letterSpacing: '0.06em' }}>
              HANDLE <span style={{ color: 'var(--txt-dim)' }}>(2–32 chars, letters/numbers/-/_)</span>
            </label>
            <input
              className="chat-input"
              style={{ fontSize: '1rem', padding: '10px 12px' }}
              value={handle}
              onChange={e => setHandle(e.target.value)}
              placeholder="local-kali"
              pattern="[a-zA-Z0-9_-]{2,32}"
              required
              autoFocus={!codeRequired}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6, letterSpacing: '0.06em' }}>
              PASSWORD <span style={{ color: 'var(--red)' }}>*</span>
            </label>
            <input
              className="chat-input"
              style={{ fontSize: '1rem', padding: '10px 12px' }}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="min 12 characters"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6, letterSpacing: '0.06em' }}>
              CONFIRM PASSWORD <span style={{ color: 'var(--red)' }}>*</span>
            </label>
            <input
              className="chat-input"
              style={{ fontSize: '1rem', padding: '10px 12px' }}
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="re-enter password"
            />
            {confirmPassword.length > 0 && password !== confirmPassword && (
              <p style={{ color: 'var(--red)', fontSize: '0.78rem', marginTop: 6, marginBottom: 0, fontFamily: 'var(--body)' }}>
                Passwords do not match
              </p>
            )}
          </div>

          {!codeRequired && (
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6, letterSpacing: '0.06em' }}>
                INVITE CODE <span style={{ color: 'var(--txt-dim)' }}>(optional unless operator requires)</span>
              </label>
              <input
                className="chat-input"
                style={{ fontSize: '1rem', padding: '10px 12px' }}
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                placeholder="leave blank for open registration"
              />
            </div>
          )}

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
            {loading ? 'REGISTERING…' : 'REGISTER →'}
          </button>
        </form>

        <p style={{ marginTop: 24, fontSize: '0.82rem', color: 'var(--txt-dim)', fontFamily: 'var(--body)' }}>
          Already registered?{' '}
          <Link href="/login" style={{ color: 'var(--cyan)' }}>Sign in</Link>
          {' or '}
          <Link href="/hub?tab=connect" style={{ color: 'var(--txt-dim)' }}>go to the Hub</Link>.
        </p>
      </div>
    </div>
  )
}
