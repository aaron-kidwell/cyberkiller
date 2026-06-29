'use client'

import { useEffect } from 'react'
import { useEdit } from '../lib/content'

export function ThemeInjector() {
  const { theme } = useEdit()

  useEffect(() => {
    const entries = Object.entries(theme)
    if (!entries.length) return
    const css = `:root { ${entries.map(([k, v]) => `${k}: ${v};`).join(' ')} }`
    let el = document.getElementById('ck-theme-override') as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = 'ck-theme-override'
      document.head.appendChild(el)
    }
    el.textContent = css
  }, [theme])

  return null
}
