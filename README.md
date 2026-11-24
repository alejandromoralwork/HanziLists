# HanziLists

Learn Mandarin from frequency-ordered vocabulary lists with spaced repetition. Everything runs in the browser: the server only serves static files.

- **5 lists** ordered by real usage frequency (`frequency_rank` 1 = most common): Adjectives (1,296), Verbs (3,000), Nouns (4,000), Others (1,325) and Characters (3,000).
- **Study directions**:
  - English → Chinese (production) or Chinese → English (comprehension) for the four word lists.
  - Recognition only for Characters.
- **SRS**: Don't know / Hard / I know it buttons. Failed cards come back in the same session. New cards unlock strictly in frequency order (20 per list and direction per day by default).
- **Full editing**: change hanzi, pinyin, meaning, examples, rank or list, from the table or in the middle of a session. You can also add and delete cards. Ranks stay 1..N.
- **Dashboard**:
  - % mastered per list and globally.
  - Frequency coverage ("top 50 verbs mastered").
  - Cards due today and your study streak.
  - Accuracy for each direction.
- Progress is stored in IndexedDB. Use Settings → Export / Import backup to keep it safe or move it to another device.

## Stack
Vite + React + TypeScript + Tailwind CSS v4 + Dexie (IndexedDB). It is a static SPA with hash routing, served by Caddy at `/hanzi/`.

## Data
`npm run data` downloads the sources into `scripts/.cache/` and writes `public/data/*.json`.

| Source | Used for | License |
|---|---|---|
| [drkameleon/complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) | words, POS tags, frequency rank, pinyin, CC-CEDICT meanings | MIT |
| [ruddfawcett/hanziDB.csv](https://github.com/ruddfawcett/hanziDB.csv) | character frequency (Jun Da) | see repo |
| [Tatoeba](https://tatoeba.org) cmn/eng exports | example sentences | CC BY 2.0 FR |

How the lists are built:
- **Lists** come from each word's primary POS tag:
  - `a/ad/an/b/z` → Adjectives
  - `v/vd/vn` → Verbs
  - `n/ng/s/t` → Nouns
  - proper nouns are dropped
  - everything else → Others
- **Example sentences** are Tatoeba sentences segmented against the dictionary, so 人 does not match 人们. Traditional-script sentences are skipped, and sentences built from more frequent words are preferred. Sentence pinyin comes from `pinyin-pro`.
- **Hand-checked cards**: the top 15 cards of each list have checked glosses and examples, in [data/seed-overrides.json](data/seed-overrides.json).

If you publish new data, your edits survive. Cards you created, edited or deleted are never overwritten.

## Commands
```bash
npm run dev       # dev server at http://127.0.0.1:5173/hanzi/
npm test          # unit tests (scheduler, queue, stats, CRUD re-ranking)
npm run data      # rebuild public/data from sources
npm run deploy    # test + build + rsync dist/ to /srv/hanzi
npm run preview & npm run e2e   # browser smoke test (Playwright)
```
