import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './schema'
import { createCard, deleteCard, saveCard } from './cards'
import type { Card, Category } from '../types'

const mk = (cat: Category, rank: number): Card => ({
  id: `${cat[0]}:${rank}`, category: cat, frequency_rank: rank, global_rank: rank,
  hanzi: String(rank), pinyin: '', english: '', examples: [],
})
const order = async (cat: Category) =>
  (await db.cards.where('category').equals(cat).filter((c) => !c.deleted).sortBy('frequency_rank')).map((c) => `${c.id}#${c.frequency_rank}`)

beforeEach(async () => {
  await db.cards.clear()
  await db.cards.bulkPut([1, 2, 3, 4].map((r) => mk('verb', r)).concat([1, 2].map((r) => mk('noun', r))))
})

describe('card CRUD keeps ranks 1..N', () => {
  it('moves a card up within its list', async () => {
    await saveCard({ ...(await db.cards.get('v:4'))!, frequency_rank: 1 })
    expect(await order('verb')).toEqual(['v:4#1', 'v:1#2', 'v:2#3', 'v:3#4'])
  })
  it('moves a card down within its list', async () => {
    await saveCard({ ...(await db.cards.get('v:1'))!, frequency_rank: 3 })
    expect(await order('verb')).toEqual(['v:2#1', 'v:3#2', 'v:1#3', 'v:4#4'])
  })
  it('changes category and re-ranks both lists', async () => {
    await saveCard({ ...(await db.cards.get('v:2'))!, category: 'noun', frequency_rank: 2 })
    expect(await order('verb')).toEqual(['v:1#1', 'v:3#2', 'v:4#3'])
    expect(await order('noun')).toEqual(['n:1#1', 'v:2#2', 'n:2#3'])
  })
  it('deletes and closes the gap; new cards append', async () => {
    await deleteCard('v:2')
    expect(await order('verb')).toEqual(['v:1#1', 'v:3#2', 'v:4#3'])
    const id = await createCard({ category: 'verb', frequency_rank: 0, hanzi: '跑', pinyin: 'pǎo', english: 'to run', examples: [] })
    expect((await order('verb')).at(-1)).toBe(`${id}#4`)
  })
})
