'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { resolveRuntimeAPI } from '../../lib/api'

const CATEGORIES = [
  { value: 'feedback_feature', label: 'FEATURE REQUEST', desc: 'Something you\'d like to see added' },
  { value: 'feedback_ux',      label: 'UX / DESIGN',     desc: 'Flow, layout, or clarity improvements' },
  { value: 'feedback_content', label: 'CONTENT',          desc: 'Machine quality, difficulty, challenge design' },
  { value: 'feedback_general', label: 'GENERAL',          desc: 'Anything else on your mind' },
]

export default function FeedbackPage() {
  const router = useRouter()
  const [category, setCategory] = useState('feedback_general')
  const [body, setBody] = useState('')
  const [msg, setMsg] = useState('')
  const [isError, setIsError] = useState(false)
  const [loading, setLoading] = useState(false)
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
        setMsg('Feedback received, thank you.')
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
            Log in to give feedback
          </h2>
          <p style={{ color: 'var(--txt-dim)', fontSize: '0.9rem', marginBottom: 28 }}>
            Your session has expired or you&apos;re not logged in.
          </p>
          <Link href="/login?next=/feedback" className="btn-mag" style={{ width: 'auto' }}>
            LOG IN →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="landing-scroll">
      <div style={{ maxWidth: 580, margin: '0 auto', padding: '48px 24px' }}>
        <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--cyan)', marginBottom: 14 }}>
          PLAYER FEEDBACK
        </div>
        <h1 style={{ fontFamily: 'var(--hud)', fontSize: '1.8rem', color: 'var(--mag)', marginBottom: 8 }}>
          GIVE FEEDBACK
        </h1>
        <p style={{ fontFamily: 'var(--body)', color: 'var(--txt-dim)', marginBottom: 32, fontSize: '0.95rem', lineHeight: 1.65 }}>
          Feature requests, design notes, challenge feedback, all of it shapes what gets built next.
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
                    background: category === c.value ? 'rgba(34,211,238,0.08)' : 'var(--panel)',
                    border: `1px solid ${category === c.value ? 'var(--cyan)' : 'var(--border)'}`,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontFamily: 'var(--hud)', fontSize: '0.72rem', color: category === c.value ? 'var(--cyan)' : 'var(--txt-bright)', letterSpacing: '0.1em', marginBottom: 3 }}>
                    {c.label}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--txt-dim)', fontFamily: 'var(--body)' }}>{c.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6, letterSpacing: '0.06em' }}>
              YOUR FEEDBACK
            </label>
            <textarea
              className="chat-input editor-input editor-textarea"
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Be as specific as you like. What worked, what didn't, what would make this better?"
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
              {loading ? 'SENDING…' : 'SUBMIT FEEDBACK →'}
            </button>
            <Link href="/hub" style={{ fontSize: '0.82rem', color: 'var(--txt-dim)' }}>← Back to Hub</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
