'use client'

import { Suspense } from 'react'
import { HubApp } from '../../components/HubApp'

export default function HubPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: 'var(--txt-dim)' }}>Loading hub…</div>}>
      <HubApp />
    </Suspense>
  )
}
