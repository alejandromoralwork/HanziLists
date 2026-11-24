export type Category = 'adjective' | 'verb' | 'noun' | 'other' | 'character'
export type Direction = 'en-zh' | 'zh-en'
export type Grade = 'again' | 'hard' | 'easy'
export type Status = 'new' | 'learning' | 'review' | 'mastered'

export const CATEGORIES: { id: Category; label: string; zh: string }[] = [
  { id: 'adjective', label: 'Adjectives', zh: '形容词' },
  { id: 'verb', label: 'Verbs', zh: '动词' },
  { id: 'noun', label: 'Nouns', zh: '名词' },
  { id: 'other', label: 'Others', zh: '其他' },
  { id: 'character', label: 'Characters', zh: '汉字' },
]

export interface Example {
  hanzi: string
  pinyin: string
  english: string
}

export interface Card {
  id: string
  category: Category
  frequency_rank: number
  global_rank: number
  hanzi: string
  pinyin: string
  english: string
  examples: Example[]
  hsk?: string
  userEdited?: boolean
  userCreated?: boolean
  deleted?: boolean
}

export interface SrsState {
  key: string // `${cardId}|${direction}`
  cardId: string
  direction: Direction
  category: Category
  status: Status
  ease: number
  interval: number // days
  due: number // epoch ms
  reps: number
  lapses: number
  lastReviewed: number
}

export interface ReviewLog {
  id?: number
  ts: number
  cardId: string
  category: Category
  direction: Direction
  grade: Grade
  correct: boolean
  wasNew: boolean
}

export interface Settings {
  newPerDay: number
  showPinyin: boolean
  typeAnswer: boolean
}

export const DEFAULT_SETTINGS: Settings = { newPerDay: 20, showPinyin: true, typeAnswer: false }

export const directionsFor = (c: Category): Direction[] => (c === 'character' ? ['zh-en'] : ['en-zh', 'zh-en'])
