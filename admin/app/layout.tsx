import './globals.css'
import { SidebarNav } from '../components/SidebarNav'
import { AuthGuard } from '../components/AuthGuard'
import { WEB_URL } from '../lib/api'

export const metadata = { title: 'CyberKiller - Control Room' }

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthGuard>
          <div className="admin-shell">
            <header className="admin-topbar">
              <div className="admin-logo" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/ck-logo-nav.png" alt="CYBERKILLER" style={{ height: 32, width: 'auto' }} />
                <span>CONTROL ROOM</span>
              </div>
              <div className="topbar-status">
                <span><span className="live-dot" />OPERATOR</span>
                <a href={WEB_URL} target="_blank" rel="noreferrer"
                  style={{ fontSize: '0.68rem', color: 'var(--txt-dim)' }}>
                  ↗ Player site
                </a>
              </div>
            </header>

            <aside className="admin-sidebar">
              <SidebarNav />
            </aside>

            <main className="admin-main">
              {children}
            </main>
          </div>
        </AuthGuard>
      </body>
    </html>
  )
}
