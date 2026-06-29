'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { API, resolveRuntimeAPI } from '../../lib/api'

type Issue = { id: number; severity: string; title: string; body: string }

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'var(--red)',
  HIGH:     'var(--amber)',
  LOW:      'var(--cyan)',
}

export default function KnownIssuesPage() {
  const [ISSUES, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${resolveRuntimeAPI()}/known-issues`)
      .then(r => r.ok ? r.json() : { issues: [] })
      .then(d => setIssues(d.issues || []))
      .catch(() => setIssues([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="landing-scroll">
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px' }}>
        <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--amber)', marginBottom: 14 }}>
          ARENA STATUS / KNOWN ISSUES
        </div>
        <h1 style={{ fontFamily: 'var(--hud)', fontSize: '1.8rem', color: 'var(--txt-bright)', marginBottom: 8 }}>
          KNOWN ISSUES
        </h1>
        <p style={{ fontFamily: 'var(--body)', color: 'var(--txt-dim)', marginBottom: 32, fontSize: '0.9rem', lineHeight: 1.65 }}>
          Documented quirks and expected behaviours. If something isn&apos;t listed here, use <Link href="/report" style={{ color: 'var(--cyan)' }}>Report a Problem</Link>.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading && <div style={{ color: 'var(--txt-dim)', fontSize: '0.85rem' }}>Loading…</div>}
          {!loading && ISSUES.length === 0 && (
            <div style={{ color: 'var(--txt-dim)', fontSize: '0.9rem' }}>No known issues right now. The arena is running clean.</div>
          )}
          {ISSUES.map(issue => (
            <div key={issue.id} style={{
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{
                  fontSize: '0.65rem', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)',
                  color: SEVERITY_COLOR[issue.severity] || 'var(--txt-dim)',
                  border: `1px solid ${SEVERITY_COLOR[issue.severity] || 'var(--border)'}`,
                  padding: '2px 6px', borderRadius: 2,
                }}>
                  {issue.severity}
                </span>
                <span style={{ fontFamily: 'var(--hud)', fontSize: '0.82rem', color: 'var(--txt-bright)', letterSpacing: '0.04em' }}>
                  {issue.title}
                </span>
              </div>
              <p style={{ fontFamily: 'var(--body)', fontSize: '0.85rem', color: 'var(--txt-dim)', lineHeight: 1.6, margin: 0 }}>
                {issue.body}
              </p>
            </div>
          ))}
        </div>

        <div style={{
          marginTop: 32, padding: '18px 20px',
          border: '1px solid rgba(232, 52, 198, 0.3)', background: 'rgba(232, 52, 198, 0.05)',
          borderRadius: 4, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontFamily: 'var(--hud)', fontSize: '0.85rem', color: 'var(--mag)', marginBottom: 4 }}>
              WANT SOMETHING BUILT?
            </div>
            <div style={{ fontSize: '0.84rem', color: 'var(--txt-dim)', lineHeight: 1.5 }}>
              Suggest new features and upvote what others want. Top ideas get prioritized.
            </div>
          </div>
          <Link href="/wanted-features" className="btn-mag">WANTED FEATURES →</Link>
        </div>

        <div style={{ marginTop: 24 }}>
          <Link href="/hub" style={{ fontSize: '0.82rem', color: 'var(--txt-dim)' }}>← Back to Hub</Link>
        </div>
      </div>
    </div>
  )
}
