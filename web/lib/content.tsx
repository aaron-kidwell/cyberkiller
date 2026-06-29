'use client'

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react'
import { API } from './api'

type ContentMap = Record<string, string>

interface EditCtx {
  editMode: boolean
  content: ContentMap
  theme: ContentMap
  dirty: boolean
  get: (id: string, fallback: string) => string
  set: (id: string, value: string) => void
  setTheme: (key: string, value: string) => void
  save: () => Promise<void>
  discard: () => void
  enterEdit: () => Promise<boolean>
  exitEdit: () => void
  adminPass: () => string
}

const EditContext = createContext<EditCtx | null>(null)

export function useEdit() {
  const ctx = useContext(EditContext)
  if (!ctx) throw new Error('useEdit must be inside EditProvider')
  return ctx
}

const PASS_KEY = 'ck_admin_pass'

export function EditProvider({ children }: { children: React.ReactNode }) {
  const [editMode, setEditMode] = useState(false)
  const [content, setContent] = useState<ContentMap>({})
  const [savedContent, setSavedContent] = useState<ContentMap>({})
  const [theme, setThemeMap] = useState<ContentMap>({})
  const [savedTheme, setSavedTheme] = useState<ContentMap>({})
  const [dirty, setDirty] = useState(false)
  const loaded = useRef(false)

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    fetch(`${API}/content`).then(r => r.json()).then(d => {
      setContent(d || {})
      setSavedContent(d || {})
    }).catch(() => {})
    fetch(`${API}/theme`).then(r => r.json()).then(d => {
      setThemeMap(d || {})
      setSavedTheme(d || {})
    }).catch(() => {})
  }, [])

  const adminPass = useCallback(() => {
    if (typeof window === 'undefined') return ''
    return sessionStorage.getItem(PASS_KEY) || ''
  }, [])

  const get = useCallback((id: string, fallback: string) => content[id] ?? fallback, [content])

  const set = useCallback((id: string, value: string) => {
    setContent(m => ({ ...m, [id]: value }))
    setDirty(true)
  }, [])

  const setTheme = useCallback((key: string, value: string) => {
    setThemeMap(m => ({ ...m, [key]: value }))
    setDirty(true)
  }, [])

  const enterEdit = useCallback(async () => {
    const handle = typeof window !== 'undefined' ? (localStorage.getItem('ck_player_handle') || '') : ''
    if (!handle) { alert('Not logged in'); return false }
    let pass = adminPass()
    if (!pass) {
      pass = window.prompt(`Admin password for @${handle}:`) || ''
      if (!pass) return false
    }
    const res = await fetch(`${API}/admin/settings`, {
      headers: { 'X-Admin-User': handle, 'X-Admin-Pass': pass },
    })
    if (!res.ok) {
      sessionStorage.removeItem(PASS_KEY)
      alert('Wrong password')
      return false
    }
    sessionStorage.setItem(PASS_KEY, pass)
    setEditMode(true)
    return true
  }, [adminPass])

  const exitEdit = useCallback(() => setEditMode(false), [])

  const save = useCallback(async () => {
    const handle = typeof window !== 'undefined' ? (localStorage.getItem('ck_player_handle') || '') : ''
    const pass = adminPass()
    const hdrs = { 'Content-Type': 'application/json', 'X-Admin-User': handle, 'X-Admin-Pass': pass }

    const contentDiff: ContentMap = {}
    for (const [k, v] of Object.entries(content)) {
      if (v !== savedContent[k]) contentDiff[k] = v
    }
    if (Object.keys(contentDiff).length) {
      await fetch(`${API}/admin/content`, { method: 'PUT', headers: hdrs, body: JSON.stringify(contentDiff) })
      setSavedContent({ ...content })
    }

    const themeDiff: ContentMap = {}
    for (const [k, v] of Object.entries(theme)) {
      if (v !== savedTheme[k]) themeDiff[k] = v
    }
    if (Object.keys(themeDiff).length) {
      await fetch(`${API}/admin/theme`, { method: 'PUT', headers: hdrs, body: JSON.stringify(themeDiff) })
      setSavedTheme({ ...theme })
    }
    setDirty(false)
  }, [adminPass, content, savedContent, theme, savedTheme])

  const discard = useCallback(() => {
    setContent({ ...savedContent })
    setThemeMap({ ...savedTheme })
    setDirty(false)
  }, [savedContent, savedTheme])

  return (
    <EditContext.Provider value={{ editMode, content, theme, dirty, get, set, setTheme, save, discard, enterEdit, exitEdit, adminPass }}>
      {children}
    </EditContext.Provider>
  )
}
