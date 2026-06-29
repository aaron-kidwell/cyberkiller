'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { API, resolveRuntimeAPI } from '../../lib/api'
import { deriveBadges } from '../../lib/badges'
import { PlayerProfile } from '../../lib/profile'

type Entry = { handle: string; points: number; kills: number; rank: number; title?: string; koth_crowns?: number }

export default function Featured() {
  const [board, setBoard] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch(`${resolveRuntimeAPI()}/scores`)
      .then(r => r.json())
      .then(d => setBoard(d.leaderboard || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const featured = board.slice(0, 12)

  return (
    <div className="landing-scroll">
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px 80px' }}>
        <div style={{ fontSize: '0.7rem', letterSpacing: '0.28em', color: 'var(--cyan)', marginBottom: 10 }}>THE LEADERBOARD</div>
        <h1 style={{ fontFamily: 'var(--hud)', fontSize: '2rem', color: 'var(--mag)', textShadow: '0 0 16px rgba(232,52,198,0.4)', marginBottom: 6 }}>
          FEATURED OPERATIVES
        </h1>
        <p style={{ color: 'var(--txt-dim)', fontFamily: 'var(--body)', marginBottom: 28, fontSize: '0.95rem' }}>
          The operatives topping the arena right now. Climb the board to claim a spot.
        </p>

        {loading ? (
          <p style={{ color: 'var(--txt-dim)' }}>Loading the board…</p>
        ) : featured.length === 0 ? (
          <p style={{ color: 'var(--txt-dim)' }}>No operatives on the board yet. Be the first to make the cut.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 14 }}>
            {featured.map((e, i) => {
              const accent = i === 0 ? '#ffd24a' : i < 3 ? '#e834c6' : '#22d3ee'
              const badges = deriveBadges({ handle: e.handle, rank: e.rank, points: e.points, kills: e.kills, koth_crowns: e.koth_crowns } as PlayerProfile)
              return (
                <Link key={e.handle} href={`/player/${e.handle}`} style={{ textDecoration: 'none' }}>
                  <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderTop: `2px solid ${accent}`, padding: '16px 18px', height: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontFamily: 'var(--hud)', fontSize: '1.3rem', color: accent }}>#{e.rank}</span>
                      {i === 0 && <span aria-hidden style={{ fontSize: '1rem', color: accent }}>♛</span>}
                    </div>
                    <div style={{ fontSize: '1.12rem', color: 'var(--txt-bright)', fontWeight: 600, marginTop: 4 }}>{e.handle}</div>
                    {e.title ? <div style={{ fontSize: '0.74rem', color: 'var(--txt-dim)', marginTop: 2 }}>{e.title}</div> : null}
                    <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: '0.8rem', color: 'var(--txt-dim)' }}>
                      <span><b style={{ color: 'var(--cyan)' }}>{e.points.toLocaleString()}</b> pts</span>
                      <span><b style={{ color: 'var(--cyan)' }}>{e.kills}</b> kills</span>
                      {(e.koth_crowns ?? 0) > 0 && <span><b style={{ color: 'var(--mag)' }}>{e.koth_crowns}</b> ♚</span>}
                    </div>
                    {badges.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 10 }}>
                        {badges.slice(0, 4).map(b => (
                          <span key={b.label} style={{ fontSize: '0.62rem', letterSpacing: '0.05em', fontFamily: 'var(--hud)', color: accent, border: `1px solid ${accent}55`, padding: '2px 6px' }}>
                            {b.glyph} {b.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
