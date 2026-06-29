'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getAdminCreds, clearAdminCreds } from '../lib/api'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const path = usePathname()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (path === '/login') {
      setReady(true)
      return
    }
    const { user, pass } = getAdminCreds()
    if (!user || !pass) {
      router.replace('/login')
    } else {
      setReady(true)
    }
  }, [path, router])

  if (!ready) return null
  return <>{children}</>
}
