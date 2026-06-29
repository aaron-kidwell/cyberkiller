'use client'

import { useState } from 'react'
import Link from 'next/link'
import { E } from '../../components/E'

import { resolveRuntimeAPI } from '../../lib/api'

const TIERS = [
  { value: 'easy',   label: 'EASY',   desc: 'Entry-level: SQLi, XSS, basic web vulns',        color: '#22d3ee' },
  { value: 'medium', label: 'MEDIUM', desc: 'Intermediate: LFI, SUID, config leaks',           color: '#8b5cf6' },
  { value: 'hard',   label: 'HARD',   desc: 'Advanced: chained exploits, privesc chains',       color: '#e834c6' },
]

export default function ContributePage() {
  const [form, setForm] = useState({
    player_id: '',
    docker_image: '',
    machine_name: '',
    tier: 'easy',
    description: '',
  })
  const [msg, setMsg] = useState('')
  const [isError, setIsError] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMsg('')
    try {
      const r = await fetch(`${resolveRuntimeAPI()}/images/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (r.ok) {
        setMsg('Submission received, an operator will review and deploy your machine.')
        setIsError(false)
        setForm({ player_id: '', docker_image: '', machine_name: '', tier: 'easy', description: '' })
      } else {
        const d = await r.json().catch(() => ({}))
        setMsg(d.error || 'Submission failed, check the form and try again.')
        setIsError(true)
      }
    } catch {
      setMsg('Could not reach the arena server.')
      setIsError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="landing-scroll">
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '48px 24px' }}>
        <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', color: 'var(--cyan)', marginBottom: 14 }}>
          <E id="contribute.eyebrow">COMMUNITY TARGETS</E>
        </div>
        <h1 style={{ fontFamily: 'var(--hud)', fontSize: '1.8rem', color: 'var(--mag)', marginBottom: 8 }}>
          <E id="contribute.title">CONTRIBUTE A MACHINE</E>
        </h1>
        <p style={{ fontFamily: 'var(--body)', color: 'var(--txt-dim)', marginBottom: 32, fontSize: '0.95rem', lineHeight: 1.65 }}>
          <E id="contribute.subtitle">Built a vulnerable Docker image? Submit it to the CyberKiller arena. Approved machines earn you community kill points every time another player roots them.</E>
        </p>

        <div style={{ marginBottom: 32 }}>
          <div className="hp-label" style={{ color: 'var(--cyan)', marginBottom: 12 }}>REQUIREMENTS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 2, background: 'var(--border)' }}>
            {[
              ['Flag at /root/root.txt', 'writable by root only'],
              ['Flag at /home/ckplayer/user.txt', 'writable by user only'],
              ['SSH on port 22', 'key or password auth'],
              ['Web service on port 80', 'optional but common'],
              ['No outbound internet', 'container isolation assumed'],
              ['CK_ROOT_PASSWORD env', 'container respects this var'],
            ].map(([title, desc]) => (
              <div key={title} style={{ background: 'var(--panel)', padding: '12px 14px' }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--txt-bright)', marginBottom: 2 }}>{title}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--txt-dim)' }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6, letterSpacing: '0.06em' }}>
              YOUR PLAYER ID
            </label>
            <input
              className="chat-input editor-input"
              value={form.player_id}
              onChange={e => setForm({ ...form, player_id: e.target.value })}
              placeholder="UUID from registration (shown on the Connect tab)"
              required
            />
            <div className="editor-hint" style={{ marginTop: 4 }}>Found in the registration output when you first ran the agent.</div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6, letterSpacing: '0.06em' }}>
              DOCKER IMAGE
            </label>
            <input
              className="chat-input editor-input"
              value={form.docker_image}
              onChange={e => setForm({ ...form, docker_image: e.target.value })}
              placeholder="e.g. ghcr.io/youruser/target-machine:latest"
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6, letterSpacing: '0.06em' }}>
              MACHINE NAME
            </label>
            <input
              className="chat-input editor-input"
              value={form.machine_name}
              onChange={e => setForm({ ...form, machine_name: e.target.value })}
              placeholder="e.g. Broken Auth Portal"
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 10, letterSpacing: '0.06em' }}>
              DIFFICULTY TIER
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {TIERS.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setForm({ ...form, tier: t.value })}
                  style={{
                    flex: 1, minWidth: 160, padding: '12px 14px', textAlign: 'left',
                    background: form.tier === t.value ? `rgba(${t.color === '#22d3ee' ? '34,211,238' : t.color === '#8b5cf6' ? '139,92,246' : '232,52,198'}, 0.1)` : 'var(--panel)',
                    border: `1px solid ${form.tier === t.value ? t.color : 'var(--border)'}`,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontFamily: 'var(--hud)', fontSize: '0.75rem', color: t.color, letterSpacing: '0.1em', marginBottom: 4 }}>
                    {t.label}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--txt-dim)', fontFamily: 'var(--body)' }}>{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--txt-dim)', marginBottom: 6, letterSpacing: '0.06em' }}>
              DESCRIPTION <span style={{ color: 'var(--txt-dim)' }}>(spoiler-free)</span>
            </label>
            <textarea
              className="chat-input editor-input editor-textarea"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="Brief description of the machine concept, no flag paths or explicit hints"
              rows={4}
            />
          </div>

          {msg && (
            <div style={{
              padding: '12px 14px', fontSize: '0.88rem',
              background: 'var(--panel)',
              borderLeft: `3px solid ${isError ? 'var(--red)' : 'var(--green)'}`,
              color: isError ? 'var(--red)' : 'var(--green)',
            }}>
              {msg}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="submit" className="btn-mag" disabled={loading} style={{ opacity: loading ? 0.6 : 1 }}>
              {loading ? 'SUBMITTING…' : 'SUBMIT FOR REVIEW →'}
            </button>
            <Link href="/hub" style={{ fontSize: '0.82rem', color: 'var(--txt-dim)' }}>← Back to Hub</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
