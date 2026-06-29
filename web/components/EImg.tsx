'use client'

import { useRef } from 'react'
import { useEdit } from '../lib/content'
import { API, resolveRuntimeAPI } from '../lib/api'

interface Props {
  id: string
  src: string
  alt?: string
  className?: string
  style?: React.CSSProperties
}

export function EImg({ id, src: defaultSrc, alt = '', className, style }: Props) {
  const { editMode, get, set, adminPass } = useEdit()
  const inputRef = useRef<HTMLInputElement>(null)
  const src = get(id, defaultSrc)

  const handleClick = () => {
    if (!editMode) return
    inputRef.current?.click()
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    const pass = adminPass()
    const handle = typeof window !== 'undefined' ? (localStorage.getItem('ck_player_handle') || '') : ''
    const res = await fetch(`${resolveRuntimeAPI()}/admin/upload`, {
      method: 'POST',
      headers: { 'X-Admin-User': handle, 'X-Admin-Pass': pass },
      body: fd,
    })
    if (!res.ok) return
    const { url } = await res.json()
    set(id, url)
    e.target.value = ''
  }

  return (
    <div
      onClick={handleClick}
      style={{ position: 'relative', display: 'inline-block', cursor: editMode ? 'pointer' : 'default' }}
    >
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
      <img
        src={src}
        alt={alt}
        className={className}
        style={{
          ...style,
          ...(editMode ? { outline: '1.5px dashed var(--cyan)', outlineOffset: 3 } : {}),
        }}
      />
      {editMode && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(8,8,16,0.65)',
          opacity: 0, transition: 'opacity 0.15s',
          fontSize: '0.68rem', letterSpacing: '0.12em', color: 'var(--cyan)',
        }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
        >
          CLICK TO REPLACE
        </div>
      )}
    </div>
  )
}
