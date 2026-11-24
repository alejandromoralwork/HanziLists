import Dexie, { type EntityTable } from 'dexie'
import type { Card, ReviewLog, SrsState } from '../types'

export interface MetaRow {
  key: string
  value: unknown
}

export class HanziDB extends Dexie {
  cards!: EntityTable<Card, 'id'>
  srs!: EntityTable<SrsState, 'key'>
  logs!: EntityTable<ReviewLog, 'id'>
  meta!: EntityTable<MetaRow, 'key'>
  constructor(name = 'hanzilists') {
    super(name)
    this.version(1).stores({
      cards: 'id, category, [category+frequency_rank]',
      srs: 'key, cardId, category, [category+direction], status, due',
      logs: '++id, ts, cardId, category, direction',
      meta: 'key',
    })
  }
}

export const db = new HanziDB()

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return (row?.value as T) ?? fallback
}
export const setMeta = (key: string, value: unknown) => db.meta.put({ key, value })
