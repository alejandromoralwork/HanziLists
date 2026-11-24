import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { CATEGORIES, type Card, type Category, type ReviewLog, type SrsState } from '../types'
import { accuracy, cardStatus, coverage, pct, streak } from '../srs/stats'
import { dayKey, endOfDay } from '../lib/time'
import { Bar } from '../components/ui'

interface CatStats {
  total: number
  mastered: number
  learning: number
  seen: number
  dueToday: number
  coverage: number
}

const MILESTONES = [10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 4000]

function summarize(cards: Card[], srs: SrsState[], now: number) {
  const byCard = new Map<string, SrsState[]>()
  for (const s of srs) {
    if (!byCard.has(s.cardId)) byCard.set(s.cardId, [])
    byCard.get(s.cardId)!.push(s)
  }
  const eod = endOfDay(now)
  const out = {} as Record<Category, CatStats>
  for (const { id } of CATEGORIES) {
    const list = cards.filter((c) => c.category === id && !c.deleted).sort((a, b) => a.frequency_rank - b.frequency_rank)
    let mastered = 0
    let learning = 0
    let seen = 0
    for (const c of list) {
      const st = cardStatus(c.id, byCard)
      if (st === 'mastered') mastered++
      else if (st !== 'new') learning++
      if (st !== 'new') seen++
    }
    out[id] = {
      total: list.length,
      mastered,
      learning,
      seen,
      dueToday: srs.filter((s) => s.category === id && s.status !== 'new' && s.due <= eod).length,
      coverage: coverage(list, (c) => cardStatus(c.id, byCard) === 'mastered'),
    }
  }
  return out
}

export function Dashboard() {
  const cards = useLiveQuery(() => db.cards.toArray(), [])
  const srs = useLiveQuery(() => db.srs.toArray(), [])
  const logs = useLiveQuery(() => db.logs.toArray(), [])
  const [tab, setTab] = useState<Category | 'all'>('all')
  const now = Date.now()

  const stats = useMemo(() => (cards && srs ? summarize(cards, srs, now) : null), [cards, srs])
  if (!stats || !logs) return <p className="py-20 text-center text-ink-3">Loading…</p>

  const days = new Set(logs.map((l) => dayKey(l.ts)))
  const today = dayKey(now)
  const todayLogs = logs.filter((l) => dayKey(l.ts) === today)
  const filteredLogs: ReviewLog[] = tab === 'all' ? logs : logs.filter((l) => l.category === tab)
  const acc = accuracy(filteredLogs)

  const agg: CatStats =
    tab === 'all'
      ? Object.values(stats).reduce(
          (a, s) => ({
            total: a.total + s.total,
            mastered: a.mastered + s.mastered,
            learning: a.learning + s.learning,
            seen: a.seen + s.seen,
            dueToday: a.dueToday + s.dueToday,
            coverage: 0,
          }),
          { total: 0, mastered: 0, learning: 0, seen: 0, dueToday: 0, coverage: 0 },
        )
      : stats[tab]

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Due today" value={agg.dueToday} hint={agg.dueToday ? 'reviews waiting' : 'all caught up'} />
        <Tile label="Streak" value={`${streak(days, now)}d`} hint={`${todayLogs.length} reviews today`} />
        <Tile label="Mastered" value={`${pct(agg.mastered, agg.total)}%`} hint={`${agg.mastered.toLocaleString()} of ${agg.total.toLocaleString()}`} />
        <Tile label="In progress" value={agg.learning.toLocaleString()} hint={`${agg.seen.toLocaleString()} seen so far`} />
      </section>

      <div className="flex flex-wrap gap-1 border-b border-line">
        {(['all', ...CATEGORIES.map((c) => c.id)] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}
          >
            {t === 'all' ? 'All lists' : CATEGORIES.find((c) => c.id === t)!.label}
          </button>
        ))}
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        <AccuracyCard label="English → Chinese" sub="production" a={acc['en-zh']} />
        <AccuracyCard label="Chinese → English" sub="comprehension" a={acc['zh-en']} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-3">Lists</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.filter((c) => tab === 'all' || c.id === tab).map((c) => {
            const s = stats[c.id]
            const nextMilestone = MILESTONES.find((m) => m > s.coverage && m <= s.total)
            return (
              <div key={c.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-semibold">
                    {c.label} <span className="han ml-1 text-sm font-normal text-ink-3">{c.zh}</span>
                  </h3>
                  <span className="text-xs text-ink-3 tabular-nums">{s.total.toLocaleString()} cards</span>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Bar value={pct(s.mastered, s.total)} />
                  <span className="w-10 text-right text-sm tabular-nums">{pct(s.mastered, s.total)}%</span>
                </div>
                <p className="mt-3 text-sm text-ink-2">
                  {s.coverage > 0 ? (
                    <>
                      You've mastered the <strong>top {s.coverage}</strong> most frequent {c.label.toLowerCase()}.
                    </>
                  ) : (
                    <>Master #1 to start your frequency coverage.</>
                  )}
                  {nextMilestone && <span className="text-ink-3"> Next goal: top {nextMilestone}.</span>}
                </p>
                <div className="mt-2 flex gap-4 text-xs text-ink-3 tabular-nums">
                  <span>{s.dueToday} due</span>
                  <span>{s.learning} learning</span>
                  <span>{s.mastered} mastered</span>
                </div>
                <div className="mt-4 flex gap-2">
                  <a href={`#/study/${c.id}`} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90">
                    Study
                  </a>
                  <a href={`#/list/${c.id}`} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
                    Browse
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-ink-3">{hint}</div>
    </div>
  )
}

function AccuracyCard({ label, sub, a }: { label: string; sub: string; a: { total: number; correct: number } }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">
          {label} <span className="font-normal text-ink-3">· {sub}</span>
        </span>
        <span className="text-xl font-semibold tabular-nums">{a.total ? `${pct(a.correct, a.total)}%` : '—'}</span>
      </div>
      <Bar value={pct(a.correct, a.total)} className="mt-3" />
      <div className="mt-2 text-xs text-ink-3 tabular-nums">
        {a.correct} of {a.total} answers recalled (not "Again")
      </div>
    </div>
  )
}
