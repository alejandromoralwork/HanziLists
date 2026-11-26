/**
 * Rebuilds only public/data/phrase.json ("Phrases translation") from the published word lists, without
 * re-running the full dataset build, and bumps the manifest version so browsers load it.
 * Usage: npm run data:phrases   (npm run data also builds phrases)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { Card } from '../src/types.ts'
import { buildPhrases } from './phrases.ts'

const OUT = new URL('../public/data/', import.meta.url).pathname
const read = (cat: string): Card[] => JSON.parse(readFileSync(`${OUT}${cat}.json`, 'utf8'))

const phrases = buildPhrases(['noun', 'verb', 'adjective', 'other'].map(read))
writeFileSync(`${OUT}phrase.json`, JSON.stringify(phrases))
const manifest = JSON.parse(readFileSync(`${OUT}manifest.json`, 'utf8')) as { version: string; counts: Record<string, number> }
manifest.counts.phrase = phrases.length
manifest.version = new Date().toISOString().slice(0, 10) + '-' + Object.values(manifest.counts).reduce((a, b) => a + b, 0)
writeFileSync(`${OUT}manifest.json`, JSON.stringify(manifest, null, 2))
console.log({ phrases: phrases.length, version: manifest.version })
