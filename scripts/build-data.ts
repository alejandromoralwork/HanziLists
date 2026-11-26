/**
 * Builds public/data/*.json from open datasets:
 *  - drkameleon/complete-hsk-vocabulary (MIT): words, POS tags, frequency rank
 *  - ruddfawcett/hanziDB.csv: characters ordered by Jun Da frequency
 *  - Tatoeba cmn/eng sentences + links (CC-BY 2.0 FR): example sentences
 * Then merges hand-checked overrides from data/seed-overrides.json.
 *
 * Usage: npm run data   (downloads into scripts/.cache on first run)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { bunzip2 } from './bunzip2.ts'
import { pinyin } from 'pinyin-pro'
import type { Card, Category, Example } from '../src/types.ts'
import { buildPhrases, PHRASE_LIMIT } from './phrases.ts'

const CACHE = new URL('./.cache/', import.meta.url).pathname
const OUT = new URL('../public/data/', import.meta.url).pathname
const OVERRIDES = new URL('../data/seed-overrides.json', import.meta.url).pathname

const LIMITS: Record<Category, number> = { adjective: 1500, verb: 3000, noun: 4000, other: 1500, character: 3000, phrase: PHRASE_LIMIT }

const SOURCES: Record<string, string> = {
  'complete.min.json': 'https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.min.json',
  'hanziDB.csv': 'https://raw.githubusercontent.com/ruddfawcett/hanziDB.csv/master/data/hanziDB.csv',
  'cmn_sentences.tsv': 'https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2',
  'eng_sentences.tsv': 'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2',
  'cmn-eng_links.tsv': 'https://downloads.tatoeba.org/exports/per_language/cmn/cmn-eng_links.tsv.bz2',
}

async function ensureSources() {
  mkdirSync(CACHE, { recursive: true })
  for (const [name, url] of Object.entries(SOURCES)) {
    if (existsSync(CACHE + name)) continue
    console.log('downloading', url)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    let buf: Buffer = Buffer.from(await res.arrayBuffer())
    if (url.endsWith('.bz2')) buf = bunzip2(buf)
    writeFileSync(CACHE + name, buf)
  }
}

// ---------- POS → category ----------
const ADJ = new Set(['a', 'ad', 'an', 'b', 'z'])
const VERB = new Set(['v', 'vd', 'vn'])
const NOUN = new Set(['n', 'ng', 's', 't', 'tg'])
const PROPER = new Set(['nr', 'ns', 'nz', 'nt'])

function categoryOf(tags: string[]): Category | null {
  const t = tags[0]
  if (!t || PROPER.has(t)) return null
  if (ADJ.has(t)) return 'adjective'
  if (VERB.has(t)) return 'verb'
  if (NOUN.has(t)) return 'noun'
  return 'other'
}

interface RawWord {
  s: string
  q: number
  p: string[]
  l: string[]
  f: { t: string; i: { y: string }; m: string[] }[]
}

const hskOf = (levels: string[]) => {
  const n = levels.find((l) => l.startsWith('n'))
  return n ? `HSK ${n.slice(1)}` : undefined
}

const JUNK = /^(variant of|old variant|surname|see |used in|abbr\. for|\(archaic\)|\(old\))/i
const cleanMeaning = (ms: string[]) =>
  ms
    .filter((m) => !JUNK.test(m))
    .slice(0, 3)
    .join('; ') || ms[0] || ''

const toneless = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '').toLowerCase()

/** Pick the reading a learner should see first: not a surname/variant, preferably the most common pronunciation. */
function bestForm(w: RawWord) {
  const common = (pinyin(w.s, { toneType: 'symbol' }) as string).replace(/\s+/g, '').toLowerCase()
  const useful = w.f.filter((f) => f.i.y[0] === f.i.y[0].toLowerCase() && f.m.some((m) => !JUNK.test(m)))
  const pool = useful.length ? useful : w.f
  return (
    pool.find((f) => f.i.y.replace(/\s+/g, '').toLowerCase() === common) ??
    pool.find((f) => toneless(f.i.y) === toneless(common)) ??
    pool[0]
  )
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    const cells: string[] = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (ch === '"') q = false
        else cur += ch
      } else if (ch === '"') q = true
      else if (ch === ',') { cells.push(cur); cur = '' }
      else cur += ch
    }
    cells.push(cur)
    rows.push(cells)
  }
  return rows
}

