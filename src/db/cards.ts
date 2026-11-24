import type { Card, Category } from '../types'
import { db, setMeta } from './schema'

/** Shift ranks in a category: every live card with rank >= from moves by delta. */
async function shift(category: Category, from: number, delta: number, exceptId?: string) {
  await db.cards
    .where('[category+frequency_rank]')
    .between([category, from], [category, Infinity])
    .modify((c) => {
      if (c.id !== exceptId) c.frequency_rank += delta
    })
}

export async function lastRank(category: Category) {
  const last = await db.cards.where('[category+frequency_rank]').between([category, 1], [category, Infinity]).last()
  return last?.frequency_rank ?? 0
}

/**
 * Save an edited card. If its category or frequency rank changed, the card is
 * moved and both lists are re-ranked so ranks stay 1..N without gaps or ties.
 */
export async function saveCard(next: Card) {
  await db.transaction('rw', db.cards, db.srs, db.meta, async () => {
    const prev = await db.cards.get(next.id)
    const max = (await lastRank(next.category)) + (prev && prev.category === next.category ? 0 : 1)
    const rank = Math.max(1, Math.min(Math.round(next.frequency_rank) || max, max))
    if (prev && (prev.category !== next.category || prev.frequency_rank !== rank)) {
      await shift(prev.category, prev.frequency_rank + 1, -1, prev.id)
      await shift(next.category, rank, +1, prev.id)
      await setMeta('reordered', true)
      if (prev.category !== next.category) await db.srs.where('cardId').equals(next.id).modify({ category: next.category })
    } else if (!prev) {
      await shift(next.category, rank, +1)
      if (rank <= max - 1) await setMeta('reordered', true)
    }
    await db.cards.put({ ...next, frequency_rank: rank, userEdited: prev ? true : next.userEdited, userCreated: prev ? prev.userCreated : true })
  })
}

export async function createCard(partial: Omit<Card, 'id' | 'global_rank'>) {
  const id = `u:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  await saveCard({ ...partial, id, global_rank: 0, userCreated: true })
  return id
}

/** Soft delete (so dataset refreshes don't bring it back) and close the rank gap. */
export async function deleteCard(id: string) {
  await db.transaction('rw', db.cards, db.srs, db.meta, async () => {
    const c = await db.cards.get(id)
    if (!c || c.deleted) return
    await db.cards.update(id, { deleted: true, frequency_rank: -1 })
    await shift(c.category, c.frequency_rank + 1, -1, id)
    await db.srs.where('cardId').equals(id).delete()
    await setMeta('reordered', true)
  })
}
