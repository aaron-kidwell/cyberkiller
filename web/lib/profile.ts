export type PlayerProfile = {
  handle: string
  title?: string | null
  bio?: string | null
  avatar_url?: string | null
  custom_css?: string | null
  theme_preset?: string | null
  color_bg?: string | null
  color_card?: string | null
  color_accent?: string | null
  color_text?: string | null
  color_text_dim?: string | null
  // extended profile_ext fields
  status?: string | null
  location?: string | null
  background_url?: string | null
  background_tile?: boolean | null
  social_github?: string | null
  social_twitter?: string | null
  social_website?: string | null
  featured_skills?: string | null
  music_url?: string | null
  music_label?: string | null
  youtube_url?: string | null
  layout_col?: string | null
  badges_hidden?: string | null
  // stats (read-only)
  points: number
  kills: number
  deaths?: number
  rank?: number
  target_kills?: number
  koth_crowns?: number
  first_bloods?: number
  login_streak?: number
  login_streak_max?: number
  recent_kills?: { kind: string; points: number; submitted_at: string }[]
}

export type ThemePreset = {
  id: string
  name: string
  color_bg: string
  color_card: string
  color_accent: string
  color_text: string
  color_text_dim: string
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'neon_ghost',  name: 'Neon Ghost',  color_bg: '#0a0f14', color_card: '#111a22', color_accent: '#22d3ee', color_text: '#e8f4ff', color_text_dim: '#5a8a9a' },
  { id: 'shadow_op',   name: 'Shadow Op',   color_bg: '#0d0a14', color_card: '#16101f', color_accent: '#8b5cf6', color_text: '#ece8ff', color_text_dim: '#6a5a8a' },
  { id: 'berserker',   name: 'Berserker',   color_bg: '#140a0a', color_card: '#221111', color_accent: '#ff3355', color_text: '#ffe8e8', color_text_dim: '#aa6666' },
  { id: 'void',        name: 'Void',        color_bg: '#050505', color_card: '#111111', color_accent: '#ffffff', color_text: '#f0f0f0', color_text_dim: '#888888' },
  { id: 'synthwave',   name: 'Synthwave',   color_bg: '#1a0a1f', color_card: '#2a1030', color_accent: '#ff2d95', color_text: '#ffd6f5', color_text_dim: '#b060a0' },
  { id: 'terminal',    name: 'Terminal',    color_bg: '#0a120a', color_card: '#0f1a0f', color_accent: '#00ff66', color_text: '#c8ffc8', color_text_dim: '#4a8a4a' },
  { id: 'amber_alert', name: 'Amber Alert', color_bg: '#110c00', color_card: '#1e1500', color_accent: '#f59e0b', color_text: '#fff8e1', color_text_dim: '#a07820' },
  { id: 'bloodmoon',   name: 'Bloodmoon',   color_bg: '#100004', color_card: '#1c0008', color_accent: '#ff0055', color_text: '#ffd0d8', color_text_dim: '#884455' },
  { id: 'arctic',      name: 'Arctic',      color_bg: '#040c14', color_card: '#0a1820', color_accent: '#60cdff', color_text: '#d0f4ff', color_text_dim: '#4080a0' },
  { id: 'operator',    name: 'Operator',    color_bg: '#080808', color_card: '#0f0f0f', color_accent: '#e8e8e8', color_text: '#ffffff', color_text_dim: '#606060' },
  { id: 'vaporwave',   name: 'Vaporwave',   color_bg: '#1b1033', color_card: '#271546', color_accent: '#f072c0', color_text: '#ffe0f7', color_text_dim: '#8a6aaa' },
  { id: 'kingpin',     name: 'Kingpin',     color_bg: '#0b0900', color_card: '#16120a', color_accent: '#ffd24a', color_text: '#fff6db', color_text_dim: '#9a8540' },
  { id: 'toxic',       name: 'Toxic',       color_bg: '#0a0f00', color_card: '#141c05', color_accent: '#b6ff1a', color_text: '#eaffc4', color_text_dim: '#7a9a3a' },
  { id: 'deepsea',     name: 'Deep Sea',    color_bg: '#02100f', color_card: '#06221f', color_accent: '#2affc6', color_text: '#d0fff4', color_text_dim: '#3a8a7a' },
  { id: 'ember',       name: 'Ember',       color_bg: '#140600', color_card: '#200d02', color_accent: '#ff6b1a', color_text: '#ffe6d2', color_text_dim: '#a05a2a' },
  { id: 'phantom',     name: 'Phantom',     color_bg: '#0c0c12', color_card: '#15151f', color_accent: '#9aa0c0', color_text: '#e6e8f5', color_text_dim: '#5a5e78' },
  { id: 'overclock',   name: 'Overclock',   color_bg: '#001014', color_card: '#02202a', color_accent: '#00e0ff', color_text: '#d6fbff', color_text_dim: '#3a8090' },
]

export function themeById(id: string | null | undefined): ThemePreset {
  return THEME_PRESETS.find(t => t.id === id) || THEME_PRESETS[0]
}

export function profileColors(p: Partial<PlayerProfile>) {
  const t = themeById(p.theme_preset)
  return {
    bg: p.color_bg || t.color_bg,
    card: p.color_card || t.color_card,
    accent: p.color_accent || t.color_accent,
    text: p.color_text || t.color_text,
    dim: p.color_text_dim || t.color_text_dim,
  }
}
