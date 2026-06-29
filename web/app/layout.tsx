import type { Metadata } from 'next'
import './globals.css'
import { Nav } from '../components/Nav'
import { ClientProviders } from '../components/ClientProviders'

export const metadata: Metadata = { title: 'CyberKiller, Live Cyber Range' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClientProviders>
          <Nav />
          <div className="ck-main">{children}</div>
        </ClientProviders>
      </body>
    </html>
  )
}
