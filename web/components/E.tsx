'use client'

import { useEffect, useRef } from 'react'
import { useEdit } from '../lib/content'

interface Props {
  id: string
  as?: string
  className?: string
  style?: React.CSSProperties
  children: string | string[]
}

export function E({ id, as = 'span', className, style, children }: Props) {
  const { editMode, get, set } = useEdit()
  const ref = useRef<HTMLDivElement>(null)
  const defaultStr = Array.isArray(children) ? children.join('') : children
  const value = get(id, defaultStr)

  useEffect(() => {
    if (ref.current && ref.current.textContent !== value) {
      ref.current.textContent = value
    }
  }, [value])

  const Tag = as as keyof React.JSX.IntrinsicElements

  if (!editMode) {
    return <Tag className={className} style={style}>{value}</Tag>
  }

  const AnyTag = Tag as 'div'
  return (
    <AnyTag
      ref={ref}
      className={className}
      style={{
        ...style,
        outline: '1.5px dashed var(--cyan)',
        outlineOffset: 3,
        cursor: 'text',
        borderRadius: 2,
        minWidth: 8,
      }}
      contentEditable
      suppressContentEditableWarning
      onBlur={(e: React.FocusEvent<HTMLElement>) => set(id, e.currentTarget.textContent || '')}
    >
      {value}
    </AnyTag>
  )
}
