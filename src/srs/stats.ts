import type { Card, ReviewLog, SrsState, Status } from '../types'
import { DAY, dayKey } from '../lib/time'

const ORDER: Record<Status, number> = { new: 0, learning: 1, review: 2, mastered: 3 }

/** A card's overall status is the best status across its study directions. */
export function cardStatus(cardId: string, statesByCard: Map<string, SrsState[]>): Status {
  const list = statesByCard.get(cardId)
  if (!list?.length) return 'new'
  return list.reduce<Status>((best, s) => (ORDER[s.status] > ORDER[best] ? s.status : best), 'new')
}

/** Largest N such that ranks 1..N (in list order) are all mastered. */
export function coverage(cardsByRank: Card[], isMastered: (c: Card) => boolean): number {
  let n = 0
  for (const c of cardsByRank) {
    if (!isMastered(c)) break
    n++
  }
  return n
}

/** Consecutive study days ending today (or yesterday, if not studied yet today). */
export function streak(days: Set<string>, now: number): number {
  let t = now
  if (!days.has(dayKey(t))) t -= DAY
  let n = 0
  while (days.has(dayKey(t))) {
    n++
    t -= DAY
  }
  return n
}

export function accuracy(logs: ReviewLog[]) {
  const out = { 'en-zh': { total: 0, correct: 0 }, 'zh-en': { total: 0, correct: 0 } }
  for (const l of logs) {
    out[l.direction].total++
    if (l.correct) out[l.direction].correct++
  }
  return out
}

export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
