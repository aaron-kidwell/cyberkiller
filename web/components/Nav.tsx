'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useEdit } from '../lib/content'
import { resolveRuntimeAPI } from '../lib/api'

export function Nav() {
  const path = usePathname()
  const router = useRouter()
  const [handle, setHandle] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { editMode, enterEdit, exitEdit } = useEdit()

  useEffect(() => {
    const h = localStorage.getItem('ck_player_handle') || ''
    setHandle(h)
    const onStorage = () => setHandle(localStorage.getItem('ck_player_handle') || '')
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    if (!handle) { setIsAdmin(false); return }
    fetch(`${resolveRuntimeAPI()}/player/${handle}`)
      .then(r => r.json())
      .then(d => setIsAdmin(!!d.is_admin))
      .catch(() => setIsAdmin(false))
  }, [handle])

  const logout = async () => {
    // Server-side session kill. The cookie itself is HttpOnly so we ask the
    // server to NULL session_token in the DB and clear the cookie via Set-Cookie.
    try {
      await fetch(`${resolveRuntimeAPI()}/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch { /* ignore network error, still clear local state */ }
    localStorage.removeItem('ck_player_handle')
    localStorage.removeItem('ck_agent_token')
    setHandle('')
    setIsAdmin(false)
    setMenuOpen(false)
    router.push('/')
    window.dispatchEvent(new Event('storage'))
  }

  const close = () => setMenuOpen(false)

  return (
    <nav className="ck-nav">
      <Link href="/" className="ck-logo" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }} onClick={close}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/ck-ghost.png"
          alt=""
          aria-hidden
          height={32}
          style={{ height: 32, width: 'auto', display: 'block', filter: 'drop-shadow(0 0 6px rgba(232,52,198,0.5))' }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/ck-logo-nav.png"
          alt="CYBERKILLER"
          height={36}
          style={{ height: 36, width: 'auto', display: 'block' }}
        />
      </Link>
      <button
        type="button"
        className="ck-nav-hamburger"
        onClick={() => setMenuOpen(o => !o)}
        aria-label="Menu"
      >
        {menuOpen ? '✕' : '☰'}
      </button>
      <div className={`ck-nav-links${menuOpen ? ' open' : ''}`}>
        {isAdmin && (
          <button
            type="button"
            onClick={() => { editMode ? exitEdit() : enterEdit(); close() }}
            className="ck-nav-link ck-edit-toggle"
            style={{
              background: editMode ? 'rgba(232,52,198,0.12)' : 'none',
              border: editMode ? '1px solid var(--mag)' : 'none',
              borderRadius: 2,
              cursor: 'pointer',
              color: editMode ? 'var(--mag)' : 'var(--txt-dim)',
              fontSize: 'inherit', fontFamily: 'inherit',
              opacity: 0,
              transition: 'opacity 0.2s',
              padding: editMode ? '2px 8px' : undefined,
            }}
          >
            {editMode ? '✏ EDITING' : '✏ EDIT'}
          </button>
        )}
        <Link href="/" className={`ck-nav-link ${path === '/' ? 'active' : ''}`} onClick={close}>HOME</Link>
        <Link href="/hub" className={`ck-nav-link ${path.startsWith('/hub') ? 'active' : ''}`} onClick={close}>HUB</Link>
        <Link href="/featured" className={`ck-nav-link ${path.startsWith('/featured') ? 'active' : ''}`} onClick={close}>FEATURED</Link>
        {handle ? (
          <>
            <Link href={`/player/${handle}`} className={`ck-nav-link ${path.startsWith('/player/') ? 'active' : ''}`} onClick={close}>
              {handle.toUpperCase()}
            </Link>
            <button
              type="button"
              onClick={logout}
              className="ck-nav-link"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--txt-dim)', fontSize: 'inherit', fontFamily: 'inherit' }}
            >
              LOGOUT
            </button>
          </>
        ) : (
          <>
            <Link href="/signup" className={`ck-nav-link ck-nav-link-cta ${path === '/signup' ? 'active' : ''}`} onClick={close}>
              REGISTER
            </Link>
            <Link href="/login" className={`ck-nav-link ${path === '/login' ? 'active' : ''}`} onClick={close}>
              LOGIN
            </Link>
          </>
        )}
      </div>
    </nav>
  )
}
