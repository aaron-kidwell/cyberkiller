'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { adminFetch } from '../../lib/api'

type Submission = {
  id: string; handle: string; docker_image: string
  machine_name: string; tier: string; status: string
  description?: string; admin_note?: string; submitted_at?: string
}

const TIER_LABEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }
const TIER_CLASS: Record<string, string> = { easy: 'tier-easy', medium: 'tier-medium', hard: 'tier-hard' }

export default function SubmissionsPage() {
  const [list, setList] = useState<Submission[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [flash, setFlash] = useState<{ msg: string; ok: boolean } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const notify = (msg: string, ok = true) => {
    setFlash({ msg, ok })
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setFlash(null), 4000)
  }

  const load = useCallback(() => {
    adminFetch('/admin/submissions').then(setList).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn(); notify(label); load() }
    catch (e: any) { notify(e.message, false) }
  }

  const pending = list.filter(s => s.status === 'pending')
  const reviewed = list.filter(s => s.status !== 'pending')

  const statusBadge = (s: string) => {
    if (s === 'approved') return <span className="badge badge-green">APPROVED</span>
    if (s === 'rejected') return <span className="badge badge-red">REJECTED</span>
    return <span className="badge badge-amber">PENDING</span>
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">COMMUNITY SUBMISSIONS</div>
        <div className="page-sub">Player-submitted Docker images for review. Approved images enter the target pool.</div>
      </div>

      {flash && <div className={`flash ${flash.ok ? 'flash-ok' : 'flash-err'}`}>{flash.msg}</div>}

      {/* Pending */}
      <div className="section">
        <div className="section-head">
          <span className="section-title mag">PENDING REVIEW ({pending.length})</span>
        </div>
        {pending.length === 0 ? (
          <div className="section-body" style={{ color: 'var(--txt-dim)', fontFamily: 'var(--body)', fontSize: '0.85rem' }}>
            No pending submissions.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 2, background: 'var(--border)' }}>
            {pending.map(s => (
              <div key={s.id} style={{ background: 'var(--panel)', padding: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span style={{ color: 'var(--txt-bright)', fontWeight: 600 }}>{s.machine_name}</span>
                      <span className={`badge ${TIER_CLASS[s.tier] || 'badge-dim'}`}>{TIER_LABEL[s.tier] || s.tier}</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--txt-dim)', marginBottom: 4 }}>
                      Submitted by <span style={{ color: 'var(--cyan)' }}>{s.handle}</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--txt-dim)', fontFamily: 'var(--body)', marginBottom: 8 }}>
                      Image: <code>{s.docker_image}</code>
                    </div>
                    {s.description && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--txt-dim)', fontFamily: 'var(--body)', marginBottom: 8 }}>
                        {s.description}
                      </div>
                    )}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">REVIEW NOTE</label>
                      <input
                        className="form-input sm"
                        value={notes[s.id] || ''}
                        onChange={e => setNotes(n => ({ ...n, [s.id]: e.target.value }))}
                        placeholder="Optional note to the submitter"
                      />
                    </div>
                  </div>
                  <div className="action-row" style={{ flexDirection: 'column', gap: 8 }}>
                    <button className="btn btn-primary"
                      onClick={() => act(`Approved: ${s.machine_name}`, () =>
                        adminFetch(`/admin/submissions/${s.id}/approve`, {
                          method: 'POST',
                          body: JSON.stringify({ note: notes[s.id] || 'approved' }),
                        }))}>
                      ✓ Approve
                    </button>
                    <button className="btn btn-sm btn-danger"
                      onClick={() => act(`Rejected: ${s.machine_name}`, () =>
                        adminFetch(`/admin/submissions/${s.id}/reject`, {
                          method: 'POST',
                          body: JSON.stringify({ note: notes[s.id] || 'rejected' }),
                        }))}>
                      ✗ Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reviewed */}
      {reviewed.length > 0 && (
        <div className="section">
          <div className="section-head">
            <span className="section-title">REVIEW HISTORY ({reviewed.length})</span>
          </div>
          <div className="table-scroll">
            <table className="ck-table">
              <thead>
                <tr><th>Name</th><th>By</th><th>Difficulty</th><th>Image</th><th>Status</th><th>Note</th></tr>
              </thead>
              <tbody>
                {reviewed.map(s => (
                  <tr key={s.id}>
                    <td>{s.machine_name}</td>
                    <td style={{ color: 'var(--cyan)' }}>{s.handle}</td>
                    <td><span className={`badge ${TIER_CLASS[s.tier] || 'badge-dim'}`}>{TIER_LABEL[s.tier] || s.tier}</span></td>
                    <td style={{ fontSize: '0.72rem' }}><code>{s.docker_image}</code></td>
                    <td>{statusBadge(s.status)}</td>
                    <td style={{ fontSize: '0.72rem', color: 'var(--txt-dim)' }}>{s.admin_note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
