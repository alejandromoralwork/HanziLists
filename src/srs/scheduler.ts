import type { Card, Direction, Grade, SrsState } from '../types'
import { DAY, MIN, startOfDay } from '../lib/time'

export const MASTERED_DAYS = 21
export const MIN_EASE = 1.3

export const srsKey = (cardId: string, dir: Direction) => `${cardId}|${dir}`

export function newState(card: Pick<Card, 'id' | 'category'>, direction: Direction): SrsState {
  return {
    key: srsKey(card.id, direction),
    cardId: card.id,
    direction,
    category: card.category,
    status: 'new',
    ease: 2.5,
    interval: 0,
    due: 0,
    reps: 0,
    lapses: 0,
    lastReviewed: 0,
  }
}

/**
 * Simplified SM-2 with three buttons.
 *  again → back to learning, interval reset, due in 1 minute (also re-queued in the session)
 *  hard  → small step (×1.2, at least 1 day), ease −0.15
 *  easy  → full step (×ease); a brand-new card you already know jumps straight to 4 days
 * A card is "mastered" once its interval reaches 21 days.
 */
export function grade(prev: SrsState, g: Grade, now: number): SrsState {
  const s = { ...prev, reps: prev.reps + 1, lastReviewed: now }
  if (g === 'again') {
    if (prev.status === 'review' || prev.status === 'mastered') s.lapses++
    s.ease = Math.max(MIN_EASE, prev.ease - 0.2)
    s.interval = 0
    s.status = 'learning'
    s.due = now + MIN
    return s
  }
  if (g === 'hard') {
    s.ease = Math.max(MIN_EASE, prev.ease - 0.15)
    s.interval = prev.interval < 1 ? 1 : Math.max(prev.interval + 1, Math.round(prev.interval * 1.2))
  } else {
    s.ease = prev.ease + 0.05
    if (prev.interval < 1) s.interval = prev.reps === 0 ? 4 : 1
    else s.interval = Math.max(prev.interval + 1, Math.round(prev.interval * prev.ease))
  }
  s.status = s.interval >= MASTERED_DAYS ? 'mastered' : s.interval >= 1 && s.reps >= 2 ? 'review' : 'learning'
  if (prev.reps === 0 && g === 'easy') s.status = 'review'
  // due at the start of the target day, so "due today" is stable through the day
  s.due = startOfDay(now) + s.interval * DAY
  return s
}

export const isDue = (s: SrsState, now: number) => s.status !== 'new' && s.due <= now
