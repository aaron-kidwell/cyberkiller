'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { API, resolveRuntimeAPI } from '../../../../../lib/api'

interface Post {
  id: string
  title: string
  body: string
  published: boolean
  created_at: string
  updated_at: string
}

export default function PostPage() {
  const { handle, id } = useParams<{ handle: string; id: string }>()
  const router = useRouter()
  const [post, setPost] = useState<Post | null>(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [published, setPublished] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')

  const isOwner = typeof window !== 'undefined' && localStorage.getItem('ck_player_handle') === handle

  useEffect(() => {
    const url = `${resolveRuntimeAPI()}/player/${handle}/posts/${id}`
    fetch(url, { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error('not found')
        return r.json()
      })
      .then((p: Post) => {
        setPost(p)
        setTitle(p.title)
        setBody(p.body)
        setPublished(p.published)
      })
      .catch(() => setErr('Post not found'))
  }, [handle, id, isOwner])

  const startEdit = () => { setEditing(true); setSaveErr('') }
  const cancelEdit = () => { setEditing(false); if (post) { setTitle(post.title); setBody(post.body); setPublished(post.published) } }

  const save = async () => {
    setSaving(true)
    setSaveErr('')
    try {
      const res = await fetch(`${resolveRuntimeAPI()}/player/${handle}/posts/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, published }),
      })
      if (res.ok) {
        setPost(p => p ? { ...p, title, body, published, updated_at: new Date().toISOString() } : p)
        setEditing(false)
      } else {
        const d = await res.json().catch(() => ({}))
        setSaveErr((d as { error?: string }).error || 'Save failed')
      }
    } catch {
      setSaveErr('Network error')
    } finally {
      setSaving(false)
    }
  }

  const deletePost = async () => {
    if (!confirm('Delete this post? This cannot be undone.')) return
    await fetch(`${resolveRuntimeAPI()}/player/${handle}/posts/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    router.push(`/player/${handle}`)
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem' }}>
      <div style={{ marginBottom: 24, display: 'flex', gap: 16, alignItems: 'center' }}>
        <Link href={`/player/${handle}/posts`} style={{ color: 'var(--cyan)', fontSize: '0.8rem' }}>
          ← All posts
        </Link>
        <Link href={`/player/${handle}`} style={{ color: 'var(--txt-dim)', fontSize: '0.75rem' }}>
          @{handle}
        </Link>
        {isOwner && post && !editing && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button type="button" onClick={startEdit} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--txt-dim)', fontSize: '0.7rem', padding: '4px 12px', cursor: 'pointer', borderRadius: 3 }}>
              Edit
            </button>
            <button type="button" onClick={deletePost} style={{ background: 'none', border: '1px solid var(--red)', color: 'var(--red)', fontSize: '0.7rem', padding: '4px 12px', cursor: 'pointer', borderRadius: 3 }}>
              Delete
            </button>
          </div>
        )}
      </div>

      {err && <p style={{ color: 'var(--red)' }}>{err}</p>}
      {!post && !err && <p style={{ color: 'var(--txt-dim)', fontSize: '0.85rem' }}>Loading…</p>}

      {post && !editing && (
        <article>
          <h1 style={{ fontFamily: 'var(--hud)', letterSpacing: '0.08em', fontSize: '1.2rem', color: 'var(--txt)', marginBottom: 8, lineHeight: 1.3 }}>
            {post.title || '(untitled)'}
          </h1>
          <div style={{ fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 28 }}>
            by <Link href={`/player/${handle}`} style={{ color: 'var(--cyan)' }}>@{handle}</Link>
            {' · '}
            {new Date(post.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            {post.updated_at !== post.created_at && (
              <> · updated {new Date(post.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
            )}
            {isOwner && !post.published && (
              <span style={{ marginLeft: 10, color: 'var(--amber)' }}>(draft, not visible publicly)</span>
            )}
          </div>
          <div style={{ color: 'var(--txt)', fontSize: '0.88rem', lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {post.body}
          </div>
        </article>
      )}

      {post && editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: '0.72rem', color: 'var(--txt-dim)', display: 'block', marginBottom: 4 }}>Title</label>
            <input
              className="editor-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={200}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', color: 'var(--txt-dim)', display: 'block', marginBottom: 4 }}>Body</label>
            <textarea
              className="editor-input"
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={18}
              maxLength={20000}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'var(--mono)', fontSize: '0.85rem', lineHeight: 1.7 }}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} />
            Published
          </label>
          {saveErr && <p style={{ color: 'var(--red)', fontSize: '0.75rem' }}>{saveErr}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-mag" onClick={save} disabled={saving}>
              {saving ? 'SAVING…' : 'SAVE'}
            </button>
            <button type="button" onClick={cancelEdit} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--txt-dim)', fontSize: '0.72rem', padding: '5px 14px', cursor: 'pointer', borderRadius: 4 }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
