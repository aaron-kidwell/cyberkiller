'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { API, wsURL, resolveRuntimeAPI } from '../lib/api'
import { PlayerHoverCard } from './PlayerHoverCard'

// ── Emotes ────────────────────────────────────────────────────────────────────

// Custom hacker emotes, short codes that survive on top of 7TV.
// 7TV emotes (loaded at runtime) override any name collisions.
export const CUSTOM_EMOTES: Record<string, string> = {
  ':rooted:': '🔓', ':koth:':   '👑', ':skull:':   '☠️',
  ':owned:':  '💥', ':hack:':   '💻', ':grind:':   '⚡',
  ':rekt:':   '💣', ':zero:':   '🎯', ':ez:':      '😎',
  ':gg:':     '🏆', ':fire:':   '🔥', ':wave:':    '👋',
  ':root:':   '🐚', ':shell:':  '🖥️',  ':bug:':     '🐛',
  ':noob:':   '🤡', ':slay:':   '🗡️',  ':stealth:': '🥷',
  ':rip:':    '🪦', ':pwned:':  '🔑',
}

// Combined live map: unicode for custom hacker codes, 7TV CDN URLs for the
// global emote set. Mutated by useEffect on mount after fetching /chat/emotes.
export const EMOTES: Record<string, string> = { ...CUSTOM_EMOTES }

function isImageEmote(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

function renderEmoteValue(code: string, value: string, key: string | number): React.ReactNode {
  if (isImageEmote(value)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={key}
        src={value}
        alt={code}
        title={code}
        height={28}
        style={{ height: 28, width: 'auto', verticalAlign: 'middle', display: 'inline-block' }}
        onError={e => { (e.currentTarget as HTMLImageElement).replaceWith(document.createTextNode(code)) }}
      />
    )
  }
  return (
    <span key={key} title={code} style={{ fontSize: '1.5em', lineHeight: 1 }}>
      {value}
    </span>
  )
}

function renderText(text: string, myHandle: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  // Split into tokens (preserve whitespace) so bare 7TV names like `KEKW`
  // can be matched without colons. Colon-wrapped codes (`:rooted:`) and
  // `@mentions` are still handled inside each non-emote token.
  const tokens = text.split(/(\s+)/)
  tokens.forEach((tok, ti) => {
    if (!tok) return
    // Bare 7TV emote match (case-sensitive, 7TV names are)
    if (EMOTES[tok] && isImageEmote(EMOTES[tok])) {
      parts.push(renderEmoteValue(tok, EMOTES[tok], `e${ti}`))
      return
    }
    // Inside a token: handle :colon-emotes: and @mentions
    const re = /:([\w]+):|@([\w\-_]+)/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(tok)) !== null) {
      if (m.index > last) parts.push(tok.slice(last, m.index))
      if (m[1]) {
        const code = `:${m[1]}:`
        const v = EMOTES[code]
        if (v) parts.push(renderEmoteValue(code, v, `${ti}-${m.index}`))
        else parts.push(code)
      } else if (m[2]) {
        const isMe = m[2].toLowerCase() === myHandle.toLowerCase()
        parts.push(
          <span key={`${ti}-${m.index}`} className={isMe ? 'chat-mention chat-mention-me' : 'chat-mention'}>
            @{m[2]}
          </span>
        )
      }
      last = m.index + m[0].length
    }
    if (last < tok.length) parts.push(tok.slice(last))
  })
  return parts
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ChatMsg = {
  id?: string
  handle: string
  text: string
  ts?: number
  system?: boolean
  type?: string
  avatar_url?: string
  accent?: string
  arena_ip?: string
}

// A real-time throne change pushed over the chat socket (type: "throne").
export type ThroneEvent = { arena_ip?: string; handle?: string; text?: string }

// Shared accent cache so older messages without an accent (history dedupe gap)
// reuse the last known color for that handle instead of bouncing back to the
// random palette.
const ACCENT_CACHE: Record<string, string> = {}

