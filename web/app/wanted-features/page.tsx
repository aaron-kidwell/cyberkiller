'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { API, authFetch } from '../../lib/api'

type Feature = {
  id: number
  handle: string
  title: string
  body: string
  status: string
  score: number
  vote_count: number
  my_vote: number
  created_at: string
}

const STATUS_COLOR: Record<string, string> = {
  open:        'var(--txt-dim)',
  planned:     'var(--cyan)',
  in_progress: 'var(--amber, #f59e0b)',
  done:        'var(--green)',
  declined:    'var(--red)',
}
const STATUS_LABEL: Record<string, string> = {
  open: 'OPEN', planned: 'PLANNED', in_progress: 'IN PROGRESS', done: 'SHIPPED', declined: 'DECLINED',
}

export default function WantedFeaturesPage() {
  const [features, setFeatures] = useState<Feature[]>([])
  const [loading, setLoading] = useState(true)
  const [loggedIn, setLoggedIn] = useState(false)
  const [myHandle, setMyHandle] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const h = localStorage.getItem('ck_player_handle') || ''
    setMyHandle(h)
    setLoggedIn(!!h)
  }, [])

  const load = useCallback(async () => {
    try {
      const r = await authFetch('/features')
      const d = await r.json()
      setFeatures(d.features || [])
    } catch {
      /* leave list as-is */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const vote = async (id: number, current: number, dir: 1 | -1) => {
    if (!loggedIn) { setErr('Log in to vote.'); return }
    // Clicking the same direction again clears the vote (toggle).
    const next = current === dir ? 0 : dir
    // Optimistic update
    setFeatures(prev => prev.map(f => {
      if (f.id !== id) return f
      const delta = next - f.my_vote
      return { ...f, my_vote: next, score: f.score + delta }
    }))
    try {
      await authFetch(`/features/${id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote: next }),
      })
    } catch {
      load() // reconcile on failure
    }
  }

  const remove = async (id: number) => {
    if (!confirm('Delete this suggestion? This cannot be undone.')) return
    const prev = features
    setFeatures(features.filter(f => f.id !== id)) // optimistic
    try {
      const r = await authFetch(`/features/${id}`, { method: 'DELETE' })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setErr(d.error || 'Could not delete.')
        setFeatures(prev) // restore
      }
    } catch {
      setFeatures(prev)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (title.trim().length < 4) { setErr('Title must be at least 4 characters.'); return }
    setSubmitting(true)
    try {
      const r = await authFetch('/features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Failed to submit.'); return }
      setTitle(''); setBody('')
      load()
    } catch {
      setErr('Network error.')
    } finally {
      setSubmitting(false)
    }
  }

  // Sort: re-sorts client-side after optimistic votes so order tracks score.
  const sorted = [...features].sort((a, b) => b.score - a.score || b.id - a.id)

  return (
    <div className="landing-scroll">
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
        <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--mag)', marginBottom: 14 }}>
          COMMUNITY ROADMAP
        </div>
        <h1 style={{ fontFamily: 'var(--hud)', fontSize: '1.8rem', color: 'var(--txt-bright)', marginBottom: 8 }}>
          WANTED FEATURES
        </h1>
        <p style={{ fontFamily: 'var(--body)', color: 'var(--txt-dim)', marginBottom: 28, fontSize: '0.9rem', lineHeight: 1.65 }}>
          Suggest what you want built and upvote what others have suggested. The highest-voted ideas get prioritized.
          {' '}Bugs go through <Link href="/report" style={{ color: 'var(--cyan)' }}>Report a Problem</Link> instead.
        </p>

        {/* Submit form */}
        {loggedIn ? (
          <form onSubmit={submit} style={{
            border: '1px solid var(--border)', background: 'var(--panel)',
            padding: 16, marginBottom: 28, borderRadius: 4,
          }}>
            <div className="hp-label" style={{ marginBottom: 8, color: 'var(--mag)', fontSize: '0.7rem', letterSpacing: '0.1em' }}>
              SUGGEST A FEATURE
            </div>
            <input
              className="chat-input"
              style={{ width: '100%', padding: '10px 12px', marginBottom: 10, fontSize: '0.95rem' }}
              placeholder="Short title, e.g. 'Add a team/squad mode'"
              maxLength={120}
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
            <textarea
              className="chat-input"
              style={{ width: '100%', padding: '10px 12px', minHeight: 70, fontSize: '0.9rem', resize: 'vertical' }}
              placeholder="Optional: more detail on what you want and why (max 2000 chars)"
              maxLength={2000}
              value={body}
              onChange={e => setBody(e.target.value)}
            />
            {err && <div style={{ color: 'var(--red)', fontSize: '0.8rem', marginTop: 8 }}>{err}</div>}
            <button type="submit" className="btn-mag" disabled={submitting}
              style={{ marginTop: 12, opacity: submitting ? 0.6 : 1 }}>
              {submitting ? 'SUBMITTING…' : 'SUBMIT IDEA →'}
            </button>
          </form>
        ) : (
          <div style={{
            border: '1px solid var(--border)', background: 'var(--panel)',
            padding: 16, marginBottom: 28, borderRadius: 4, fontSize: '0.88rem', color: 'var(--txt-dim)',
          }}>
            <Link href="/login" style={{ color: 'var(--cyan)' }}>Log in</Link> to suggest features and vote.
          </div>
        )}

        {/* Feature list */}
        {loading ? (
          <div style={{ color: 'var(--txt-dim)', fontSize: '0.85rem' }}>Loading…</div>
        ) : sorted.length === 0 ? (
          <div style={{ color: 'var(--txt-dim)', fontSize: '0.9rem', textAlign: 'center', padding: '32px 0' }}>
            No suggestions yet, be the first to add one.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sorted.map(f => (
              <div key={f.id} style={{
                display: 'flex', gap: 14, alignItems: 'flex-start',
                background: 'var(--panel)', border: '1px solid var(--border)',
                borderRadius: 4, padding: '14px 16px',
              }}>
                {/* Vote column */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0, width: 44 }}>
                  <button
                    type="button"
                    aria-label="upvote"
                    onClick={() => vote(f.id, f.my_vote, 1)}
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer', padding: 2,
                      color: f.my_vote === 1 ? 'var(--green)' : 'var(--txt-dim)',
                      fontSize: '1.1rem', lineHeight: 1,
                    }}
                  >▲</button>
                  <span style={{
                    fontFamily: 'var(--hud)', fontSize: '1rem',
                    color: f.score > 0 ? 'var(--green)' : f.score < 0 ? 'var(--red)' : 'var(--txt)',
                  }}>{f.score}</span>
                  <button
                    type="button"
                    aria-label="downvote"
                    onClick={() => vote(f.id, f.my_vote, -1)}
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer', padding: 2,
                      color: f.my_vote === -1 ? 'var(--red)' : 'var(--txt-dim)',
                      fontSize: '1.1rem', lineHeight: 1,
                    }}
                  >▼</button>
                </div>
                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--hud)', fontSize: '0.92rem', color: 'var(--txt-bright)' }}>
                      {f.title}
                    </span>
                    {f.status !== 'open' && (
                      <span style={{
                        fontSize: '0.58rem', letterSpacing: '0.1em', padding: '2px 6px', borderRadius: 2,
                        color: STATUS_COLOR[f.status] || 'var(--txt-dim)',
                        border: `1px solid ${STATUS_COLOR[f.status] || 'var(--border)'}`,
                      }}>{STATUS_LABEL[f.status] || f.status.toUpperCase()}</span>
                    )}
                  </div>
                  {f.body && (
                    <p style={{ fontFamily: 'var(--body)', fontSize: '0.85rem', color: 'var(--txt-dim)', lineHeight: 1.55, margin: '0 0 6px' }}>
                      {f.body}
                    </p>
                  )}
                  <div style={{ fontSize: '0.68rem', color: 'var(--txt-dim)', display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span>by {f.handle} · {f.vote_count} vote{f.vote_count === 1 ? '' : 's'}</span>
                    {loggedIn && f.handle === myHandle && f.status === 'open' && (
                      <button
                        type="button"
                        onClick={() => remove(f.id)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                          color: 'var(--red)', fontSize: '0.68rem', textDecoration: 'underline',
                        }}
                      >delete</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 32, display: 'flex', gap: 16, fontSize: '0.82rem' }}>
          <Link href="/known-issues" style={{ color: 'var(--txt-dim)' }}>← Known Issues</Link>
          <Link href="/hub" style={{ color: 'var(--txt-dim)' }}>Back to Hub</Link>
        </div>
      </div>
    </div>
  )
}
