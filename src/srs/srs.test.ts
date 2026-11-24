import { describe, expect, it } from 'vitest'
import { grade, newState, MASTERED_DAYS } from './scheduler'
import { buildQueue, Session } from './session'
import { coverage, streak } from './stats'
import { checkChinese, checkEnglish } from '../lib/answer'
import type { Card, SrsState } from '../types'
import { DAY, dayKey, startOfDay } from '../lib/time'

const card = (rank: number, extra: Partial<Card> = {}): Card => ({
  id: `v:${rank}`,
  category: 'verb',
  frequency_rank: rank,
  global_rank: rank,
  hanzi: '说',
  pinyin: 'shuō',
  english: 'to say; to speak',
  examples: [],
  ...extra,
})
const NOW = new Date('2026-11-24T10:00:00').getTime()

describe('scheduler', () => {
  it('easy on a brand-new card jumps 4 days', () => {
    const s = grade(newState(card(1), 'zh-en'), 'easy', NOW)
    expect(s.interval).toBe(4)
    expect(s.due).toBe(startOfDay(NOW) + 4 * DAY)
    expect(s.status).toBe('review')
  })
  it('again resets to learning and is due within the session', () => {
    let s = grade(newState(card(1), 'zh-en'), 'easy', NOW)
    s = grade(s, 'again', NOW + DAY * 4)
    expect(s.status).toBe('learning')
    expect(s.interval).toBe(0)
    expect(s.lapses).toBe(1)
    expect(s.due).toBeLessThan(NOW + DAY * 4 + 5 * 60_000)
  })
  it('hard grows more slowly than easy', () => {
    const base: SrsState = { ...newState(card(1), 'en-zh'), interval: 10, reps: 3, status: 'review' }
    expect(grade(base, 'hard', NOW).interval).toBeLessThan(grade(base, 'easy', NOW).interval)
  })
  it('reaches mastered after repeated easy answers', () => {
    let s = newState(card(1), 'en-zh')
    let t = NOW
    for (let i = 0; i < 6 && s.status !== 'mastered'; i++) {
      s = grade(s, 'easy', t)
      t = s.due
    }
    expect(s.interval).toBeGreaterThanOrEqual(MASTERED_DAYS)
    expect(s.status).toBe('mastered')
  })
  it('ease never drops below 1.3', () => {
    let s = newState(card(1), 'en-zh')
    for (let i = 0; i < 20; i++) s = grade(s, 'again', NOW)
    expect(s.ease).toBeCloseTo(1.3)
  })
})

describe('queue', () => {
  it('introduces new cards strictly by frequency rank, after due reviews', () => {
    const cards = [card(3), card(1), card(5), card(2), card(4)]
    const due = { ...newState(card(4), 'en-zh'), status: 'review' as const, due: NOW - 1 }
    const states = new Map([[due.key, due]])
    const q = buildQueue(cards, states, 'en-zh', NOW, 2)
    expect(q.map((i) => i.card.frequency_rank)).toEqual([4, 1, 2])
  })
  it('skips deleted cards and cards not yet due', () => {
    const later = { ...newState(card(1), 'en-zh'), status: 'review' as const, due: NOW + DAY }
    const q = buildQueue([card(1), card(2, { deleted: true }), card(3)], new Map([[later.key, later]]), 'en-zh', NOW, 10)
    expect(q.map((i) => i.card.frequency_rank)).toEqual([3])
  })
})

describe('session', () => {
  const items = [1, 2, 3, 4, 5].map((r) => ({ card: card(r), direction: 'en-zh' as const, isNew: true }))
  it('again brings the card back a few cards later until answered', () => {
    const s = new Session(items)
    s.answer('again')
    expect(s.queue.map((i) => i.card.frequency_rank)).toEqual([2, 3, 4, 1, 5])
    s.answer('easy'); s.answer('easy'); s.answer('easy')
    expect(s.current?.card.frequency_rank).toBe(1)
    s.answer('easy')
    expect(s.queue.map((i) => i.card.frequency_rank)).toEqual([5])
  })
  it('hard re-queues once at the end', () => {
    const s = new Session(items.slice(0, 2))
    s.answer('hard')
    expect(s.queue.map((i) => i.card.frequency_rank)).toEqual([2, 1])
    s.answer('easy')
    s.answer('hard')
    expect(s.remaining).toBe(0)
  })
})

describe('stats', () => {
  it('coverage counts the mastered prefix', () => {
    const cs = [1, 2, 3, 4].map((r) => card(r))
    expect(coverage(cs, (c) => c.frequency_rank !== 3)).toBe(2)
  })
  it('streak counts back from today or yesterday', () => {
    const days = new Set([dayKey(NOW - DAY), dayKey(NOW - 2 * DAY), dayKey(NOW - 4 * DAY)])
    expect(streak(days, NOW)).toBe(2)
    days.add(dayKey(NOW))
    expect(streak(days, NOW)).toBe(3)
  })
})

describe('answer checking', () => {
  it('accepts hanzi or pinyin with/without tones', () => {
    expect(checkChinese('说', '说', 'shuō')).toBe(true)
    expect(checkChinese('shuo1', '说', 'shuō')).toBe(true)
    expect(checkChinese('shuo', '说', 'shuō')).toBe(true)
    expect(checkChinese('nv3', '女', 'nǚ')).toBe(true)
    expect(checkChinese('shi', '说', 'shuō')).toBe(false)
    expect(checkChinese('zhong', '中', 'zhōng, zhòng')).toBe(true)
  })
  it('accepts any english gloss', () => {
    expect(checkEnglish('speak', 'to say; to speak')).toBe(true)
    expect(checkEnglish('To Say', 'to say; to speak')).toBe(true)
    expect(checkEnglish('run', 'to say; to speak')).toBe(false)
  })
})
