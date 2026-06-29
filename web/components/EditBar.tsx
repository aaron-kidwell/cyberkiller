'use client'

import { useState } from 'react'
import { useEdit } from '../lib/content'

const THEME_VARS = [
  { key: '--mag',    label: 'Primary',    },
  { key: '--cyan',   label: 'Accent',     },
  { key: '--green',  label: 'Success',    },
  { key: '--red',    label: 'Danger',     },
  { key: '--purple', label: 'Purple',     },
  { key: '--bg',     label: 'Background', },
  { key: '--panel',  label: 'Panel',      },
  { key: '--border', label: 'Border',     },
  { key: '--txt',    label: 'Text',       },
  { key: '--txt-dim',label: 'Text dim',   },
  { key: '--txt-bright', label: 'Text bright' },
]

const DEFAULTS: Record<string, string> = {
  '--mag': '#e834c6', '--cyan': '#22d3ee', '--green': '#00ff88',
  '--red': '#ff3355', '--purple': '#8b5cf6', '--bg': '#080810',
  '--panel': '#111124', '--border': '#1e1e3a', '--txt': '#e2e2f8',
  '--txt-dim': '#9a9ac8', '--txt-bright': '#fafaff',
}

function ColorPanel() {
  const { theme, setTheme } = useEdit()
  return (
    <div style={{
      padding: '16px 20px',
      background: '#0a0a18',
      borderTop: '1px solid var(--border)',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
      gap: 12,
    }}>
      {THEME_VARS.map(({ key, label }) => {
        const val = theme[key] ?? DEFAULTS[key] ?? '#ffffff'
        return (
          <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.62rem', color: 'var(--txt-dim)', letterSpacing: '0.08em' }}>
              {label}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="color"
                value={val}
                onChange={e => setTheme(key, e.target.value)}
                style={{ width: 32, height: 24, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
              />
              <code style={{ fontSize: '0.65rem', color: 'var(--txt-dim)' }}>{val}</code>
            </div>
          </label>
        )
      })}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1/-1' }}>
        <span style={{ fontSize: '0.62rem', color: 'var(--txt-dim)', letterSpacing: '0.08em' }}>CUSTOM CSS</span>
        <textarea
          placeholder="--hud: 'Custom Font', monospace;"
          style={{
            background: '#0d0d1a', border: '1px solid var(--border)', color: 'var(--txt)',
            fontSize: '0.72rem', fontFamily: 'monospace', padding: '6px 8px',
            resize: 'vertical', minHeight: 48, borderRadius: 2,
          }}
        />
      </label>
    </div>
  )
}

export function EditBar() {
  const { editMode, dirty, exitEdit, save, discard } = useEdit()
  const [saving, setSaving] = useState(false)
  const [showColors, setShowColors] = useState(false)

  if (!editMode) return null

  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9998 }}>
      {showColors && <ColorPanel />}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 20px',
        background: '#080810', borderTop: '1px solid var(--mag)',
        boxShadow: '0 -4px 20px rgba(232,52,198,0.15)',
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: '0.65rem', color: 'var(--mag)', letterSpacing: '0.12em', marginRight: 4 }}>
          ✏ EDIT MODE
        </span>
        {dirty && (
          <span style={{ fontSize: '0.65rem', color: 'var(--amber, #f59e0b)', letterSpacing: '0.06em' }}>
            ● unsaved
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowColors(s => !s)}
          style={barBtn(showColors ? 'var(--cyan)' : 'var(--border)')}
        >
          🎨 COLORS
        </button>
        <button
          onClick={discard}
          style={barBtn('var(--border)')}
          disabled={!dirty}
        >
          DISCARD
        </button>
        <button
          onClick={async () => { setSaving(true); await save(); setSaving(false) }}
          style={barBtn('var(--mag)', dirty)}
          disabled={saving || !dirty}
        >
          {saving ? 'SAVING…' : '✓ SAVE'}
        </button>
        <button
          onClick={exitEdit}
          style={barBtn('var(--border)')}
        >
          EXIT
        </button>
      </div>
    </div>
  )
}

function barBtn(borderColor: string, highlight = false): React.CSSProperties {
  return {
    background: highlight ? 'rgba(232,52,198,0.12)' : 'transparent',
    border: `1px solid ${borderColor}`,
    color: highlight ? 'var(--mag)' : 'var(--txt-dim)',
    fontFamily: 'var(--hud)',
    fontSize: '0.68rem', letterSpacing: '0.1em',
    padding: '5px 12px', cursor: 'pointer', borderRadius: 2,
  }
}
