import { describe, expect, it } from 'vitest'
import { buildPhrases } from '../../scripts/phrases'
import type { Card } from '../types'
import { checkChineseSentence, checkEnglishSentence } from './answer'

const card = (id: string, category: Card['category'], global_rank: number, examples: Card['examples'], extra: Partial<Card> = {}): Card => ({
  id, category, frequency_rank: 1, global_rank, hanzi: id.slice(2), pinyin: 'p', english: 'e', examples, ...extra,
})
const ex = (hanzi: string, english = 'x') => ({ hanzi, pinyin: 'py', english })

describe('buildPhrases', () => {
  it('orders by word frequency, dedupes sentences, keeps the source word as key word, skips characters', () => {
    const lists = [
      [card('n:人', 'noun', 19, [ex('他是好人。', 'He is a good person.'), ex('我是学生。')])],
      [card('v:是', 'verb', 4, [ex('我是学生。', 'I am a student.')], { hsk: 'HSK 1' })],
      [card('c:的', 'character', 1, [ex('我的')])],
      [card('a:好', 'adjective', 20, [ex(''), ex('好。', '')]), card('o:x', 'other', 2, [ex('删。')], { deleted: true })],
    ]
    const out = buildPhrases(lists)
    expect(out.map((p) => p.hanzi)).toEqual(['我是学生。', '他是好人。'])
    expect(out[0]).toMatchObject({ id: 'p:我是学生。', category: 'phrase', frequency_rank: 1, english: 'I am a student.', hsk: 'HSK 1' })
    expect(out[0].examples).toEqual([{ hanzi: '是', pinyin: 'p', english: 'e' }])
    expect(out[1].frequency_rank).toBe(2)
  })
  it('respects the limit', () => {
    expect(buildPhrases([[card('n:a', 'noun', 1, [ex('一。'), ex('二。'), ex('三。')])]], 2)).toHaveLength(2)
  })
})

describe('sentence answers', () => {
  it('Chinese: hanzi or whole pinyin, punctuation and tones optional', () => {
    expect(checkChineseSentence('我是学生', '我是学生。', 'Wǒ shì xuésheng.')).toBe(true)
    expect(checkChineseSentence('wo shi xuesheng', '我是学生。', 'Wǒ shì xuésheng.')).toBe(true)
    expect(checkChineseSentence('我是老师', '我是学生。', 'Wǒ shì xuésheng.')).toBe(false)
    expect(checkChineseSentence('', '我是学生。', 'Wǒ shì xuésheng.')).toBe(false)
  })
  it('English: whole sentence, case and punctuation ignored (commas do not split it)', () => {
    expect(checkEnglishSentence('doctor my stomach hurts', 'Doctor, my stomach hurts.')).toBe(true)
    expect(checkEnglishSentence('doctor', 'Doctor, my stomach hurts.')).toBe(false)
  })
})
