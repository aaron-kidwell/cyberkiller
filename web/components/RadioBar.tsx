'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RADIO_STATIONS } from '../lib/api'

const AUTOPLAY_KEY = 'ck_radio_autoplay'
const EQ_KEY = 'ck_radio_eq'

// 5-band graphic EQ. Frequencies chosen to span sub-bass to air.
const EQ_BANDS = [60, 230, 910, 3600, 14000]
const EQ_LABELS = ['60', '230', '910', '3.6k', '14k']

// Presets: gain in dB per band. -12..+12.
const EQ_PRESETS: Record<string, number[]> = {
  Flat:        [0, 0, 0, 0, 0],
  'Bass Boost':[8, 5, 0, 0, 2],
  Synthwave:   [5, 2, -2, 0, 4],
  Vocal:       [-3, 1, 4, 3, 0],
  Treble:      [0, 0, 0, 4, 7],
  'Lo-Fi':     [3, 1, 0, -3, -8],
}

type Props = {
  autoplay?: boolean
}

export function RadioBar({ autoplay: autoplayProp = true }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [stationIdx, setStationIdx] = useState(0)
  const [vol, setVol] = useState(15)
  const [vuHeights, setVuHeights] = useState<number[]>(() => Array(15).fill(3))
  const [error, setError] = useState('')
  const [autoplay, setAutoplay] = useState(() => {
    if (typeof window === 'undefined') return autoplayProp
    const saved = localStorage.getItem(AUTOPLAY_KEY)
    return saved === null ? autoplayProp : saved === 'true'
  })

  // ── EQ state ──────────────────────────────────────────────────────────────
  const [eqOpen, setEqOpen] = useState(false)
  const [eqGains, setEqGains] = useState<number[]>(() => {
    if (typeof window === 'undefined') return EQ_PRESETS.Flat
    try {
      const saved = JSON.parse(localStorage.getItem(EQ_KEY) || '')
      if (Array.isArray(saved) && saved.length === EQ_BANDS.length) return saved
    } catch { /* fall through */ }
    return [...EQ_PRESETS.Flat]
  })
  const audioCtxRef = useRef<AudioContext | null>(null)
  const filtersRef = useRef<BiquadFilterNode[]>([])
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)

  // Build the Web Audio graph once: source → [peaking filters] → destination.
  // MediaElementSource can only be created ONCE per element, and AudioContext
  // must be resumed from a user gesture (play / opening EQ both qualify).
  const ensureAudioGraph = useCallback(() => {
    if (typeof window === 'undefined') return
    const audio = audioRef.current
    if (!audio) return
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return // Web Audio unsupported - plain playback still works
    if (!audioCtxRef.current) {
      try {
        const ctx = new Ctx()
        const source = ctx.createMediaElementSource(audio)
        const filters = EQ_BANDS.map((freq, i) => {
          const f = ctx.createBiquadFilter()
          f.type = 'peaking'
          f.frequency.value = freq
          f.Q.value = 1.0
          f.gain.value = eqGains[i] ?? 0
          return f
        })
        // Chain: source → f0 → f1 → ... → destination
        let node: AudioNode = source
        for (const f of filters) { node.connect(f); node = f }
        node.connect(ctx.destination)
        audioCtxRef.current = ctx
        sourceRef.current = source
        filtersRef.current = filters
      } catch {
        // createMediaElementSource throws if already created; ignore.
      }
    }
    audioCtxRef.current?.resume().catch(() => {})
  }, [eqGains])

  const applyEq = useCallback((gains: number[]) => {
    filtersRef.current.forEach((f, i) => {
      if (f) f.gain.value = gains[i] ?? 0
    })
  }, [])

  const setBand = (i: number, val: number) => {
    setEqGains(prev => {
      const next = [...prev]
      next[i] = val
      localStorage.setItem(EQ_KEY, JSON.stringify(next))
      applyEq(next)
      return next
    })
  }

  const applyPreset = (name: string) => {
    const gains = [...EQ_PRESETS[name]]
    setEqGains(gains)
    localStorage.setItem(EQ_KEY, JSON.stringify(gains))
    applyEq(gains)
  }

  const toggleAutoplay = (val: boolean) => {
    setAutoplay(val)
    localStorage.setItem(AUTOPLAY_KEY, String(val))
    if (!val && playing) {
      audioRef.current?.pause()
      setPlaying(false)
    }
  }

  const station = RADIO_STATIONS[stationIdx]

  const play = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return
    ensureAudioGraph() // route through EQ graph on the first user-gesture play
    audio.src = station.url
    audio.volume = vol / 100
    try {
      await audio.play()
      setPlaying(true)
      setError('')
    } catch {
      setError('Click play to start (browser blocked autoplay)')
      setPlaying(false)
    }
  }, [station.url, vol, ensureAudioGraph])

  const pause = useCallback(() => {
    audioRef.current?.pause()
    setPlaying(false)
  }, [])

  useEffect(() => {
    if (!autoplay) return
    const t = setTimeout(() => {
      void play()
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- play once on hub entry gesture
  }, [autoplay])

  useEffect(() => {
    const id = setInterval(() => {
      setVuHeights(Array.from({ length: 15 }, () =>
        playing ? Math.floor(Math.random() * 16) + 3 : 3
      ))
    }, 110)
    return () => clearInterval(id)
  }, [playing])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = vol / 100
  }, [vol])

  const changeStation = (idx: number) => {
    setStationIdx(idx)
    if (playing && audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = RADIO_STATIONS[idx].url
      audioRef.current.volume = vol / 100
      audioRef.current.play().catch(() => setError('Station failed to load'))
    }
  }

  return (
    <div className="radio-bar">
      <audio ref={audioRef} crossOrigin="anonymous" preload="none" />
      <div className="vu">
        {vuHeights.map((h, i) => (
          <div
            key={i}
            className="vu-bar"
            style={{
              height: `${h}px`,
              background: playing ? (i % 2 ? 'var(--mag)' : 'var(--cyan)') : 'var(--border)',
            }}
          />
        ))}
      </div>
      <div style={{ minWidth: 120 }}>
        <div style={{ fontFamily: 'var(--hud)', fontSize: '0.62rem', letterSpacing: '0.1em', color: 'var(--mag)' }}>
          CYBER RADIO
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--txt-dim)' }}>{station.name}</div>
        {error && <div style={{ fontSize: '0.62rem', color: 'var(--red)' }}>{error}</div>}
      </div>
      <button
        type="button"
        className={`play-btn ${playing ? 'playing' : ''}`}
        onClick={() => (playing ? pause() : play())}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {RADIO_STATIONS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`s-btn ${i === stationIdx ? 'active' : ''}`}
            onClick={() => changeStation(i)}
          >
            {s.short}
          </button>
        ))}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className={`s-btn ${eqOpen ? 'active' : ''}`}
            onClick={() => { ensureAudioGraph(); setEqOpen(o => !o) }}
            title="Equalizer"
            style={{ fontFamily: 'var(--hud)' }}
          >
            ◢◣ EQ
          </button>
          {eqOpen && (
            <div
              style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, zIndex: 200,
                background: 'var(--bg2, #0e0a18)', border: '1px solid var(--mag)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 20px rgba(232,52,198,0.25)',
                padding: '14px 16px', width: 280,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontFamily: 'var(--hud)', fontSize: '0.7rem', letterSpacing: '0.1em', color: 'var(--mag)' }}>EQUALIZER</span>
                <button type="button" onClick={() => setEqOpen(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--txt-dim)', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>×</button>
              </div>

              {/* Band sliders (vertical) */}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4, marginBottom: 12 }}>
                {EQ_BANDS.map((_, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: '0.55rem', color: eqGains[i] ? 'var(--cyan)' : 'var(--txt-dim)' }}>
                      {eqGains[i] > 0 ? `+${eqGains[i]}` : eqGains[i]}
                    </span>
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={1}
                      value={eqGains[i]}
                      onChange={e => setBand(i, Number(e.target.value))}
                      // Vertical slider
                      style={{
                        writingMode: 'vertical-lr' as any,
                        direction: 'rtl',
                        width: 20, height: 90, accentColor: 'var(--mag)', cursor: 'pointer',
                      }}
                    />
                    <span style={{ fontSize: '0.55rem', color: 'var(--txt-dim)' }}>{EQ_LABELS[i]}</span>
                  </div>
                ))}
              </div>

              {/* Presets */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {Object.keys(EQ_PRESETS).map(name => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => applyPreset(name)}
                    style={{
                      fontSize: '0.6rem', padding: '3px 7px', cursor: 'pointer',
                      background: 'transparent', border: '1px solid var(--border)',
                      color: 'var(--txt-dim)', borderRadius: 2,
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="vol-wrap">
        <span style={{ fontSize: '0.65rem', color: 'var(--txt-dim)' }}>VOL</span>
        <input type="range" min={0} max={100} value={vol} onChange={e => setVol(Number(e.target.value))} />
        <span style={{ fontSize: '0.7rem', color: 'var(--cyan)', minWidth: 32 }}>{vol}%</span>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.62rem', color: 'var(--txt-dim)', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}>
        <input
          type="checkbox"
          checked={autoplay}
          onChange={e => toggleAutoplay(e.target.checked)}
          style={{ accentColor: 'var(--mag)', cursor: 'pointer' }}
        />
        autoplay
      </label>
    </div>
  )
}