const isHan = (ch: string) => /\p{Script=Han}/u.test(ch)

async function main() {
  await ensureSources()

  // ---------- words ----------
  const raw: RawWord[] = JSON.parse(readFileSync(CACHE + 'complete.min.json', 'utf8'))
  const wordRank = new Map<string, number>()
  for (const w of raw) wordRank.set(w.s, Math.min(w.q, wordRank.get(w.s) ?? Infinity))

  const buckets: Record<Category, Card[]> = { adjective: [], verb: [], noun: [], other: [], character: [], phrase: [] }
  const seen = new Set<string>()
  for (const w of [...raw].sort((a, b) => a.q - b.q || a.s.length - b.s.length || a.s.localeCompare(b.s))) {
    const cat = categoryOf(w.p)
    if (!cat || !w.f?.length) continue
    const id = `${cat[0]}:${w.s}`
    if (seen.has(id)) continue
    seen.add(id)
    const form = bestForm(w)
    buckets[cat].push({
      id,
      category: cat,
      frequency_rank: 0,
      global_rank: w.q,
      hanzi: w.s,
      pinyin: form.i.y,
      english: cleanMeaning(form.m),
      examples: [],
      hsk: hskOf(w.l),
    })
  }

  // ---------- characters ----------
  const rows = parseCsv(readFileSync(CACHE + 'hanziDB.csv', 'utf8')).slice(1)
  const simplified = new Set<string>()
  for (const r of rows) simplified.add(r[1])
  for (const w of raw) for (const ch of w.s) simplified.add(ch)
  const seenChar = new Set<string>()
  for (const r of rows) {
    const [rank, ch, py, def, , , , hsk] = r
    if (!ch || seenChar.has(ch)) continue // the source CSV repeats its first 100 rows
    seenChar.add(ch)
    buckets.character.push({
      id: `c:${ch}`,
      category: 'character',
      frequency_rank: 0,
      global_rank: Number(rank),
      hanzi: ch,
      pinyin: py.replace(/,\s*/g, ', '),
      english: def,
      examples: [],
      hsk: hsk ? `HSK ${hsk}` : undefined,
    })
  }

  for (const cat of Object.keys(buckets) as Category[]) {
    buckets[cat] = buckets[cat].slice(0, LIMITS[cat])
    buckets[cat].forEach((c, i) => (c.frequency_rank = i + 1))
  }

  // ---------- sentences ----------
  const eng = new Map<number, string>()
  const links = new Map<number, number[]>()
  for (const line of readFileSync(CACHE + 'cmn-eng_links.tsv', 'utf8').split('\n')) {
    const [a, b] = line.split('\t').map(Number)
    if (!a || !b) continue
    if (!links.has(a)) links.set(a, [])
    links.get(a)!.push(b)
  }
  const needEng = new Set<number>()
  for (const v of links.values()) for (const id of v) needEng.add(id)
  for (const line of readFileSync(CACHE + 'eng_sentences.tsv', 'utf8').split('\n')) {
    const t1 = line.indexOf('\t')
    const id = Number(line.slice(0, t1))
    if (needEng.has(id)) eng.set(id, line.slice(line.indexOf('\t', t1 + 1) + 1))
  }

  const dict = new Set(wordRank.keys())
  const MAXLEN = 4
  const segment = (s: string): string[] => {
    const out: string[] = []
    for (let i = 0; i < s.length; ) {
      let tok = s[i]
      for (let L = Math.min(MAXLEN, s.length - i); L > 1; L--) {
        const sub = s.slice(i, i + L)
        if (dict.has(sub)) { tok = sub; break }
      }
      out.push(tok)
      i += tok.length
    }
    return out
  }

  interface Sent { zh: string; en: string; tokens: string[]; score: number }
  const byWord = new Map<string, Sent[]>()
  const byChar = new Map<string, Sent[]>()
  for (const line of readFileSync(CACHE + 'cmn_sentences.tsv', 'utf8').split('\n')) {
    const [idS, , zh] = line.split('\t')
    if (!zh) continue
    const engIds = links.get(Number(idS))
    if (!engIds) continue
    const en = engIds.map((i) => eng.get(i)).filter(Boolean).sort((a, b) => a!.length - b!.length)[0]
    if (!en) continue
    const han = [...zh].filter(isHan)
    if (han.length < 4 || han.length > 18) continue
    if (han.some((c) => !simplified.has(c))) continue // drop traditional-script sentences
    if (/[a-zA-Z0-9]/.test(zh)) continue
    const tokens = segment(zh)
    // difficulty = rarest word used (lower is easier) + small length penalty
    const ranks = tokens.filter((t) => isHan(t[0])).map((t) => wordRank.get(t) ?? 30000)
    const score = Math.max(...ranks) + han.length * 40
    const s: Sent = { zh, en, tokens, score }
    for (const t of new Set(tokens)) {
      if (!byWord.has(t)) byWord.set(t, [])
      byWord.get(t)!.push(s)
    }
    for (const ch of new Set(han)) {
      if (!byChar.has(ch)) byChar.set(ch, [])
      byChar.get(ch)!.push(s)
    }
  }

  const toExample = (s: Sent): Example => {
    const py = pinyin(s.zh, { type: 'all', toneType: 'symbol' }) as { origin: string; pinyin: string; isZh: boolean }[]
    let i = 0
    const parts: string[] = []
    for (const tok of s.tokens) {
      const seg = py.slice(i, i + tok.length)
      i += tok.length
      if (!isHan(tok[0])) {
        const p = tok.replace(/[，、]/g, ',').replace(/[。]/g, '.').replace(/[？]/g, '?').replace(/[！]/g, '!').replace(/[：]/g, ':').replace(/[；]/g, ';').replace(/[“”「」]/g, '"')
        if (parts.length) parts[parts.length - 1] += p
        else parts.push(p)
      } else parts.push(seg.map((x) => x.pinyin).join(''))
    }
    let out = parts.join(' ').replace(/\s+([,.?!:;])/g, '$1').trim()
    out = out.charAt(0).toUpperCase() + out.slice(1)
    return { hanzi: s.zh, pinyin: out, english: s.en }
  }

  const pick = (list: Sent[] | undefined) => {
    if (!list) return []
    const sorted = [...list].sort((a, b) => a.score - b.score)
    const chosen: Sent[] = []
    for (const s of sorted) {
      if (chosen.some((c) => c.en === s.en || c.zh.slice(0, 3) === s.zh.slice(0, 3))) continue
      chosen.push(s)
      if (chosen.length === 3) break
    }
    return chosen.map(toExample)
  }

  // ---------- overrides ----------
  const overrides: Record<string, Partial<Card>> = existsSync(OVERRIDES) ? JSON.parse(readFileSync(OVERRIDES, 'utf8')) : {}
  let missing = 0
  for (const cat of Object.keys(buckets) as Category[]) {
    for (const c of buckets[cat]) {
      const o = overrides[c.id]
      if (o) Object.assign(c, o, { id: c.id, category: c.category, frequency_rank: c.frequency_rank })
      if (!o?.examples) c.examples = cat === 'character' ? pick(byWord.get(c.hanzi) ?? byChar.get(c.hanzi)) : pick(byWord.get(c.hanzi))
      if (c.examples.length === 0) missing++
      if (!c.hsk) delete c.hsk
    }
  }

  // ---------- phrases (built from the word lists' examples, after overrides) ----------
  buckets.phrase = buildPhrases((['noun', 'verb', 'adjective', 'other'] as const).map((c) => buckets[c]))

  // ---------- write ----------
  mkdirSync(OUT, { recursive: true })
  const counts: Record<string, number> = {}
  for (const cat of Object.keys(buckets) as Category[]) {
    writeFileSync(OUT + `${cat}.json`, JSON.stringify(buckets[cat]))
    counts[cat] = buckets[cat].length
  }
  const version = new Date().toISOString().slice(0, 10) + '-' + Object.values(counts).reduce((a, b) => a + b, 0)
  writeFileSync(OUT + 'manifest.json', JSON.stringify({ version, counts }, null, 2))
  console.log({ version, counts, cardsWithoutExamples: missing })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
