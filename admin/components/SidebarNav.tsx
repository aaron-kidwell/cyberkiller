'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearAdminCreds, getAdminCreds } from '../lib/api'

const NAV = [
  {
    label: 'Range',
    links: [
      { href: '/',       icon: '⬡', label: 'Dashboard' },
      { href: '/images', icon: '◉', label: 'Targets' },
      { href: '/corp',   icon: '⌬', label: 'MERIDIAN Example' },
    ],
  },
  {
    label: 'People',
    links: [
      { href: '/players',     icon: '◈', label: 'Players' },
      { href: '/submissions', icon: '◇', label: 'Submissions' },
      { href: '/feedback',    icon: '★', label: 'Feedback' },
      { href: '/reports',     icon: '⚑', label: 'Reports' },
    ],
  },
  {
    label: 'Config',
    links: [
      { href: '/settings', icon: '⚙', label: 'All Settings' },
    ],
  },
]

export function SidebarNav() {
  const path = usePathname()
  const router = useRouter()
  const { user } = getAdminCreds()

  const logout = () => {
    clearAdminCreds()
    router.push('/login')
  }

  return (
    <>
      {NAV.map(group => (
        <div key={group.label} className="sidebar-section">
          <div className="sidebar-label">{group.label}</div>
          {group.links.map(l => {
            const active = l.href === '/' ? path === '/' : path.startsWith(l.href)
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`sidebar-link ${active ? 'active' : ''}`}
              >
                <i className="sidebar-icon">{l.icon}</i>
                {l.label}
              </Link>
            )
          })}
        </div>
      ))}

      <div className="sidebar-section" style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        {user && (
          <div style={{ fontSize: '0.68rem', color: 'var(--txt-dim)', marginBottom: 8, paddingLeft: 4 }}>
            @{user}
          </div>
        )}
        <button
          onClick={logout}
          style={{
            width: '100%', textAlign: 'left', background: 'none', border: 'none',
            color: 'var(--txt-dim)', fontSize: '0.78rem', padding: '6px 8px',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, borderRadius: 4,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--txt-dim)')}
        >
          <i style={{ fontStyle: 'normal' }}>⏻</i> Sign Out
        </button>
      </div>
    </>
  )
}
