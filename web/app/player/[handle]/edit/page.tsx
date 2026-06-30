'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { API, resolveRuntimeAPI } from '../../../../lib/api'
import { PlayerProfile, THEME_PRESETS, themeById } from '../../../../lib/profile'
import { ProfileView } from '../../../../components/ProfileView'
import { BADGE_CATALOG } from '../../../../lib/badges'

const emptyProfile = (handle: string): PlayerProfile => ({
  handle,
  bio: '',
  title: '',
  avatar_url: '',
  custom_css: '',
  theme_preset: 'neon_ghost',
  status: '',
  location: '',
  background_url: '',
  background_tile: false,
  social_github: '',
  social_twitter: '',
  social_website: '',
  featured_skills: '',
  music_url: '',
  music_label: '',
  youtube_url: '',
  layout_col: 'classic',
  badges_hidden: '',
  points: 0,
  kills: 0,
})

type Section = 'identity' | 'style' | 'css' | 'links'
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'style', label: 'Style & Colors' },
  { id: 'css', label: 'Custom CSS' },
  { id: 'links', label: 'Social & Music' },
]

function UploadBtn({ onUrl, label = 'Upload' }: { onUrl: (url: string) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setErr('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${resolveRuntimeAPI()}/upload`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      const data = await res.json()
      if (res.ok) {
        onUrl(data.url)
      } else {
        setErr(data.error || 'Upload failed')
      }
    } catch {
      setErr('Network error')
    } finally {
      setUploading(false)
      if (ref.current) ref.current.value = ''
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{ display: 'none' }} onChange={handleFile} />
      <button
        type="button"
        className="btn-mag"
        style={{ fontSize: '0.65rem', padding: '5px 12px', opacity: uploading ? 0.6 : 1 }}
        disabled={uploading}
        onClick={() => ref.current?.click()}
      >
        {uploading ? 'Uploading…' : `⬆ ${label}`}
      </button>
      {err && <span style={{ fontSize: '0.65rem', color: 'var(--red)' }}>{err}</span>}
    </div>
  )
}

