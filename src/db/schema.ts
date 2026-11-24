import Dexie, { type EntityTable } from 'dexie'
import type { Card, CardOp, ReviewLog, SrsState, SyncKind } from '../types'

export interface MetaRow {
  key: string
  value: unknown
}

/** Records changed locally that still have to be pushed to the server. */
export interface OutboxRow {
  id: string // `${kind}|${key}`
  kind: SyncKind
  key: string
  v: number // bumped on every change, so a push only clears what it actually sent
}

export const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`

export class HanziDB extends Dexie {
  cards!: EntityTable<Card, 'id'>
  srs!: EntityTable<SrsState, 'key'>
  reviews!: EntityTable<ReviewLog, 'id'>
  cardops!: EntityTable<CardOp, 'id'>
  outbox!: EntityTable<OutboxRow, 'id'>
  meta!: EntityTable<MetaRow, 'key'>
  constructor(name = 'hanzilists') {
    super(name)
    this.version(1).stores({
      cards: 'id, category, [category+frequency_rank]',
      srs: 'key, cardId, category, [category+direction], status, due',
      logs: '++id, ts, cardId, category, direction',
      meta: 'key',
    })
    // v2: review logs get globally unique string ids (Dexie can't change a primary key in place)
    this.version(2)
      .stores({
        reviews: 'id, ts, cardId, category, direction',
        cardops: 'id, ts',
        outbox: 'id, kind',
      })
      .upgrade(async (tx) => {
        const old = await tx.table('logs').toArray()
        await tx.table('reviews').bulkPut(old.map(({ id: _n, ...l }) => ({ ...l, id: uuid() })))
      })
    this.version(3).stores({ logs: null })
  }
}

export const db = new HanziDB()

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return (row?.value as T) ?? fallback
}
export const setMeta = (key: string, value: unknown) => db.meta.put({ key, value })

let bump = 0
/** Queue a record for the next sync push. Call inside the same transaction as the write when possible. */
export const track = (kind: SyncKind, key: string) => db.outbox.put({ id: `${kind}|${key}`, kind, key, v: Date.now() * 1000 + (bump++ % 1000) })
