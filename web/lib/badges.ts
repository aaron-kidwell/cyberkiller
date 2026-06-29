import { PlayerProfile } from './profile'

// Badges are DERIVED from a player's real stats (rank, kills, points, crowns,
// streak) at render time. No backend award-tracking, no DB writes: the profile
// data the API already returns is the source of truth, so a badge appears the
// moment the stat crosses its threshold and disappears if it ever drops.
//
// Each badge has a stable `id` (used for hide/show preferences) separate from its
// display `label` (which can be dynamic, e.g. "3× THRONE").
export type Badge = { id: string; label: string; glyph: string; hint: string }

// Every badge that can exist, with what it means. Drives the editor's selector
// (so players see the full set and how to earn each) and the meanings shown there.
export const BADGE_CATALOG: { id: string; glyph: string; label: string; meaning: string }[] = [
  { id: 'champion',    glyph: '♛', label: 'CHAMPION',     meaning: 'Ranked #1 on the leaderboard' },
  { id: 'podium',      glyph: '◈', label: 'PODIUM',       meaning: 'Ranked #2 or #3' },
  { id: 'throne',      glyph: '♚', label: 'THRONE',       meaning: 'Held a KOTH hill (badge shows your crown count)' },
  { id: 'firstblood',  glyph: '🩸', label: 'FIRST BLOOD',  meaning: 'Landed the first capture on a machine before anyone else (badge shows your count)' },
  { id: 'legend',      glyph: '★', label: 'LEGEND',       meaning: '10,000+ points' },
  { id: 'ascendant',   glyph: '▲', label: 'ASCENDANT',    meaning: '5,000+ points' },
  { id: 'operative',   glyph: '◆', label: 'OPERATIVE',    meaning: '1,000+ points' },
  { id: 'executioner', glyph: '☠', label: 'EXECUTIONER',  meaning: '100+ kills' },
  { id: 'veteran',     glyph: '⚔', label: 'VETERAN',      meaning: '25+ kills' },
  { id: 'blooded',     glyph: '✶', label: 'BLOODED',      meaning: '5+ kills' },
  { id: 'streak7',     glyph: '🔥', label: '7-DAY STREAK',  meaning: '7+ day login streak' },
  { id: 'streak30',    glyph: '🔥', label: '30-DAY STREAK', meaning: '30+ day login streak' },
]

export function deriveBadges(p: PlayerProfile): Badge[] {
  const out: Badge[] = []
  const rank = p.rank ?? 0
  const kills = p.kills ?? 0
  const pts = p.points ?? 0
  const crowns = p.koth_crowns ?? 0
  const firstBloods = p.first_bloods ?? 0
  const streak = p.login_streak_max ?? p.login_streak ?? 0

  if (rank === 1) out.push({ id: 'champion', label: 'CHAMPION', glyph: '♛', hint: 'Ranked #1 on the leaderboard' })
  else if (rank >= 2 && rank <= 3) out.push({ id: 'podium', label: 'PODIUM', glyph: '◈', hint: `Ranked #${rank}` })

  if (crowns >= 1) out.push({ id: 'throne', label: crowns > 1 ? `${crowns}× THRONE` : 'THRONE', glyph: '♚', hint: `Held a hill ${crowns} time(s)` })

  if (firstBloods >= 1) out.push({ id: 'firstblood', label: firstBloods > 1 ? `${firstBloods}× FIRST BLOOD` : 'FIRST BLOOD', glyph: '🩸', hint: `First to capture on ${firstBloods} machine(s)` })

  if (pts >= 10000) out.push({ id: 'legend', label: 'LEGEND', glyph: '★', hint: '10,000+ points' })
  else if (pts >= 5000) out.push({ id: 'ascendant', label: 'ASCENDANT', glyph: '▲', hint: '5,000+ points' })
  else if (pts >= 1000) out.push({ id: 'operative', label: 'OPERATIVE', glyph: '◆', hint: '1,000+ points' })

  if (kills >= 100) out.push({ id: 'executioner', label: 'EXECUTIONER', glyph: '☠', hint: '100+ kills' })
  else if (kills >= 25) out.push({ id: 'veteran', label: 'VETERAN', glyph: '⚔', hint: '25+ kills' })
  else if (kills >= 5) out.push({ id: 'blooded', label: 'BLOODED', glyph: '✶', hint: '5+ kills' })

  if (streak >= 30) out.push({ id: 'streak30', label: '30-DAY STREAK', glyph: '🔥', hint: '30+ day streak' })
  else if (streak >= 7) out.push({ id: 'streak7', label: '7-DAY STREAK', glyph: '🔥', hint: '7+ day streak' })

  return out
}

// Parse the comma-separated hidden-id list a player saved.
export function hiddenBadgeIds(p: PlayerProfile): Set<string> {
  return new Set((p.badges_hidden || '').split(',').map(s => s.trim()).filter(Boolean))
}

// Earned badges minus the ones the player chose to hide. This is what profiles render.
export function visibleBadges(p: PlayerProfile): Badge[] {
  const hidden = hiddenBadgeIds(p)
  return deriveBadges(p).filter(b => !hidden.has(b.id))
}
