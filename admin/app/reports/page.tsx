'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminFetch } from '../../lib/api'

type Report = {
  id: number
  handle: string
  category: string
  body: string
  created_at: string
}

const CATEGORY_COLOR: Record<string, string> = {
  bug:              'var(--red)',
  cheating:         'var(--amber)',
  machine:          'var(--cyan)',
  general:          'var(--txt-dim)',
  feedback_feature: 'var(--green)',
  feedback_ux:      'var(--green)',
  feedback_content: 'var(--green)',
  feedback_general: 'var(--green)',
}

const isFeedback = (cat: string) => cat.startsWith('feedback')

type Filter = 'all' | 'reports' | 'feedback'

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [deleting, setDeleting] = useState<number | null>(null)

  const deleteReport = useCallback(async (id: number) => {
    setDeleting(id)
    try {
      await adminFetch(`/admin/reports/${id}`, { method: 'DELETE' })
      setReports(prev => prev.filter(r => r.id !== id))
    } catch {}
    setDeleting(null)
  }, [])

  const clearVisible = async () => {
    const ids = visible.map(r => r.id)
    if (ids.length === 0) return
    const label = filter === 'feedback' ? 'feedback submissions' : filter === 'reports' ? 'problem reports' : 'items'
    if (!confirm(`Delete all ${ids.length} ${label}? This cannot be undone.`)) return
    await Promise.all(ids.map(id => adminFetch(`/admin/reports/${id}`, { method: 'DELETE' }).catch(() => {})))
    setReports(prev => prev.filter(r => !ids.includes(r.id)))
  }

  const load = useCallback(() => {
    setLoading(true)
    adminFetch('/admin/reports')
      .then((d: any) => setReports(d.reports || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleString() } catch { return iso }
  }

  const visible = reports.filter(r =>
    filter === 'all' ? true :
    filter === 'feedback' ? isFeedback(r.category) :
    !isFeedback(r.category)
  )

  const feedbackCount = reports.filter(r => isFeedback(r.category)).length
  const reportCount = reports.filter(r => !isFeedback(r.category)).length

  return (
    <div>
      <div className="page-header">
        <div className="page-title">REPORTS &amp; FEEDBACK</div>
        <div className="page-sub">{reportCount} problem report{reportCount !== 1 ? 's' : ''} · {feedbackCount} feedback submission{feedbackCount !== 1 ? 's' : ''}</div>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '0 16px 16px', alignItems: 'center' }}>
        {(['all', 'reports', 'feedback'] as Filter[]).map(f => (
          <button key={f} type="button" onClick={() => setFilter(f)} style={{
            padding: '4px 12px', fontSize: '0.72rem', letterSpacing: '0.08em',
            fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
            background: filter === f ? 'rgba(232,52,198,0.12)' : 'var(--panel)',
            border: `1px solid ${filter === f ? 'var(--mag)' : 'var(--border)'}`,
            color: filter === f ? 'var(--mag)' : 'var(--txt-dim)',
            cursor: 'pointer', borderRadius: 2,
          }}>
            {f === 'all' ? `All (${reports.length})` :
             f === 'reports' ? `Problems (${reportCount})` :
             `Feedback (${feedbackCount})`}
          </button>
        ))}
        <button
          type="button"
          onClick={clearVisible}
          disabled={visible.length === 0}
          style={{
            marginLeft: 'auto', padding: '4px 12px', fontSize: '0.72rem', letterSpacing: '0.08em',
            fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
            background: 'var(--panel)', border: '1px solid var(--red)', color: 'var(--red)',
            cursor: visible.length === 0 ? 'not-allowed' : 'pointer', opacity: visible.length === 0 ? 0.4 : 1,
            borderRadius: 2,
          }}
        >
          Clear {filter === 'all' ? 'All' : filter === 'feedback' ? 'Feedback' : 'Reports'}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 24, color: 'var(--txt-dim)', fontFamily: 'var(--body)' }}>Loading…</div>
      ) : visible.length === 0 ? (
        <div style={{ padding: 24, color: 'var(--txt-dim)', fontFamily: 'var(--body)' }}>
          {filter === 'feedback' ? 'No feedback submitted yet.' : 'No reports yet.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 16px' }}>
          {visible.map(r => (
            <div key={r.id} style={{
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: '0.68rem', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)',
                  color: CATEGORY_COLOR[r.category] || 'var(--txt-dim)',
                  border: `1px solid ${CATEGORY_COLOR[r.category] || 'var(--border)'}`,
                  padding: '2px 6px', borderRadius: 2,
                }}>
                  {r.category.replace('feedback_', '').toUpperCase()}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--mag)' }}>
                  {r.handle}
                </span>
                <span style={{ color: 'var(--txt-dim)', fontSize: '0.72rem', marginLeft: 'auto' }}>
                  {fmtDate(r.created_at)}
                </span>
                <button
                  type="button"
                  onClick={() => deleteReport(r.id)}
                  disabled={deleting === r.id}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--txt-dim)', fontSize: '0.72rem', padding: '2px 6px',
                    opacity: deleting === r.id ? 0.4 : 1,
                  }}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
              <div style={{ fontFamily: 'var(--body)', fontSize: '0.88rem', color: 'var(--txt)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                {r.body}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
