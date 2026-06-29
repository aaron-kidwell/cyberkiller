'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { API } from '../lib/api'
import { E } from '../components/E'

function MediaModal({ onClose }: { onClose: () => void }) {
  const items = [
    { name: 'Ghost (transparent PNG)', desc: 'The mascot on a transparent background, stickers, overlays, anywhere.', src: '/ck-ghost-transparent.png', file: 'cyberkiller-ghost.png' },
    { name: 'Wallpaper', desc: '16:9 desktop / phone background.', src: '/ck-wallpaper.png', file: 'cyberkiller-wallpaper.png' },
  ]
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 560, width: '100%', background: 'var(--bg2, #0e0a18)',
          border: '1px solid var(--mag)', boxShadow: '0 0 40px rgba(232,52,198,0.3)',
          padding: '24px', position: 'relative',
        }}
      >
        <button onClick={onClose} aria-label="close" style={{
          position: 'absolute', top: 10, right: 14, background: 'none', border: 'none',
          color: 'var(--txt-dim)', fontSize: '1.3rem', cursor: 'pointer',
        }}>×</button>
        <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--cyan)', marginBottom: 8 }}>
          PRESS KIT / MEDIA
        </div>
        <h2 style={{ fontFamily: 'var(--hud)', fontSize: '1.4rem', color: 'var(--mag)', marginBottom: 6 }}>
          GRAB THE ART
        </h2>
        <p style={{ fontFamily: 'var(--body)', color: 'var(--txt-dim)', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: 20 }}>
          Free to use however you want, wallpapers, profile pics, stickers, fan art. Go wild.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {items.map(it => (
            <div key={it.src} className="media-item">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.src} alt="" style={{ width: 84, height: 56, objectFit: 'contain', background: '#08060d', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--hud)', fontSize: '0.85rem', color: 'var(--txt-bright)' }}>{it.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--txt-dim)', lineHeight: 1.45 }}>{it.desc}</div>
              </div>
              <a href={it.src} download={it.file} className="btn-mag media-dl"
                style={{ fontSize: '0.72rem', padding: '8px 14px' }}>
                ↓ DOWNLOAD
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}


export default function Home() {
  const [mediaOpen, setMediaOpen] = useState(false)
  // Logged-in players (handle in localStorage, same signal the nav uses) don't
  // need the Create Account button; collapse the hero to a single Enter the Hub.
  const [loggedIn, setLoggedIn] = useState(false)
  useEffect(() => { setLoggedIn(!!localStorage.getItem('ck_player_handle')) }, [])
  return (
    <div className="landing-scroll">
      <section className="hero">
        {/* ck-stagger cascades the eyebrow, lockup, taglines, CTAs and stats in
            on load - a single orchestrated reveal rather than scattered effects. */}
        <div className="ck-stagger" style={{ position: 'relative', zIndex: 1 }}>
          <E id="landing.hero.eyebrow"
            style={{ fontSize: '0.72rem', letterSpacing: '0.28em', color: 'var(--cyan)', marginBottom: 14, display: 'block' }}>
            SELF-HOSTED · TRAIN YOUR TEAM
          </E>
          {/* Logo lockup: ghost mascot + CYBERKILLER wordmark composed as one unit. */}
          <h1 className="ck-lockup">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ck-ghost.png" alt="" aria-hidden className="ck-ghost" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ck-logo-1200.png" alt="CYBERKILLER" className="ck-wordmark" />
          </h1>
          <E id="landing.hero.subtitle" as="p" className="hero-sub">
            COMPETITIVE HACKING ARENA
          </E>
          <E id="landing.hero.body" as="p" className="hero-p">
            Spin up real vulnerable boxes, turn your team loose, and climb the
            leaderboard. A self-hosted competitive hacking arena.
          </E>
          {loggedIn ? (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Link href="/hub?autoplay=1" className="btn-mag">
                <E id="landing.cta.secondary">ENTER THE HUB</E>
              </Link>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Link href="/signup" className="btn-mag">
                  <E id="landing.cta.primary">CREATE ACCOUNT →</E>
                </Link>
                <Link href="/hub?autoplay=1" className="btn-mag"
                  style={{ background: 'transparent', color: 'var(--cyan)', border: '1px solid var(--cyan)' }}>
                  <E id="landing.cta.secondary">ENTER THE HUB</E>
                </Link>
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 28, justifyContent: 'center', marginTop: 36, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontFamily: 'var(--hud)', fontSize: '1.5rem', color: 'var(--mag)' }}>
                <E id="landing.stat1.value">LIVE</E>
              </div>
              <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--txt-dim)' }}>
                <E id="landing.stat1.label">community</E>
              </div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--hud)', fontSize: '1.5rem', color: 'var(--mag)' }}>
                <E id="landing.stat2.value">24/7</E>
              </div>
              <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--txt-dim)' }}>
                <E id="landing.stat2.label">matches</E>
              </div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--hud)', fontSize: '1.5rem', color: 'var(--mag)' }}>
                <E id="landing.stat3.value">KOTH</E>
              </div>
              <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--txt-dim)' }}>
                <E id="landing.stat3.label">MULTI-HILL</E>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how" style={{ padding: '48px 24px', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--cyan)', border: '1px solid rgba(34,211,238,0.3)', padding: '2px 8px', display: 'inline-block', marginBottom: 14 }}>
          <E id="landing.how.badge">HOW IT WORKS</E>
        </div>
        <h2 style={{ fontFamily: 'var(--hud)', fontSize: '1.4rem', color: 'var(--txt-bright)', marginBottom: 20 }}>
          <E id="landing.how.title">EXPLOIT → SCORE → PERSIST</E>
        </h2>
        <ol style={{ fontFamily: 'var(--body)', color: 'var(--txt-dim)', lineHeight: 1.8, paddingLeft: 20, fontSize: '0.95rem' }}>
          <li><E id="landing.how.step1">Register a handle and log in, then attack the targets from your own VM.</E></li>
          <li><E id="landing.how.step2">Capture the user and root flags, pivot through the network.</E></li>
          <li><E id="landing.how.step3">Climb the leaderboard and fight to hold each box.</E></li>
        </ol>
      </section>

      {mediaOpen && <MediaModal onClose={() => setMediaOpen(false)} />}

      {/* Fixed MEDIA button, bottom-right of the home page */}
      <button
        type="button"
        onClick={() => setMediaOpen(true)}
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 900,
          fontFamily: 'var(--hud)', fontSize: '0.7rem', letterSpacing: '0.12em',
          padding: '10px 16px', cursor: 'pointer',
          background: 'rgba(14,10,24,0.85)', color: 'var(--cyan)',
          border: '1px solid var(--cyan)', backdropFilter: 'blur(4px)',
          boxShadow: '0 0 16px rgba(34,211,238,0.25)',
        }}
        aria-label="Media downloads"
      >
        ✦ MEDIA
      </button>
    </div>
  )
}
