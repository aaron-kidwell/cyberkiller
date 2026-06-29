'use client'

import { useEffect, useState } from 'react'
import { API, resolveRuntimeAPI } from '../lib/api'
import { EditProvider } from '../lib/content'
import { EditBar } from './EditBar'
import { ThemeInjector } from './ThemeInjector'

export function ClientProviders({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    const check = async () => {
      const handle = localStorage.getItem('ck_player_handle') || ''
      if (!handle) { setIsAdmin(false); return }
      try {
        const d = await fetch(`${resolveRuntimeAPI()}/player/${handle}`).then(r => r.json())
        setIsAdmin(!!d.is_admin)
      } catch { setIsAdmin(false) }
    }
    check()
    window.addEventListener('storage', check)
    return () => window.removeEventListener('storage', check)
  }, [])

  return (
    <EditProvider>
      <ThemeInjector />
      {children}
      {isAdmin && <EditBar />}
    </EditProvider>
  )
}
