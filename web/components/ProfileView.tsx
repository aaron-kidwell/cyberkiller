'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { API, resolveRuntimeAPI } from '../lib/api'
import { PlayerProfile, profileColors } from '../lib/profile'
import { visibleBadges } from '../lib/badges'
import { ShareCard } from './ShareCard'

type Post = { id: string; title: string; excerpt: string; created_at: string }

function PostsCard({ handle, accent, dim, text }: { handle: string; accent: string; dim: string; text: string }) {
  const [posts, setPosts] = useState<Post[] | null>(null)
  useEffect(() => {
    fetch(`${resolveRuntimeAPI()}/player/${handle}/posts`)
      .then(r => r.ok ? r.json() : [])
      .then(setPosts)
      .catch(() => setPosts([]))
  }, [handle])

  if (!posts || posts.length === 0) return null

  return (
    <div style={{ background: 'transparent', border: `1px solid ${accent}33`, marginBottom: 14 }}>
      <div style={{
        background: `${accent}18`, padding: '7px 14px',
        fontFamily: 'var(--hud)', fontSize: '0.62rem', letterSpacing: '0.18em',
        color: accent, borderBottom: `1px solid ${accent}33`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>POSTS</span>
        <Link href={`/player/${handle}/posts`} style={{ color: dim, fontSize: '0.58rem', textDecoration: 'none' }}>
          all posts →
        </Link>
      </div>
      <div style={{ padding: '10px 16px' }}>
        {posts.slice(0, 3).map(p => (
          <Link key={p.id} href={`/player/${handle}/posts/${p.id}`} style={{ textDecoration: 'none', display: 'block' }}>
            <div style={{
              padding: '10px 0',
              borderBottom: `1px solid ${accent}15`,
            }}>
              <div style={{ fontSize: '0.85rem', color: text, fontWeight: 600, marginBottom: 4 }}>{p.title}</div>
              <div style={{ fontSize: '0.72rem', color: dim, lineHeight: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.excerpt}
              </div>
              <div style={{ fontSize: '0.62rem', color: dim, marginTop: 4 }}>
                {new Date(p.created_at).toLocaleDateString()}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function youtubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    let id: string | null = null
    if (u.hostname === 'youtu.be') {
      id = u.pathname.slice(1).split('?')[0]
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(u.hostname)) {
      if (u.pathname.startsWith('/embed/')) id = u.pathname.split('/')[2]
      else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2]
      else id = u.searchParams.get('v')
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
  } catch {
    return null
  }
}

type Props = {
  profile: PlayerProfile
  compact?: boolean
}

function StatBox({ label, value, accent, dim }: { label: string; value: string; accent: string; dim: string }) {
  return (
    <div style={{
      background: `${accent}0d`,
      border: `1px solid ${accent}33`,
      padding: '10px 8px',
      textAlign: 'center',
      flex: 1,
      minWidth: 80,
    }}>
      <div style={{ fontSize: '1.2rem', fontFamily: 'var(--hud)', color: accent, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '0.55rem', letterSpacing: '0.12em', color: dim, marginTop: 5 }}>{label}</div>
    </div>
  )
}

function ProfileCard({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'transparent',
      border: `1px solid ${accent}33`,
      marginBottom: 14,
    }}>
      <div style={{
        background: `${accent}18`,
        padding: '7px 14px',
        fontFamily: 'var(--hud)',
        fontSize: '0.62rem',
        letterSpacing: '0.18em',
        color: accent,
        borderBottom: `1px solid ${accent}33`,
      }}>
        {title}
      </div>
      <div style={{ padding: '14px 16px' }}>
        {children}
      </div>
    </div>
  )
}

export function ProfileView({ profile: p, compact }: Props) {
  const c = profileColors(p)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const badges = visibleBadges(p)

  const skills = p.featured_skills
    ? p.featured_skills.split(',').map(s => s.trim()).filter(Boolean).slice(0, 8)
    : []

  const bgStyle: React.CSSProperties = {}

  return (
    <div
      className="ck-profile"
      style={{
        minHeight: compact ? 'auto' : 'calc(100vh - 48px)',
        backgroundColor: c.bg,
        color: c.text,
        fontFamily: 'var(--mono)',
        position: 'relative',
        ...bgStyle,
      }}
    >
      {/* Scoped custom CSS, targets .ck-profile and descendants */}
      {p.custom_css && (
        <style dangerouslySetInnerHTML={{ __html: p.custom_css }} />
      )}

      {/* Background image, rendered outside CSS so custom_css can't clobber it */}
      {p.background_url && p.background_tile && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', minHeight: '100%',
          backgroundImage: `url(${p.background_url})`,
          backgroundRepeat: 'repeat',
          backgroundSize: 'auto',
        }} />
      )}
      {p.background_url && !p.background_tile && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={p.background_url}
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center top',
            zIndex: 0, pointerEvents: 'none',
          }}
        />
      )}
      {p.background_url && (
        <div style={{
          position: 'absolute', inset: 0, backgroundColor: `${c.bg}bb`,
          zIndex: 1, pointerEvents: 'none', minHeight: '100%',
        }} />
      )}

      <div style={{ position: 'relative', zIndex: 2 }}>
        {/* ── HEADER ── */}
        <header
          className="ck-profile-header"
          style={{
            background: `linear-gradient(160deg, ${c.card}f0 0%, ${c.bg}e0 100%)`,
            borderBottom: `3px solid ${c.accent}`,
            padding: compact ? '16px 20px' : '32px 24px 24px',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Avatar */}
            <div
              className="ck-profile-avatar-wrap"
              style={{
                width: compact ? 72 : 140,
                height: compact ? 72 : 140,
                flexShrink: 0,
                border: `3px solid ${c.accent}`,
                overflow: 'hidden',
                background: c.bg,
                boxShadow: `0 0 30px ${c.accent}55, 0 0 60px ${c.accent}22`,
              }}
            >
              {p.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{
                  width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--hud)', fontSize: compact ? '1.8rem' : '3rem', color: c.accent,
                  background: `${c.accent}11`,
                  textShadow: `0 0 20px ${c.accent}`,
                }}>
                  {(p.handle || '?')[0].toUpperCase()}
                </div>
              )}
            </div>

            {/* Identity */}
            <div style={{ flex: 1, minWidth: 200 }}>
              <h1 className="ck-profile-handle" style={{
                fontFamily: 'var(--hud)',
                fontSize: compact ? '1.5rem' : '2.4rem',
                letterSpacing: '0.06em',
                color: c.accent,
                marginBottom: 4,
                textShadow: `0 0 20px ${c.accent}66`,
                lineHeight: 1.1,
              }}>
                {p.handle}
              </h1>

              {p.title && (
                <p className="ck-profile-title" style={{
                  fontSize: '0.95rem', color: c.dim, marginBottom: 8, fontStyle: 'italic',
                }}>
                  {p.title}
                </p>
              )}

              {/* Status bubble */}
              {p.status && !compact && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: `${c.accent}15`, border: `1px solid ${c.accent}44`,
                  padding: '5px 12px', marginBottom: 10,
                  fontSize: '0.82rem', color: c.text,
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', background: c.accent,
                    boxShadow: `0 0 6px ${c.accent}`, flexShrink: 0,
                  }} />
                  {p.status}
                </div>
              )}

              {/* Location + social row */}
              {!compact && (
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                  {p.location && (
                    <span style={{ fontSize: '0.78rem', color: c.dim }}>
                      ◎ {p.location}
                    </span>
                  )}
                  {p.social_github && (
                    <a href={p.social_github} target="_blank" rel="noreferrer"
                      style={{ fontSize: '0.78rem', color: c.accent, textDecoration: 'none' }}>
                      GitHub ↗
                    </a>
                  )}
                  {p.social_twitter && (
                    <a href={p.social_twitter} target="_blank" rel="noreferrer"
                      style={{ fontSize: '0.78rem', color: c.accent, textDecoration: 'none' }}>
                      X ↗
                    </a>
                  )}
                  {p.social_website && (
                    <a href={p.social_website} target="_blank" rel="noreferrer"
                      style={{ fontSize: '0.78rem', color: c.accent, textDecoration: 'none' }}>
                      {(() => { try { return new URL(p.social_website).hostname } catch { return p.social_website } })() } ↗
                    </a>
                  )}
                  {p.rank ? (
                    <span style={{ fontSize: '0.72rem', color: c.dim, letterSpacing: '0.1em' }}>
                      RANK #{p.rank}
                    </span>
                  ) : null}
                  {(p.login_streak ?? 0) > 0 && (
                    <span
                      title={`Best streak: ${p.login_streak_max ?? p.login_streak} days`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: '0.72rem', letterSpacing: '0.08em',
                        background: (p.login_streak ?? 0) >= 7 ? `${c.accent}22` : 'transparent',
                        border: `1px solid ${(p.login_streak ?? 0) >= 7 ? c.accent : c.dim}55`,
                        padding: '2px 8px',
                        color: (p.login_streak ?? 0) >= 7 ? c.accent : c.dim,
                      }}
                    >
                      🔥 {p.login_streak} day streak
                    </span>
                  )}
                  {!compact && (
                    <button
                      type="button"
                      onClick={() => setShareOpen(true)}
                      style={{
                        fontSize: '0.72rem', letterSpacing: '0.08em', cursor: 'pointer',
                        background: `${c.accent}18`, border: `1px solid ${c.accent}`,
                        color: c.accent, padding: '3px 10px', fontFamily: 'var(--hud)',
                      }}
                    >
                      ✦ SHARE CARD
                    </button>
                  )}
                </div>
              )}
              {!compact && badges.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {badges.map(b => (
                    <span key={b.label} title={b.hint} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      fontSize: '0.7rem', letterSpacing: '0.06em', fontFamily: 'var(--hud)',
                      background: `${c.accent}14`, border: `1px solid ${c.accent}55`,
                      color: c.accent, padding: '3px 9px',
                    }}>
                      <span aria-hidden style={{ fontSize: '0.85rem', lineHeight: 1 }}>{b.glyph}</span>{b.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        {shareOpen && (
          <ShareCard
            stats={{
              handle: p.handle,
              rank: p.rank,
              points: p.points,
              kills: p.kills,
              koth_crowns: p.koth_crowns,
              title: p.title,
            }}
            onClose={() => setShareOpen(false)}
          />
        )}

        {/* ── BODY ── */}
        <div style={{ maxWidth: 960, margin: '0 auto', padding: compact ? '12px 16px' : '20px 24px 48px' }}>
          {compact ? (
            /* Compact: just bio */
            <div style={{
              background: `${c.card}cc`,
              border: `1px solid ${c.accent}33`,
              padding: '12px 14px',
              fontSize: '0.85rem',
              lineHeight: 1.55,
              fontFamily: 'var(--body)',
            }}>
              {p.bio || 'No bio.'}
            </div>
          ) : (
            /* Full: 2-column MySpace layout */
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
              gap: 20,
            }}
              className="ck-profile-grid"
            >
              {/* ── LEFT COLUMN ── */}
              <div>
                {/* About Me */}
                <ProfileCard title="ABOUT ME" accent={c.accent}>
                  <p className="ck-profile-bio" style={{
                    fontFamily: 'var(--body)',
                    fontSize: '0.92rem',
                    lineHeight: 1.7,
                    whiteSpace: 'pre-wrap',
                    color: c.text,
                  }}>
                    {p.bio || 'This operative prefers to let their kills speak for them.'}
                  </p>
                </ProfileCard>

                {/* Arsenal */}
                {skills.length > 0 && (
                  <ProfileCard title="ARSENAL" accent={c.accent}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {skills.map(s => (
                        <span key={s} style={{
                          padding: '4px 12px',
                          background: `${c.accent}18`,
                          border: `1px solid ${c.accent}55`,
                          fontSize: '0.75rem',
                          letterSpacing: '0.08em',
                          color: c.accent,
                        }}>
                          {s}
                        </span>
                      ))}
                    </div>
                  </ProfileCard>
                )}

                {/* Blog posts */}
                {!compact && <PostsCard handle={p.handle} accent={c.accent} dim={c.dim} text={c.text} />}

                {/* YouTube embed */}
                {(() => {
                  const ytId = youtubeVideoId(p.youtube_url)
                  if (!ytId) return null
                  return (
                    <ProfileCard title="FEATURED VIDEO" accent={c.accent}>
                      <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden' }}>
                        <iframe
                          src={`https://www.youtube-nocookie.com/embed/${ytId}`}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
                          title="Featured video"
                        />
                      </div>
                    </ProfileCard>
                  )
                })()}

                {/* Music player */}
                {p.music_url && (
                  <ProfileCard title="NOW PLAYING" accent={c.accent}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <button
                        type="button"
                        onClick={() => {
                          const el = document.getElementById('ck-profile-audio') as HTMLAudioElement | null
                          if (!el) return
                          if (audioPlaying) { el.pause(); setAudioPlaying(false) }
                          else { el.src = p.music_url!; el.play().then(() => setAudioPlaying(true)).catch(() => {}) }
                        }}
                        style={{
                          width: 40, height: 40, borderRadius: '50%',
                          background: `${c.accent}22`, border: `2px solid ${c.accent}`,
                          color: c.accent, fontSize: '1.1rem', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {audioPlaying ? '⏸' : '▶'}
                      </button>
                      <div>
                        <div style={{ fontSize: '0.82rem', color: c.text }}>
                          {p.music_label || 'Track'}
                        </div>
                        <div style={{ fontSize: '0.65rem', color: c.dim, marginTop: 2 }}>
                          {audioPlaying ? '▶ playing' : 'click to play'}
                        </div>
                      </div>
                      <audio id="ck-profile-audio" />
                    </div>
                    {/* VU bars */}
                    <div style={{ marginTop: 12, display: 'flex', gap: 2, height: 24, alignItems: 'flex-end' }}>
                      {Array.from({ length: 24 }).map((_, i) => (
                        <div key={i} style={{
                          flex: 1,
                          height: audioPlaying ? `${20 + Math.sin(i * 0.7) * 12}px` : '3px',
                          background: i % 3 === 0 ? c.accent : `${c.accent}88`,
                          transition: 'height 0.3s ease',
                        }} />
                      ))}
                    </div>
                  </ProfileCard>
                )}
              </div>

              {/* ── RIGHT COLUMN ── */}
              <div>
                {/* Stats */}
                <ProfileCard title="STATS" accent={c.accent}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <StatBox label="POINTS" value={(p.points ?? 0).toLocaleString()} accent={c.accent} dim={c.dim} />
                    <StatBox label="KILLS" value={String((p.kills ?? 0) + (p.target_kills ?? 0))} accent={c.accent} dim={c.dim} />
                    <StatBox label="KOTH CROWNS" value={String(p.koth_crowns ?? 0)} accent={c.accent} dim={c.dim} />
                    <StatBox label="RANK" value={p.rank ? `#${p.rank}` : '·'} accent={c.accent} dim={c.dim} />
                  </div>
                </ProfileCard>

                {/* Recent kills */}
                <ProfileCard title="RECENT KILLS" accent={c.accent}>
                  {(p.recent_kills?.length ?? 0) === 0 ? (
                    <p style={{ color: c.dim, fontSize: '0.82rem' }}>No kills on record.</p>
                  ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {p.recent_kills!.slice(0, 8).map((k, i) => (
                        <li key={i} style={{
                          padding: '7px 0',
                          borderBottom: i < Math.min(p.recent_kills!.length, 8) - 1
                            ? `1px solid ${c.accent}18` : 'none',
                          fontSize: '0.78rem',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}>
                          <span style={{
                            color: c.accent, textTransform: 'uppercase',
                            fontSize: '0.62rem', letterSpacing: '0.08em',
                          }}>
                            {k.kind.replace('_', ' ')}
                          </span>
                          <span style={{ color: c.text }}>+{k.points}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </ProfileCard>

                {/* Back link */}
                <p style={{ marginTop: 8, fontSize: '0.7rem', textAlign: 'center' }}>
                  <Link href="/hub" style={{ color: c.dim }}>← Arena Hub</Link>
                  {p.rank ? (
                    <span style={{ marginLeft: 12, color: c.dim }}>
                      <Link href="/hub?tab=scores" style={{ color: c.dim }}>Leaderboard →</Link>
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
