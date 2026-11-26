/**
 * "Phrases translation" list: every example sentence of the word lists (nouns, verbs, adjectives, others)
 * becomes its own card, to practise translating whole sentences in both directions.
 *  - Order: by the frequency of the word the sentence illustrates (most common first), so early phrases
 *    use the most common vocabulary.
 *  - Each sentence appears once (the first, i.e. most frequent, word that uses it wins).
 *  - The source word is kept as the card's only example ("key word"), shown as a hint.
 * Character examples are skipped: they are short words, not sentences.
 */
import type { Card } from '../src/types.ts'

export const PHRASE_LIMIT = 6000

/** Kind: function. Word lists → phrase cards, most useful first. */
export function buildPhrases(lists: Card[][], limit = PHRASE_LIMIT): Card[] {
  const sources = lists
    .flat()
    .filter((c) => c.category !== 'character' && c.category !== 'phrase' && !c.deleted)
    .sort((a, b) => a.global_rank - b.global_rank || a.frequency_rank - b.frequency_rank)
  const seen = new Set<string>()
  const out: Card[] = []
  for (const c of sources) {
    for (const ex of c.examples) {
      const hanzi = ex.hanzi.trim()
      if (!hanzi || !ex.english?.trim() || seen.has(hanzi)) continue
      seen.add(hanzi)
      out.push({
        id: `p:${hanzi}`,
        category: 'phrase',
        frequency_rank: out.length + 1,
        global_rank: c.global_rank,
        hanzi,
        pinyin: ex.pinyin,
        english: ex.english.trim(),
        examples: [{ hanzi: c.hanzi, pinyin: c.pinyin, english: c.english }],
        ...(c.hsk ? { hsk: c.hsk } : {}),
      })
      if (out.length >= limit) return out
    }
  }
  return out
}
