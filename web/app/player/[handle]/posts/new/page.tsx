'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { API, resolveRuntimeAPI } from '../../../../../lib/api'

export default function NewPostPage() {
  const { handle } = useParams<{ handle: string }>()
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [published, setPublished] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    setSaving(true)
    setErr('')
    try {
      const res = await fetch(`${resolveRuntimeAPI()}/player/${handle}/posts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, published }),
      })
      if (res.ok) {
        router.push(`/player/${handle}`)
      } else {
        const d = await res.json().catch(() => ({}))
        setErr((d as { error?: string }).error || 'Save failed')
      }
    } catch {
      setErr('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem' }}>
      <div style={{ marginBottom: 24 }}>
        <Link href={`/player/${handle}`} style={{ color: 'var(--cyan)', fontSize: '0.8rem' }}>
          ← @{handle}
        </Link>
      </div>
      <h1 style={{ fontFamily: 'var(--hud)', letterSpacing: '0.15em', fontSize: '0.95rem', color: 'var(--mag)', marginBottom: 24 }}>
        NEW POST
      </h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: '0.72rem', color: 'var(--txt-dim)', display: 'block', marginBottom: 4 }}>Title</label>
          <input
            className="editor-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Post title"
            maxLength={200}
            autoFocus
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
        </div>

        <div>
          <label style={{ fontSize: '0.72rem', color: 'var(--txt-dim)', display: 'block', marginBottom: 4 }}>Body</label>
          <textarea
            className="editor-input"
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write your post…"
            rows={18}
            maxLength={20000}
            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'var(--mono)', fontSize: '0.85rem', lineHeight: 1.7 }}
          />
          <div style={{ fontSize: '0.65rem', color: 'var(--txt-dim)', marginTop: 4, textAlign: 'right' }}>
            {body.length} / 20,000
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} />
          Publish immediately (visible on your profile)
        </label>

        {err && <p style={{ color: 'var(--red)', fontSize: '0.78rem' }}>{err}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" className="btn-mag" onClick={submit} disabled={saving || !title.trim() || !body.trim()}>
            {saving ? 'SAVING…' : published ? 'PUBLISH' : 'SAVE DRAFT'}
          </button>
          <Link href={`/player/${handle}`} style={{
            padding: '8px 16px', fontSize: '0.72rem', color: 'var(--txt-dim)',
            border: '1px solid var(--border)', textDecoration: 'none', display: 'inline-block',
          }}>
            Cancel
          </Link>
        </div>
      </div>
    </div>
  )
}