export default function ProfileEditPage() {
  const { handle } = useParams<{ handle: string }>()
  const router = useRouter()
  const [draft, setDraft] = useState<PlayerProfile | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [activeSection, setActiveSection] = useState<Section>('identity')
  const [authorized, setAuthorized] = useState(true)

  useEffect(() => {
    const mine = localStorage.getItem('ck_player_handle')
    if (mine !== handle) setAuthorized(false)
    fetch(`${resolveRuntimeAPI()}/player/${handle}`)
      .then(r => r.ok ? r.json() : emptyProfile(handle))
      .then(setDraft)
      .catch(() => setDraft(emptyProfile(handle)))
  }, [handle])

  const update = useCallback(<K extends keyof PlayerProfile>(field: K, value: PlayerProfile[K]) => {
    setDraft(d => d ? { ...d, [field]: value } : d)
  }, [])

  // Toggle a badge's visibility by adding/removing its stable id from the
  // comma-separated badges_hidden list. Earned-but-hidden badges won't render.
  const toggleBadge = (id: string) => {
    setDraft(d => {
      if (!d) return d
      const h = new Set((d.badges_hidden || '').split(',').map(s => s.trim()).filter(Boolean))
      h.has(id) ? h.delete(id) : h.add(id)
      return { ...d, badges_hidden: Array.from(h).join(',') }
    })
  }

  const applyPreset = (id: string) => {
    const t = themeById(id)
    setDraft(d => d ? {
      ...d,
      theme_preset: id,
      color_bg: t.color_bg,
      color_card: t.color_card,
      color_accent: t.color_accent,
      color_text: t.color_text,
      color_text_dim: t.color_text_dim,
    } : d)
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch(`${resolveRuntimeAPI()}/player/${handle}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bio: draft.bio ?? '',
          title: draft.title ?? '',
          avatar_url: draft.avatar_url ?? '',
          custom_css: draft.custom_css ?? '',
          theme_preset: draft.theme_preset ?? 'neon_ghost',
          color_bg: draft.color_bg ?? '',
          color_card: draft.color_card ?? '',
          color_accent: draft.color_accent ?? '',
          color_text: draft.color_text ?? '',
          color_text_dim: draft.color_text_dim ?? '',
          status: draft.status ?? '',
          location: draft.location ?? '',
          background_url: draft.background_url ?? '',
          background_tile: draft.background_tile ?? false,
          social_github: draft.social_github ?? '',
          social_twitter: draft.social_twitter ?? '',
          social_website: draft.social_website ?? '',
          featured_skills: draft.featured_skills ?? '',
          music_url: draft.music_url ?? '',
          music_label: draft.music_label ?? '',
          youtube_url: draft.youtube_url ?? '',
          layout_col: draft.layout_col ?? 'classic',
          badges_hidden: draft.badges_hidden ?? '',
        }),
      })
      if (res.ok) {
        setMsg('Page published.')
        setTimeout(() => router.push(`/player/${handle}`), 600)
      } else {
        const d = await res.json().catch(() => ({}))
        setMsg((d as { error?: string }).error || 'Save failed, try again.')
      }
    } catch {
      setMsg('Network error, try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!draft) return <div style={{ padding: '2rem', color: 'var(--txt-dim)' }}>Loading editor…</div>

  const preview: PlayerProfile = { ...draft, handle }
  const colorPickerField = (key: keyof PlayerProfile, label: string) => {
    const val = (draft[key] as string) || themeById(draft.theme_preset)[key.replace('color_', '') as 'color_bg'] || '#000000'
    return (
      <div className="color-row" key={key}>
        <label style={{ fontSize: '0.72rem', color: 'var(--txt-dim)', flex: 1 }}>{label}</label>
        <input
          type="color"
          value={/^#[0-9A-Fa-f]{6}$/i.test(val) ? val : '#000000'}
          onChange={e => update(key, e.target.value)}
        />
        <input
          className="editor-input editor-hex"
          value={(draft[key] as string) ?? ''}
          onChange={e => update(key, e.target.value)}
          placeholder="inherit"
        />
      </div>
    )
  }

  return (
    <div className="profile-editor">
      {/* Toolbar */}
      <div className="profile-editor-toolbar">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Link href={`/player/${handle}`} style={{ color: 'var(--cyan)', fontSize: '0.8rem' }}>← View page</Link>
          <Link href={`/player/${handle}/settings`} style={{ color: 'var(--txt-dim)', fontSize: '0.75rem' }}>Settings</Link>
        </div>
        <span style={{ fontFamily: 'var(--hud)', color: 'var(--mag)', letterSpacing: '0.1em', fontSize: '0.85rem' }}>
          EDIT @{handle}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {msg && <span style={{ fontSize: '0.75rem', color: msg.includes('fail') ? 'var(--red)' : 'var(--green)' }}>{msg}</span>}
          {!authorized && <span style={{ fontSize: '0.72rem', color: 'var(--amber)' }}>⚠ handle mismatch</span>}
          <button type="button" className="btn-mag" onClick={save} disabled={saving || !authorized}>
            {saving ? 'SAVING…' : 'PUBLISH'}
          </button>
        </div>
      </div>

      <div className="profile-editor-split">
        {/* ── FORM ── */}
        <aside className="profile-editor-form">
          {/* Section tabs */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
            {SECTIONS.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                style={{
                  padding: '8px 14px',
                  fontFamily: 'var(--hud)',
                  fontSize: '0.65rem',
                  letterSpacing: '0.1em',
                  background: activeSection === s.id ? 'var(--panel)' : 'transparent',
                  color: activeSection === s.id ? 'var(--cyan)' : 'var(--txt-dim)',
                  border: 'none',
                  borderBottom: activeSection === s.id ? '2px solid var(--cyan)' : '2px solid transparent',
                  cursor: 'pointer',
                  marginBottom: -1,
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* ── IDENTITY ── */}
          {activeSection === 'identity' && (
            <section className="editor-section">
              <label>Avatar URL <span className="editor-hint">paste a URL or upload below</span></label>
              <input className="editor-input" value={draft.avatar_url ?? ''} onChange={e => update('avatar_url', e.target.value)} placeholder="https://i.imgur.com/…" />
              <UploadBtn label="Upload avatar" onUrl={url => update('avatar_url', url)} />

              <label>Title <span className="editor-hint">(64 chars)</span></label>
              <input className="editor-input" maxLength={64} value={draft.title ?? ''} onChange={e => update('title', e.target.value)} placeholder="Shadow Op · Root Collector" />

              <label>Status <span className="editor-hint">(shown live on profile)</span></label>
              <input className="editor-input" maxLength={120} value={draft.status ?? ''} onChange={e => update('status', e.target.value)} placeholder="currently: rooting everything in sight" />

              <label>Location <span className="editor-hint">(optional)</span></label>
              <input className="editor-input" maxLength={80} value={draft.location ?? ''} onChange={e => update('location', e.target.value)} placeholder="somewhere dark" />

              <label>About Me <span className="editor-hint">(2000 chars, make it yours)</span></label>
              <textarea
                className="editor-input editor-textarea"
                maxLength={2000}
                rows={8}
                value={draft.bio ?? ''}
                onChange={e => update('bio', e.target.value)}
                placeholder={"Write anything, who you are, what you hack, your setup, your story. The more you put here the more your page stands out."}
              />
              <span className="editor-hint">{(draft.bio ?? '').length}/2000</span>

              <label style={{ marginTop: 10 }}>Arsenal / Skills <span className="editor-hint">comma-separated, up to 8</span></label>
              <input
                className="editor-input"
                value={draft.featured_skills ?? ''}
                onChange={e => update('featured_skills', e.target.value)}
                placeholder="SQLi, XSS, LFI, SUID, Pivoting, Nmap…"
              />
            </section>
          )}

          {/* ── STYLE & COLORS ── */}
          {activeSection === 'style' && (
            <section className="editor-section">
              <label>Background image URL <span className="editor-hint">paste a direct link or upload below (GIFs work)</span></label>
              <input className="editor-input" value={draft.background_url ?? ''} onChange={e => update('background_url', e.target.value)} placeholder="https://c.tenor.com/…/something.gif" />
              <UploadBtn label="Upload background" onUrl={url => update('background_url', url)} />

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <input
                  type="checkbox"
                  id="bg-tile"
                  checked={draft.background_tile ?? false}
                  onChange={e => update('background_tile', e.target.checked)}
                />
                <label htmlFor="bg-tile" style={{ fontSize: '0.78rem', color: 'var(--txt-dim)', cursor: 'pointer' }}>
                  Tile background (repeat)
                </label>
              </div>

              <h3 style={{ fontSize: '0.7rem', color: 'var(--txt-dim)', letterSpacing: '0.1em', marginBottom: 12 }}>THEME PRESETS</h3>
              <div className="theme-grid">
                {THEME_PRESETS.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    className={`theme-swatch ${draft.theme_preset === t.id ? 'active' : ''}`}
                    onClick={() => applyPreset(t.id)}
                    title={t.name}
                  >
                    <span style={{ background: t.color_bg }} />
                    <span style={{ background: t.color_accent }} />
                    <span className="theme-name">{t.name}</span>
                  </button>
                ))}
              </div>

              <h3 style={{ fontSize: '0.7rem', color: 'var(--txt-dim)', letterSpacing: '0.1em', marginBottom: 12, marginTop: 20 }}>COLORS (override preset)</h3>
              {colorPickerField('color_bg', 'Background')}
              {colorPickerField('color_card', 'Cards / panels')}
              {colorPickerField('color_accent', 'Accent / glow')}
              {colorPickerField('color_text', 'Primary text')}
              {colorPickerField('color_text_dim', 'Dim text')}

              <h3 style={{ fontSize: '0.7rem', color: 'var(--txt-dim)', letterSpacing: '0.1em', marginBottom: 6, marginTop: 20 }}>BADGES</h3>
              <p className="editor-hint" style={{ marginBottom: 12, lineHeight: 1.55 }}>
                Badges are earned automatically from your stats. Toggle which ones show on your profile. A hidden badge stays hidden even after you earn it; badges you have not earned yet never show regardless.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {BADGE_CATALOG.map(b => {
                  const hidden = (draft.badges_hidden || '').split(',').map(s => s.trim()).includes(b.id)
                  return (
                    <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', border: '1px solid var(--border)', background: 'var(--bg)' }}>
                      <span aria-hidden style={{ fontSize: '1rem', width: 20, textAlign: 'center', opacity: hidden ? 0.4 : 1 }}>{b.glyph}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--hud)', fontSize: '0.72rem', letterSpacing: '0.06em', color: hidden ? 'var(--txt-dim)' : 'var(--txt-bright)' }}>{b.label}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--txt-dim)' }}>{b.meaning}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleBadge(b.id)}
                        style={{
                          fontSize: '0.62rem', letterSpacing: '0.08em', fontFamily: 'var(--hud)', cursor: 'pointer',
                          padding: '4px 10px', whiteSpace: 'nowrap',
                          background: hidden ? 'transparent' : 'rgba(34,211,238,0.12)',
                          border: `1px solid ${hidden ? 'var(--border)' : 'var(--cyan)'}`,
                          color: hidden ? 'var(--txt-dim)' : 'var(--cyan)',
                        }}
                      >
                        {hidden ? 'HIDDEN' : 'SHOWN'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* ── CUSTOM CSS ── */}
          {activeSection === 'css' && (
            <section className="editor-section">
              <p className="editor-hint" style={{ marginBottom: 12, lineHeight: 1.6 }}>
                Raw CSS injected into the page. Target specific profile elements or style everything.
                <code style={{ display: 'block', marginTop: 8, color: 'var(--cyan)' }}>
                  .ck-profile · .ck-profile-header · .ck-profile-handle · .ck-profile-about · .ck-profile-bio
                </code>
                <br />
                No <code>position:fixed</code>, <code>@import</code>, or <code>javascript:</code>.
                Everything else goes, animations, custom fonts, glow effects, whatever.
              </p>
              <textarea
                className="editor-input editor-css"
                rows={18}
                value={draft.custom_css ?? ''}
                onChange={e => update('custom_css', e.target.value)}
                placeholder={[
                  '/* example: animated glow on your handle */',
                  '.ck-profile-handle {',
                  '  animation: pulse 2s ease-in-out infinite;',
                  '}',
                  '@keyframes pulse {',
                  '  0%, 100% { text-shadow: 0 0 20px var(--accent); }',
                  '  50% { text-shadow: 0 0 40px var(--accent), 0 0 80px var(--accent); }',
                  '}',
                  '',
                  '/* scanlines overlay */',
                  '.ck-profile::before {',
                  '  content: "";',
                  '  pointer-events: none;',
                  '  position: absolute;',
                  '  inset: 0;',
                  '  background: repeating-linear-gradient(transparent, transparent 2px, #0005 2px, #0005 4px);',
                  '}',
                ].join('\n')}
                spellCheck={false}
              />
            </section>
          )}

          {/* ── SOCIAL & MUSIC ── */}
          {activeSection === 'links' && (
            <section className="editor-section">
              <h3 style={{ fontSize: '0.7rem', color: 'var(--txt-dim)', letterSpacing: '0.1em', marginBottom: 12 }}>SOCIAL LINKS</h3>
              <label>GitHub</label>
              <input className="editor-input" value={draft.social_github ?? ''} onChange={e => update('social_github', e.target.value)} placeholder="https://github.com/yourhandle" />
              <label>Twitter / X</label>
              <input className="editor-input" value={draft.social_twitter ?? ''} onChange={e => update('social_twitter', e.target.value)} placeholder="https://x.com/yourhandle" />
              <label>Website / Blog</label>
              <input className="editor-input" value={draft.social_website ?? ''} onChange={e => update('social_website', e.target.value)} placeholder="https://…" />

              <h3 style={{ fontSize: '0.7rem', color: 'var(--txt-dim)', letterSpacing: '0.1em', marginBottom: 12, marginTop: 20 }}>
                FEATURED VIDEO <span className="editor-hint">YouTube embed on your profile</span>
              </h3>
              <label>YouTube URL</label>
              <input
                className="editor-input"
                value={draft.youtube_url ?? ''}
                onChange={e => update('youtube_url', e.target.value)}
                placeholder="https://www.youtube.com/watch?v=… or https://youtu.be/…"
              />

              <h3 style={{ fontSize: '0.7rem', color: 'var(--txt-dim)', letterSpacing: '0.1em', marginBottom: 12, marginTop: 20 }}>
                NOW PLAYING <span className="editor-hint">music on your profile</span>
              </h3>
              <label>Track label <span className="editor-hint">(artist, song)</span></label>
              <input className="editor-input" value={draft.music_label ?? ''} onChange={e => update('music_label', e.target.value)} placeholder="Carpenter Brut, Turbo Killer" />
              <label>Stream URL <span className="editor-hint">direct .mp3 / .ogg link</span></label>
              <input className="editor-input" value={draft.music_url ?? ''} onChange={e => update('music_url', e.target.value)} placeholder="https://…/track.mp3" />
              {draft.music_url && (
                <p className="editor-hint" style={{ color: 'var(--amber)', marginTop: 4 }}>
                  ⚠ Browser autoplay is blocked, visitors click play manually.
                </p>
              )}
            </section>
          )}

        </aside>

        {/* ── LIVE PREVIEW ── */}
        <div className="profile-editor-preview">
          <p className="preview-label">LIVE PREVIEW</p>
          <div className="preview-frame">
            <ProfileView profile={preview} />
          </div>
        </div>
      </div>
    </div>
  )
}
