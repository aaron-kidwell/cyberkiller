'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { API, resolveRuntimeAPI } from '../../../../lib/api'

interface Post {
  id: string
  title: string
  body: string
  published: boolean
  created_at: string
  updated_at: string
}

export default function PostsListPage() {
  const { handle } = useParams<{ handle: string }>()
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch(`${resolveRuntimeAPI()}/player/${handle}/posts`)
      .then(r => {
        if (!r.ok) throw new Error('failed')
        return r.json()
      })
      .then(data => setPosts(data ?? []))
      .catch(() => setErr('Could not load posts'))
  }, [handle])

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem' }}>
      <div style={{ marginBottom: 24 }}>
        <Link href={`/player/${handle}`} style={{ color: 'var(--cyan)', fontSize: '0.8rem' }}>
          ← @{handle}
        </Link>
      </div>
      <h1 style={{ fontFamily: 'var(--hud)', letterSpacing: '0.15em', fontSize: '1rem', color: 'var(--mag)', marginBottom: 24 }}>
        @{handle} / POSTS
      </h1>

      {err && <p style={{ color: 'var(--red)' }}>{err}</p>}
      {!posts && !err && <p style={{ color: 'var(--txt-dim)', fontSize: '0.85rem' }}>Loading…</p>}
      {posts && posts.length === 0 && (
        <p style={{ color: 'var(--txt-dim)', fontSize: '0.85rem' }}>No posts yet.</p>
      )}
      {posts && posts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {posts.map(p => (
            <Link key={p.id} href={`/player/${handle}/posts/${p.id}`} style={{ textDecoration: 'none' }}>
              <div style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '16px 20px',
                transition: 'border-color 0.15s',
              }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--cyan)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
              >
                <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--txt)', marginBottom: 6 }}>
                  {p.title || '(untitled)'}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--txt-dim)', lineHeight: 1.5, marginBottom: 10, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                  {p.body}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--txt-dim)' }}>
                  {new Date(p.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
