'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { API, resolveRuntimeAPI } from '../../../lib/api'
import { PlayerProfile } from '../../../lib/profile'
import { ProfileView } from '../../../components/ProfileView'

export default function PlayerProfilePage() {
  const { handle } = useParams<{ handle: string }>()
  const [p, setP] = useState<PlayerProfile | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    const load = () =>
      fetch(`${resolveRuntimeAPI()}/player/${handle}`)
        .then(r => {
          if (!r.ok) throw new Error('not found')
          return r.json()
        })
        .then(setP)
        .catch(() => setErr('Operative not found'))
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [handle])

  if (err) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--txt-dim)' }}>
        {err}
        <br /><Link href="/hub" style={{ marginTop: 16, display: 'inline-block' }}>← Hub</Link>
      </div>
    )
  }
  if (!p) return <div style={{ padding: '2rem', color: 'var(--txt-dim)' }}>Loading profile…</div>

  const mine = typeof window !== 'undefined' && localStorage.getItem('ck_player_handle') === handle

  return (
    <>
      {mine && (
        <div className="profile-mine-actions" style={{
          position: 'fixed', top: 56, right: 16, zIndex: 50,
          display: 'flex', gap: 6,
        }}>
          <Link href={`/player/${handle}/posts/new`} style={{
            background: 'var(--panel)', color: 'var(--cyan)', padding: '8px 14px',
            fontFamily: 'var(--hud)', fontSize: '0.65rem', letterSpacing: '0.08em', textDecoration: 'none',
            border: '1px solid var(--cyan)',
          }}>
            + POST
          </Link>
          <Link href={`/player/${handle}/edit`} style={{
            background: 'var(--mag)', color: 'var(--bg)', padding: '8px 14px',
            fontFamily: 'var(--hud)', fontSize: '0.65rem', letterSpacing: '0.08em', textDecoration: 'none',
          }}>
            ✎ CUSTOMIZE
          </Link>
          <Link href={`/player/${handle}/settings`} style={{
            background: 'var(--panel)', color: 'var(--txt-dim)', padding: '8px 14px',
            fontFamily: 'var(--hud)', fontSize: '0.65rem', letterSpacing: '0.08em', textDecoration: 'none',
            border: '1px solid var(--border)',
          }}>
            ⚙ SETTINGS
          </Link>
        </div>
      )}
      <ProfileView profile={p} />
    </>
  )
}
