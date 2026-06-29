'use client'

import { useEffect, useRef, useState } from 'react'

type Stats = {
  handle: string
  rank?: number
  points?: number
  kills?: number
  koth_crowns?: number
  title?: string | null
}

// Optional headline for event cards (first blood / throne held). When set, it
// replaces the generic "COMPETITIVE HACKING ARENA" eyebrow.
type Props = {
  stats: Stats
  headline?: string   // e.g. "FIRST BLOOD" or "HELD THE THRONE"
  subline?: string    // e.g. "rooted 10.66.20.202"
  onClose: () => void
}

const W = 1200
const H = 630

export function ShareCard({ stats, headline, subline, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = (ghost: HTMLImageElement | null) => {
      // Background gradient
      const g = ctx.createLinearGradient(0, 0, W, H)
      g.addColorStop(0, '#160a26')
      g.addColorStop(1, '#08060d')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)

      // Subtle scanlines
      ctx.fillStyle = 'rgba(255,255,255,0.02)'
      for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1)

      // Magenta border
      ctx.strokeStyle = '#e834c6'
      ctx.lineWidth = 4
      ctx.strokeRect(8, 8, W - 16, H - 16)

      // Ghost mascot (left), with magenta glow
      if (ghost) {
        const gh = 420
        const gw = gh * (ghost.width / ghost.height)
        ctx.save()
        ctx.shadowColor = 'rgba(232,52,198,0.55)'
        ctx.shadowBlur = 50
        ctx.drawImage(ghost, 60, (H - gh) / 2, gw, gh)
        ctx.restore()
      }

      const tx = 520 // text column start

      // Eyebrow / headline
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = headline ? '#22d3ee' : '#8b8699'
      ctx.font = '700 26px monospace'
      ctx.fillText((headline || 'COMPETITIVE HACKING ARENA').toUpperCase(), tx, 130)

      if (subline) {
        ctx.fillStyle = '#dcd8f0'
        ctx.font = '400 24px monospace'
        ctx.fillText(subline, tx, 168)
      }

      // Handle (big)
      ctx.fillStyle = '#ff6ad5'
      ctx.font = '800 76px sans-serif'
      ctx.fillText(stats.handle, tx, subline ? 250 : 230)

      if (stats.title) {
        ctx.fillStyle = '#8b8699'
        ctx.font = 'italic 26px sans-serif'
        ctx.fillText(stats.title, tx, (subline ? 250 : 230) + 40)
      }

      // Stat blocks
      const statsArr = [
        { label: 'RANK', value: stats.rank ? `#${stats.rank}` : '-' },
        { label: 'POINTS', value: String(stats.points ?? 0) },
        { label: 'KILLS', value: String(stats.kills ?? 0) },
        { label: 'KOTH', value: String(stats.koth_crowns ?? 0) },
      ]
      const by = 360
      const bw = 150
      const gap = 16
      statsArr.forEach((s, i) => {
        const bx = tx + i * (bw + gap)
        ctx.fillStyle = 'rgba(34,211,238,0.06)'
        ctx.fillRect(bx, by, bw, 120)
        ctx.strokeStyle = 'rgba(34,211,238,0.3)'
        ctx.lineWidth = 1
        ctx.strokeRect(bx, by, bw, 120)
        ctx.fillStyle = '#22d3ee'
        ctx.font = '800 46px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(s.value, bx + bw / 2, by + 62)
        ctx.fillStyle = '#8b8699'
        ctx.font = '600 18px monospace'
        ctx.fillText(s.label, bx + bw / 2, by + 96)
        ctx.textAlign = 'left'
      })

      // Source URL only (so anyone who sees the card knows where to play).
      ctx.fillStyle = '#22d3ee'
      ctx.font = '700 32px monospace'
      ctx.textAlign = 'right'
      ctx.fillText('cyberkiller.net', W - 70, 562)
      ctx.textAlign = 'left'

      setReady(true)
    }

    const img = new Image()
    img.onload = () => draw(img)
    img.onerror = () => draw(null) // still render the card without the ghost
    img.src = '/ck-ghost.png'
  }, [stats, headline, subline])

  const download = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const a = document.createElement('a')
    a.download = `cyberkiller-${stats.handle}.png`
    a.href = canvas.toDataURL('image/png')
    a.click()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: 720, width: '100%' }}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{ width: '100%', height: 'auto', border: '1px solid var(--mag)', display: 'block', boxShadow: '0 0 40px rgba(232,52,198,0.3)' }}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'center' }}>
          <button type="button" className="btn-mag" onClick={download} disabled={!ready}>
            ↓ DOWNLOAD CARD
          </button>
          <button type="button" onClick={onClose}
            style={{ background: 'transparent', color: 'var(--txt-dim)', border: '1px solid var(--border)', padding: '10px 18px', cursor: 'pointer', fontFamily: 'var(--hud)', fontSize: '0.75rem' }}>
            CLOSE
          </button>
        </div>
        <p style={{ textAlign: 'center', color: 'var(--txt-dim)', fontSize: '0.75rem', marginTop: 10 }}>
          Post it in your server, on X, wherever.
        </p>
      </div>
    </div>
  )
}
