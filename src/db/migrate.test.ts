import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { expect, it } from 'vitest'
import { HanziDB } from './schema'

it('migrates v1 numeric review logs to v3 uuid reviews', async () => {
  const old = new Dexie('migrate-test')
  old.version(1).stores({ cards: 'id, category, [category+frequency_rank]', srs: 'key, cardId, category, [category+direction], status, due', logs: '++id, ts, cardId, category, direction', meta: 'key' })
  await old.table('logs').bulkAdd([
    { ts: 1, cardId: 'v:是', category: 'verb', direction: 'en-zh', grade: 'easy', correct: true, wasNew: true },
    { ts: 2, cardId: 'v:有', category: 'verb', direction: 'en-zh', grade: 'again', correct: false, wasNew: true },
  ])
  await old.table('srs').put({ key: 'v:是|en-zh', cardId: 'v:是' })
  old.close()

  const db = new HanziDB('migrate-test')
  const reviews = await db.reviews.orderBy('ts').toArray()
  expect(reviews.map((r) => r.cardId)).toEqual(['v:是', 'v:有'])
  expect(typeof reviews[0].id).toBe('string')
  expect(await db.srs.count()).toBe(1)
  expect(db.tables.map((t) => t.name)).not.toContain('logs')
  db.close()
})