// Per-handle avatar cache shared across messages so a single render of 50
// messages from the same player doesn't fire 50 <img> requests. Falls back
// to the latest known URL when an older message has none.
const AVATAR_CACHE: Record<string, string> = {}

const HANDLE_COLORS: Record<string, string> = {}
const PALETTE = ['#22d3ee', '#e834c6', '#8b5cf6', '#00ff88', '#ffaa00', '#f43f5e', '#60a5fa', '#a3e635']

function colorFor(handle: string) {
  if (!HANDLE_COLORS[handle]) {
    const keys = Object.keys(HANDLE_COLORS).length
    HANDLE_COLORS[handle] = PALETTE[keys % PALETTE.length]
  }
  return HANDLE_COLORS[handle]
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ArenaChat({ onThrone }: { onThrone?: (e: ThroneEvent) => void } = {}) {
  // Keep the latest callback in a ref so the long-lived WS handler isn't a stale closure.
  const onThroneRef = useRef(onThrone)
  onThroneRef.current = onThrone
  // Initialize joined synchronously from localStorage to avoid first-render race
  const [joined, setJoined] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return !!localStorage.getItem('ck_player_handle')
  })
  const joinedRef = useRef<boolean>(typeof window !== 'undefined' && !!localStorage.getItem('ck_player_handle'))
  const [wsAlive, setWsAlive] = useState(false)
  const [myHandle, setMyHandle] = useState('')
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [draft, setDraft] = useState('')
  const [online, setOnline] = useState(0)
  const [, setEmoteRev] = useState(0) // bumps when 7TV map loads to force re-render
  const [showEmotes, setShowEmotes] = useState(false)
  const [emoteSearch, setEmoteSearch] = useState('')
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIdx, setMentionIdx] = useState(0)
  const [muted, setMuted] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try { return new Set(JSON.parse(localStorage.getItem('ck_muted') ?? '[]')) }
    catch { return new Set() }
  })
  const [ctxMenu, setCtxMenu] = useState<{ handle: string; x: number; y: number } | null>(null)
  const [hoverCard, setHoverCard] = useState<{ handle: string; rect: DOMRect; accent: string } | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openHoverCard = useCallback((handle: string, rect: DOMRect, accent: string) => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => setHoverCard({ handle, rect, accent }), 220)
  }, [])

  const scheduleHoverClose = useCallback(() => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null }
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => setHoverCard(null), 180)
  }, [])
  const [chatWidth, setChatWidth] = useState(480)

  const wsRef = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const emotePickerRef = useRef<HTMLDivElement>(null)
  const resizingRef = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartW = useRef(0)

  // ── Seen handles for @mention autocomplete ────────────────────────────────
  const seenHandles = Array.from(
    new Set(msgs.filter(m => !m.system && m.handle !== myHandle).map(m => m.handle))
  ).slice(-20)

  const mentionMatches = mentionQuery
    ? seenHandles.filter(h => h.toLowerCase().startsWith(mentionQuery.toLowerCase()))
    : []

  // ── Scroll ────────────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  // ── Click-outside emote picker ────────────────────────────────────────────
  useEffect(() => {
    if (!showEmotes) return
    const handler = (e: MouseEvent) => {
      if (emotePickerRef.current && !emotePickerRef.current.contains(e.target as Node)) {
        setShowEmotes(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showEmotes])

  // ── Context menu dismiss ──────────────────────────────────────────────────
  useEffect(() => {
    if (!ctxMenu) return
    const handler = () => setCtxMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [ctxMenu])

  // ── Resize ────────────────────────────────────────────────────────────────
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    resizeStartX.current = e.clientX
    resizeStartW.current = chatWidth

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const delta = resizeStartX.current - ev.clientX
      setChatWidth(Math.max(200, Math.min(480, resizeStartW.current + delta)))
    }
    const onUp = () => {
      resizingRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Online poll ───────────────────────────────────────────────────────────
  const pollOnline = useCallback(() => {
    fetch(`${resolveRuntimeAPI()}/chat/online`)
      .then(r => r.json())
      .then(d => setOnline(d.online ?? 0))
      .catch(() => {})
  }, [])

  useEffect(() => {
    pollOnline()
    const t = setInterval(pollOnline, 5000)
    return () => clearInterval(t)
  }, [pollOnline, joined])

  // Pull 7TV global emote map on mount. Names without colons (KEKW, catJAM,
  // etc.) get rendered as animated WebPs in chat. Custom :hacker: emotes still
  // work via CUSTOM_EMOTES, anything 7TV overrides by name.
  useEffect(() => {
    fetch(`${resolveRuntimeAPI()}/chat/emotes`)
      .then(r => r.ok ? r.json() : {})
      .then((map: Record<string, string>) => {
        if (!map || typeof map !== 'object') return
        for (const [name, url] of Object.entries(map)) EMOTES[name] = url
        setEmoteRev(v => v + 1)
      })
      .catch(() => {})
  }, [])

  // Load the last 100 messages from the DB on mount - reliable history, independent
  // of the WS replay/in-memory state. The WS (deduped by id) handles live + reconnect.
  useEffect(() => {
    fetch(`${resolveRuntimeAPI()}/chat/messages`)
      .then(r => r.ok ? r.json() : { messages: [] })
      .then((d: { messages?: ChatMsg[] }) => {
        const incoming = d.messages
        if (!Array.isArray(incoming)) return
        setMsgs(prev => {
          const seen = new Set(prev.map(m => m.id))
          const merged = [...incoming.filter(m => !seen.has(m.id)), ...prev]
          return merged.sort((a, b) => ((a.ts || 0) - (b.ts || 0)))
        })
      })
      .catch(() => {})
  }, [])

  // Keep ref in sync so stale WS closures can read current joined state.
  useEffect(() => { joinedRef.current = joined }, [joined])

  // ── WebSocket ─────────────────────────────────────────────────────────────
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectWSRef = useRef<((handle: string) => WebSocket | null) | null>(null)

  const connectWS = useCallback((handle: string) => {
    // Token comparison no longer applies, auth is via cookie. Idempotent
    // protection: if a WS is already CONNECTING or OPEN, leave it.
    const existing = wsRef.current
    if (existing && (existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN)) {
      return existing
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    // Chat auth now rides on the HttpOnly session cookie, the browser attaches
    // it automatically to same-origin WS upgrades. If the user isn't logged in,
    // the upgrade gets a 401 from the server and onerror fires; surface the
    // re-login banner in that case.
    const ws = new WebSocket(wsURL(`/chat/ws`))
    wsRef.current = ws
    ws.onopen = () => { console.log('[chat] WS open'); setWsAlive(true); sessionStorage.removeItem('ck_chat_fail') }
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data) as ChatMsg
        if (m.type === 'throne') {
          // Ephemeral KOTH event - flip the crown live, don't show it in chat.
          onThroneRef.current?.({ arena_ip: m.arena_ip, handle: m.handle, text: m.text })
        } else if (m.type === 'delete') {
          setMsgs(prev => prev.filter(msg => msg.id !== m.id))
        } else {
          setMsgs(prev => {
            // Dedupe by id, history replay on reconnect would otherwise spam.
            if (m.id && prev.some(x => x.id === m.id)) return prev
            return [...prev.slice(-150), m]
          })
        }
      } catch (err) { console.log('[chat] msg parse error', err) }
    }
    ws.onerror = (e) => { console.log('[chat] WS error', e); setWsAlive(false) }
    ws.onclose = (e) => {
      console.log('[chat] WS close', e.code, e.reason, 'wasClean=', e.wasClean)
      setWsAlive(false)
      // Count failures for diagnostics only, the cookie is httpOnly so we
      // can't clear it from JS anyway. A persistent failure surfaces the
      // sessionExpired banner via the session/check effect below.
      if (!e.wasClean) {
        const n = parseInt(sessionStorage.getItem('ck_chat_fail') || '0', 10) + 1
        sessionStorage.setItem('ck_chat_fail', String(n))
      }
      if (joinedRef.current) {
        pollOnline()
        // Auto-reconnect after 3s if still meant to be joined
        reconnectTimerRef.current = setTimeout(() => {
          if (joinedRef.current) connectWSRef.current?.(handle)
        }, 3000)
      }
    }
    return ws
  }, [pollOnline])

  useEffect(() => { connectWSRef.current = connectWS }, [connectWS])

  // Session check: on mount, verify the cookie session is still valid via the
  // server. If 401, surface the re-login banner.
  const [sessionExpired, setSessionExpired] = useState(false)
  useEffect(() => {
    // Only ask if the user thinks they're logged in (has a handle stored).
    if (!localStorage.getItem('ck_player_handle')) return
    fetch(`${resolveRuntimeAPI()}/session/check`, { credentials: 'include' })
      .then(r => { if (r.status === 401) setSessionExpired(true) })
      .catch(() => {})
  }, [])

  // Mobile: when the tab becomes visible or network comes back online,
  // force a reconnect check. Mobile browsers suspend setInterval in background tabs.
  useEffect(() => {
    const forceReconnect = () => {
      if (!joinedRef.current) return
      const h = localStorage.getItem('ck_player_handle')
      if (!h) return
      const ws = wsRef.current
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        console.log('[chat] visibility/network change → reconnecting')
        connectWSRef.current?.(h)
      }
    }
    const onVis = () => { if (document.visibilityState === 'visible') forceReconnect() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', forceReconnect)
    window.addEventListener('focus', forceReconnect)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', forceReconnect)
      window.removeEventListener('focus', forceReconnect)
    }
  }, [])

  // Watchdog: every 5s, check WS health. Reconnect if dead OR if token changed
  // (user logged in/out after WS was opened).
  useEffect(() => {
    const watchdog = setInterval(() => {
      if (!joinedRef.current) return
      const myHandle = localStorage.getItem('ck_player_handle')
      if (!myHandle) return
      const ws = wsRef.current
      // WS dead → reconnect (auth uses cookie, no per-token tracking needed)
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        console.log('[chat] watchdog: WS dead, reconnecting')
        connectWSRef.current?.(myHandle)
      }
    }, 5000)
    return () => clearInterval(watchdog)
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem('ck_player_handle')
    console.log('[chat] init effect, saved=', saved)
    if (saved) {
      joinedRef.current = true
      setMyHandle(saved)
      setJoined(true)
      console.log('[chat] calling connectWS(', saved, ')')
      connectWS(saved)
    }
    return () => {
      joinedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      // Only close if fully open, closing a CONNECTING WS sends TCP RST/EOF to server.
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'unmount')
      }
      wsRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const joinChat = () => {
    const h = (localStorage.getItem('ck_player_handle') ?? '').trim()
    if (!h) return
    joinedRef.current = true
    setMyHandle(h)
    setJoined(true)
    setMsgs([])
    connectWS(h)
    pollOnline()
  }

  const leaveChat = () => {
    joinedRef.current = false
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    wsRef.current?.close()
    wsRef.current = null
    setJoined(false)
    setMyHandle('')
    setMsgs([{ handle: 'system', text: 'disconnected', system: true }])
    pollOnline()
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const sendMsg = () => {
    const text = draft.trim()
    if (!text) return
    // If WS is dead, reconnect (will replay on the next render) and bail -
    // user can re-press send after reconnect lands.
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setWsAlive(false)
      if (myHandle) connectWS(myHandle)
      return
    }
    wsRef.current.send(JSON.stringify({ text }))
    setDraft('')
    setMentionQuery('')
  }

  // ── Input key handler ─────────────────────────────────────────────────────
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mentionMatches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => (i + 1) % mentionMatches.length); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIdx(i => (i - 1 + mentionMatches.length) % mentionMatches.length); return }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        insertMention(mentionMatches[mentionIdx])
        return
      }
      if (e.key === 'Escape') { setMentionQuery(''); return }
    }
    if (e.key === 'Enter') sendMsg()
  }

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setDraft(val)
    // detect @mention: find last @ in the string before cursor
    const cursor = e.target.selectionStart ?? val.length
    const before = val.slice(0, cursor)
    const atMatch = before.match(/@([\w\-_]*)$/)
    if (atMatch) {
      setMentionQuery(atMatch[1])
      setMentionIdx(0)
    } else {
      setMentionQuery('')
    }
  }

  const insertMention = (handle: string) => {
    const input = inputRef.current
    if (!input) return
    const cursor = input.selectionStart ?? draft.length
    const before = draft.slice(0, cursor)
    const after = draft.slice(cursor)
    const atIdx = before.lastIndexOf('@')
    const newDraft = before.slice(0, atIdx) + '@' + handle + ' ' + after
    setDraft(newDraft)
    setMentionQuery('')
    setTimeout(() => {
      const pos = atIdx + handle.length + 2
      input.setSelectionRange(pos, pos)
      input.focus()
    }, 0)
  }

  const insertEmote = (code: string) => {
    const input = inputRef.current
    const cursor = input?.selectionStart ?? draft.length
    const newDraft = draft.slice(0, cursor) + code + ' ' + draft.slice(cursor)
    setDraft(newDraft)
    setShowEmotes(false)
    setTimeout(() => {
      const pos = cursor + code.length + 1
      input?.setSelectionRange(pos, pos)
      input?.focus()
    }, 0)
  }

  // ── Mute ──────────────────────────────────────────────────────────────────
  const muteHandle = (handle: string) => {
    setMuted(prev => {
      const next = new Set(prev)
      next.add(handle)
      localStorage.setItem('ck_muted', JSON.stringify([...next]))
      return next
    })
    setCtxMenu(null)
  }

  const unmuteHandle = (handle: string) => {
    setMuted(prev => {
      const next = new Set(prev)
      next.delete(handle)
      localStorage.setItem('ck_muted', JSON.stringify([...next]))
      return next
    })
  }

  const onHandleRightClick = (e: React.MouseEvent, handle: string) => {
    e.preventDefault()
    setCtxMenu({ handle, x: e.clientX, y: e.clientY })
  }

  // ── Emote picker filter ───────────────────────────────────────────────────
  const filteredEmotes = Object.entries(EMOTES).filter(([code]) =>
    !emoteSearch || code.toLowerCase().includes(emoteSearch.toLowerCase())
  )

  // ── Visible messages (filter muted) ──────────────────────────────────────
  const visibleMsgs = msgs.filter(m => !m.handle || m.system || !muted.has(m.handle))

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <aside className="hub-sidebar" style={{ width: chatWidth, minWidth: chatWidth }}>
      {/* Resize handle */}
      <div className="chat-resize-handle" onMouseDown={onResizeStart} />

      {/* Header */}
      <div className="chat-hdr">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="chat-label">ARENA CHAT</span>
          <span
            title={joined ? (wsAlive ? 'connected' : 'reconnecting…') : 'click rejoin'}
            style={{
              width: 6, height: 6, borderRadius: '50%',
              background: joined && wsAlive ? 'var(--green)' : joined ? 'var(--amber, #f59e0b)' : 'var(--txt-dim)',
              boxShadow: joined && wsAlive ? '0 0 6px var(--green)' : 'none',
              flexShrink: 0,
            }}
          />
          {joined && !wsAlive && (
            <>
              <span style={{ fontSize: '0.65rem', color: 'var(--amber, #f59e0b)', letterSpacing: '0.08em' }}>
                RECONNECTING…
              </span>
              <button
                type="button"
                onClick={() => {
                  const h = localStorage.getItem('ck_player_handle') || ''
                  console.log('[chat] RETRY clicked, handle=', h, 'wsRef.current=', wsRef.current?.readyState, 'connectWSRef=', !!connectWSRef.current)
                  if (!h) {
                    alert('Not logged in, log in first.')
                    return
                  }
                  joinedRef.current = true
                  // Force-close existing WS regardless of state to break stuck loops
                  if (wsRef.current) {
                    try { wsRef.current.close() } catch {}
                    wsRef.current = null
                  }
                  // Reset fail counter so we don't trip the "clear token" branch
                  sessionStorage.removeItem('ck_chat_fail')
                  // Call connectWS directly, fall back to using the current `connectWS` ref
                  // in case connectWSRef hasn't been set yet (race on mount).
                  const fn = connectWSRef.current || connectWS
                  fn(h)
                }}
                style={{
                  fontSize: '0.62rem', padding: '2px 8px', background: 'transparent',
                  border: '1px solid var(--cyan)', color: 'var(--cyan)',
                  cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em',
                }}
              >
                ↻ Retry
              </button>
            </>
          )}
          {muted.size > 0 && (
            <span
              className="chat-muted-badge"
              title={`${muted.size} muted, click to manage`}
              onClick={() => {
                if (confirm(`Unmute all ${muted.size} player(s)?`)) {
                  setMuted(new Set())
                  localStorage.setItem('ck_muted', '[]')
                }
              }}
            >
              {muted.size} muted
            </span>
          )}
        </div>
        <span style={{ fontSize: '0.7rem', color: 'var(--txt-dim)' }}>{online} ONLINE</span>
      </div>

      {/* Session expired banner */}
      {sessionExpired && (
        <div style={{
          padding: '8px 12px', background: 'rgba(255,176,0,0.1)',
          borderBottom: '1px solid var(--amber, #f59e0b)',
          fontSize: '0.72rem', color: 'var(--amber, #f59e0b)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <span>Session expired, chatting as anon</span>
          <a href="/login" style={{ color: 'var(--cyan)', fontWeight: 600, textDecoration: 'underline' }}>
            Re-login →
          </a>
        </div>
      )}

      {/* Messages */}
      <div className="chat-msgs">
        {!joined && visibleMsgs.length === 0 && (
          <div className="chat-sys">» Press rejoin to re-enter arena chat</div>
        )}
        {visibleMsgs.map((m, i) =>
          m.system ? (
            <div key={i} className="chat-sys">» {m.text}</div>
          ) : (() => {
            if (m.avatar_url) AVATAR_CACHE[m.handle] = m.avatar_url
            if (m.accent) ACCENT_CACHE[m.handle] = m.accent
            const avatar = AVATAR_CACHE[m.handle]
            const color = ACCENT_CACHE[m.handle] || colorFor(m.handle)
            const initial = m.handle.charAt(0).toUpperCase()
            // Hover tooltip: the send time rendered in the VIEWER's own locale +
            // timezone (toLocaleString reads the browser's local TZ), so each
            // player sees when a message was sent in their own time.
            const sentLocal = m.ts ? new Date(m.ts * 1000).toLocaleString() : undefined
            return (
              // Inline flow (not flex): the message text starts right after the
              // name on the same line and wraps underneath, instead of the whole
              // text block dropping below the name.
              <div key={i} className="chat-msg" title={sentLocal}>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => window.open(`/player/${m.handle}`, '_blank')}
                  onContextMenu={e => onHandleRightClick(e, m.handle)}
                  onKeyDown={e => e.key === 'Enter' && window.open(`/player/${m.handle}`, '_blank')}
                  onMouseEnter={e => openHoverCard(m.handle, (e.currentTarget as HTMLElement).getBoundingClientRect(), color)}
                  onMouseLeave={scheduleHoverClose}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', verticalAlign: 'middle', marginRight: 6 }}
                >
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatar}
                      alt=""
                      width={18}
                      height={18}
                      style={{ borderRadius: '50%', objectFit: 'cover', border: `1px solid ${color}`, flexShrink: 0 }}
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 18, height: 18, borderRadius: '50%',
                        background: 'rgba(255,255,255,0.04)', border: `1px solid ${color}`,
                        color, fontSize: '0.6rem', fontWeight: 700, flexShrink: 0,
                      }}
                    >{initial}</span>
                  )}
                  <span style={{ color, fontWeight: 600 }}>{m.handle}</span>
                </span>
                <span className="chat-msg-text">{renderText(m.text, myHandle)}</span>
              </div>
            )
          })()
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="chat-input-wrap">
        {!joined ? (
          <button type="button" className="chat-join-btn" onClick={joinChat}>
            REJOIN ARENA CHAT
          </button>
        ) : (
          <>
            {/* @mention autocomplete */}
            {mentionMatches.length > 0 && (
              <div className="mention-menu">
                {mentionMatches.slice(0, 6).map((h, i) => (
                  <div
                    key={h}
                    className={`mention-item ${i === mentionIdx ? 'active' : ''}`}
                    onMouseDown={e => { e.preventDefault(); insertMention(h) }}
                  >
                    <span style={{ color: colorFor(h) }}>@{h}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Emote picker */}
            {showEmotes && (
              <div className="emote-picker" ref={emotePickerRef}>
                <input
                  className="emote-search"
                  placeholder="search emotes…"
                  value={emoteSearch}
                  onChange={e => setEmoteSearch(e.target.value)}
                  autoFocus
                />
                <div className="emote-grid">
                  {filteredEmotes.map(([code, value]) => (
                    <button
                      key={code}
                      type="button"
                      className="emote-btn"
                      title={code}
                      onMouseDown={e => { e.preventDefault(); insertEmote(code) }}
                    >
                      {isImageEmote(value) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={value} alt={code} height={28} style={{ height: 28, width: 'auto' }} />
                      ) : value}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="chat-row">
              <button
                type="button"
                className="chat-emote-toggle"
                onClick={() => { setShowEmotes(v => !v); setEmoteSearch('') }}
                title="Emotes"
              >
                😀
              </button>
              <input
                ref={inputRef}
                className="chat-input"
                placeholder="send a message… (@handle, :emote:)"
                maxLength={280}
                value={draft}
                onChange={onInputChange}
                onKeyDown={onInputKeyDown}
              />
              <button type="button" className="chat-send" onClick={sendMsg}>↑</button>
            </div>
            <button
              type="button"
              onClick={leaveChat}
              style={{
                width: '100%', marginTop: 6, fontSize: '0.65rem', background: 'transparent',
                border: '1px solid var(--border)', color: 'var(--txt-dim)', padding: 6, cursor: 'pointer',
              }}
            >
              LEAVE
            </button>
          </>
        )}
      </div>

      {/* Context menu */}
      {hoverCard && (
        <div onMouseEnter={() => { if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null } }}>
          <PlayerHoverCard
            handle={hoverCard.handle}
            anchorRect={hoverCard.rect}
            accent={hoverCard.accent}
            onClose={scheduleHoverClose}
          />
        </div>
      )}
      {ctxMenu && (
        <div
          className="chat-ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <div className="ctx-menu-handle" style={{ color: colorFor(ctxMenu.handle) }}>
            @{ctxMenu.handle}
          </div>
          <button
            type="button"
            className="ctx-menu-item"
            onClick={() => window.open(`/player/${ctxMenu.handle}`, '_blank')}
          >
            View profile
          </button>
          <button
            type="button"
            className="ctx-menu-item"
            onClick={() => {
              setDraft(d => d + `@${ctxMenu.handle} `)
              setCtxMenu(null)
              setTimeout(() => inputRef.current?.focus(), 0)
            }}
          >
            @ Mention
          </button>
          {muted.has(ctxMenu.handle) ? (
            <button type="button" className="ctx-menu-item ctx-menu-unmute" onClick={() => { unmuteHandle(ctxMenu.handle); setCtxMenu(null) }}>
              Unmute
            </button>
          ) : (
            <button type="button" className="ctx-menu-item ctx-menu-mute" onClick={() => muteHandle(ctxMenu.handle)}>
              Mute
            </button>
          )}
        </div>
      )}
    </aside>
  )
}
