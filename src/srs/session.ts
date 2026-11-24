import type { Card, Direction, Grade, SrsState } from '../types'
import { isDue } from './scheduler'

export interface QueueItem {
  card: Card
  direction: Direction
  isNew: boolean
}

/**
 * Build the study queue for one list + direction:
 * due reviews first (most frequent first), then unseen cards in strict frequency order.
 * Less frequent words therefore only unlock once the frequent ones have been introduced.
 */
export function buildQueue(
  cards: Card[],
  states: Map<string, SrsState>,
  direction: Direction,
  now: number,
  newLimit: number,
): QueueItem[] {
  const sorted = cards.filter((c) => !c.deleted).sort((a, b) => a.frequency_rank - b.frequency_rank)
  const due: QueueItem[] = []
  const fresh: QueueItem[] = []
  for (const card of sorted) {
    const s = states.get(`${card.id}|${direction}`)
    if (!s || s.status === 'new') {
      if (fresh.length < newLimit) fresh.push({ card, direction, isNew: true })
    } else if (isDue(s, now)) due.push({ card, direction, isNew: false })
  }
  return [...due, ...fresh]
}

export const AGAIN_GAP = 3

/** In-session repetition: failed cards come back a few cards later until answered Hard/Easy. */
export class Session {
  queue: QueueItem[]
  private hardRequeued = new Set<string>()
  done = 0
  constructor(items: QueueItem[]) {
    this.queue = [...items]
  }
  get current(): QueueItem | undefined {
    return this.queue[0]
  }
  get remaining() {
    return this.queue.length
  }
  answer(g: Grade) {
    const item = this.queue.shift()
    if (!item) return
    const id = item.card.id
    if (g === 'again') {
      this.queue.splice(Math.min(AGAIN_GAP, this.queue.length), 0, { ...item, isNew: false })
    } else if (g === 'hard' && !this.hardRequeued.has(id)) {
      this.hardRequeued.add(id)
      this.queue.push({ ...item, isNew: false })
    } else {
      this.done++
    }
  }
  /** Replace the card object (after an edit) everywhere in the queue. */
  updateCard(card: Card) {
    this.queue = this.queue.map((q) => (q.card.id === card.id ? { ...q, card } : q))
  }
  remove(cardId: string) {
    this.queue = this.queue.filter((q) => q.card.id !== cardId)
  }
}
