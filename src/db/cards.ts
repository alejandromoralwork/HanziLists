import type { Card, CardOp, Category } from '../types'
import { db, setMeta, track, uuid } from './schema'
import { scheduleSync } from '../sync/sync'

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

// ---------------------------------------------------------------- user-facing, synced edits
// Edits are stored as operations and replayed in time order on other devices, so
// re-ranking (which touches many cards) stays consistent everywhere.

async function record(op: CardOp) {
  await db.transaction('rw', db.cardops, db.outbox, async () => {
    await db.cardops.put(op)
    await track('cardop', op.id)
  })
  scheduleSync()
}

/** Edit an existing card (or create one with a known id). */
export async function editCard(card: Card) {
  await saveCard(card)
  const saved = (await db.cards.get(card.id))!
  await record({ id: uuid(), ts: Date.now(), type: 'save', card: saved })
}

export async function addCard(partial: Omit<Card, 'id' | 'global_rank'>) {
  const id = `u:${uuid()}`
  await editCard({ ...partial, id, global_rank: 0, userCreated: true })
  return id
}

export async function removeCard(id: string) {
  await deleteCard(id)
  await record({ id: uuid(), ts: Date.now(), type: 'delete', cardId: id })
}

/** Apply an operation that came from another device. */
export async function applyCardOp(op: CardOp) {
  if (op.type === 'delete') await deleteCard(op.cardId)
  else {
    const prev = await db.cards.get(op.card.id)
    await saveCard({ ...op.card, deleted: false })
    // saveCard marks pre-existing cards as edited; keep flags as they were on the source device
    await db.cards.update(op.card.id, { userEdited: op.card.userEdited || !!prev, userCreated: op.card.userCreated })
  }
}
