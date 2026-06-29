'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { resolveRuntimeAPI } from '../../lib/api'

const CATEGORIES = [
  { value: 'bug',      label: 'BUG',        desc: 'Something is broken or behaving wrong' },
  { value: 'cheating', label: 'CHEATING',   desc: 'Suspected player exploit abuse or rule violation' },
  { value: 'machine',  label: 'MACHINE',    desc: 'Target is unreachable, misconfigured, or unfair' },
  { value: 'general',  label: 'GENERAL',    desc: 'Anything else' },
]

export default function ReportPage() {
  const router = useRouter()
  const [category, setCategory] = useState('bug')
  const [body, setBody] = useState('')
  const [msg, setMsg] = useState('')
  const [isError, setIsError] = useState(false)
  const [loading, setLoading] = useState(false)
  // null = unknown, false = not logged in, true = logged in (verified via /session/check)
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)

  useEffect(() => {
    fetch(`${resolveRuntimeAPI()}/session/check`, { credentials: 'include' })
      .then(r => setLoggedIn(r.ok))
      .catch(() => setLoggedIn(false))
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim() || !loggedIn) return
    setLoading(true)
    setMsg('')
    try {
      const r = await fetch(`${resolveRuntimeAPI()}/report`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, body }),
      })
      if (r.ok) {
        setMsg('Report received, operators will review it shortly.')
        setIsError(false)
        setBody('')
      } else {
        const d = await r.json().catch(() => ({}))
        setMsg(d.error || 'Submission failed, try again.')
        setIsError(true)
      }
    } catch {
      setMsg('Could not reach the arena server.')
      setIsError(true)
    } finally {
      setLoading(false)
    }
  }

  if (loggedIn === false) {
    return (
      <div className="landing-scroll">
        <div style={{ maxWidth: 580, margin: '0 auto', padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--mag)', marginBottom: 14 }}>
            SESSION REQUIRED
          </div>
          <h2 style={{ fontFamily: 'var(--hud)', color: 'var(--txt-bright)', marginBottom: 12 }}>
            Log in to submit a report
          </h2>
          <p style={{ color: 'var(--txt-dim)', fontSize: '0.9rem', marginBottom: 28 }}>
            Your session has expired or you&apos;re not logged in.
          </p>
          <Link href="/login?next=/report" className="btn-mag" style={{ width: 'auto' }}>
            LOG IN →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="landing-scroll">
      <div style={{ maxWidth: 580, margin: '0 auto', padding: '48px 24px' }}>
        <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--red)', marginBottom: 14 }}>
          PROBLEM REPORT
        </div>
        <h1 style={{ fontFamily: 'var(--hud)', fontSize: '1.8rem', color: 'var(--mag)', marginBottom: 8 }}>
          REPORT A PROBLEM
        </h1>
        <p style={{ fontFamily: 'var(--body)', color: 'var(--txt-dim)', marginBottom: 32, fontSize: '0.95rem', lineHeight: 1.65 }}>
          Report bugs, suspected cheating, broken machines, or anything else that needs operator attention.
        </p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 10, letterSpacing: '0.06em' }}>
              CATEGORY
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {CATEGORIES.map(c => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  style={{
                    padding: '10px 12px', textAlign: 'left',
                    background: category === c.value ? 'rgba(232,52,198,0.1)' : 'var(--panel)',
                    border: `1px solid ${category === c.value ? 'var(--mag)' : 'var(--border)'}`,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontFamily: 'var(--hud)', fontSize: '0.72rem', color: category === c.value ? 'var(--mag)' : 'var(--txt-bright)', letterSpacing: '0.1em', marginBottom: 3 }}>
                    {c.label}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--txt-dim)', fontFamily: 'var(--body)' }}>{c.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6, letterSpacing: '0.06em' }}>
              DESCRIPTION
            </label>
            <textarea
              className="chat-input editor-input editor-textarea"
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Describe the problem clearly. Include machine IPs, player handles, or steps to reproduce if relevant."
              rows={6}
              required
            />
          </div>

          {msg && (
            <div style={{
              padding: '12px 14px', fontSize: '0.88rem',
              background: 'var(--panel)',
              borderLeft: `3px solid ${isError ? 'var(--red)' : 'var(--green)'}`,
              color: isError ? 'var(--red)' : 'var(--green)',
            }}>
              {msg}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="submit" className="btn-mag" disabled={loading || !body.trim()} style={{ opacity: loading || !body.trim() ? 0.6 : 1 }}>
              {loading ? 'SENDING…' : 'SUBMIT REPORT →'}
            </button>
            <Link href="/hub" style={{ fontSize: '0.82rem', color: 'var(--txt-dim)' }}>← Back to Hub</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
