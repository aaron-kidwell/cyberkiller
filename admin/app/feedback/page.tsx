'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminFetch } from '../../lib/api'

type FeedbackEntry = {
  id: number
  handle: string
  arena_ip: string
  image_name: string
  stars: number
  body: string
  created_at: string
}

function Stars({ n }: { n: number }) {
  return (
    <span style={{ color: 'var(--amber)', letterSpacing: 1 }}>
      {'★'.repeat(n)}{'☆'.repeat(5 - n)}
    </span>
  )
}

export default function FeedbackPage() {
  const [items, setItems] = useState<FeedbackEntry[]>([])

  const load = useCallback(async () => {
    const data = await adminFetch('/admin/feedback').catch(() => [])
    setItems(data || [])
  }, [])

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])

  const del = async (id: number) => {
    await adminFetch(`/admin/feedback/${id}`, { method: 'DELETE' }).catch(() => {})
    setItems(prev => prev.filter(x => x.id !== id))
  }
  const clearAll = async () => {
    if (!confirm(`Delete all ${items.length} feedback entries? This cannot be undone.`)) return
    await adminFetch('/admin/feedback', { method: 'DELETE' }).catch(() => {})
    setItems([])
  }

  const avg = items.length ? (items.reduce((s, i) => s + i.stars, 0) / items.length).toFixed(1) : '-'

  const byImage: Record<string, FeedbackEntry[]> = {}
  for (const f of items) {
    if (!byImage[f.image_name]) byImage[f.image_name] = []
    byImage[f.image_name].push(f)
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="page-title">MACHINE FEEDBACK</div>
          <div className="page-sub">Player star ratings and comments on range targets - {items.length} total, avg {avg} ★</div>
        </div>
        {items.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            style={{
              padding: '6px 14px', fontSize: '0.72rem', letterSpacing: '0.08em',
              fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
              background: 'var(--panel)', border: '1px solid var(--red)', color: 'var(--red)',
              cursor: 'pointer', borderRadius: 2,
            }}
          >
            Clear All
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="section">
          <div className="section-body" style={{ color: 'var(--txt-dim)', fontFamily: 'var(--body)', fontSize: '0.85rem' }}>
            No feedback submitted yet.
          </div>
        </div>
      ) : (
        <>
          {/* Per-image breakdown */}
          <div className="section">
            <div className="section-head"><span className="section-title">BY SCENARIO</span></div>
            <div className="table-scroll">
              <table className="ck-table">
                <thead><tr><th>Scenario</th><th>Ratings</th><th>Avg Stars</th></tr></thead>
                <tbody>
                  {Object.entries(byImage).sort((a, b) => b[1].length - a[1].length).map(([img, fb]) => {
                    const imgAvg = (fb.reduce((s, f) => s + f.stars, 0) / fb.length).toFixed(1)
                    return (
                      <tr key={img}>
                        <td style={{ fontWeight: 600 }}>{img}</td>
                        <td style={{ color: 'var(--txt-dim)' }}>{fb.length}</td>
                        <td><Stars n={Math.round(parseFloat(imgAvg))} /> <span style={{ color: 'var(--txt-dim)', fontSize: '0.75rem' }}>({imgAvg})</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* All entries */}
          <div className="section">
            <div className="section-head"><span className="section-title">ALL RATINGS</span></div>
            <div className="table-scroll">
              <table className="ck-table">
                <thead><tr><th>Time</th><th>Player</th><th>Scenario</th><th>IP</th><th>Stars</th><th>Comment</th><th></th></tr></thead>
                <tbody>
                  {items.map(f => (
                    <tr key={f.id}>
                      <td style={{ fontSize: '0.75rem', color: 'var(--txt-dim)', whiteSpace: 'nowrap' }}>{new Date(f.created_at).toLocaleString()}</td>
                      <td style={{ color: 'var(--cyan)' }}>{f.handle || <span style={{ color: 'var(--txt-dim)' }}>anon</span>}</td>
                      <td style={{ fontWeight: 600 }}>{f.image_name}</td>
                      <td><code>{f.arena_ip}</code></td>
                      <td><Stars n={f.stars} /></td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--txt-dim)', maxWidth: 320 }}>{f.body || <em>-</em>}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => del(f.id)}
                          title="Delete"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--txt-dim)', fontSize: '0.85rem', padding: '2px 6px' }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
