import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { CATEGORIES, type Card, type Category, type SrsState, type Status } from '../types'
import { cardStatus } from '../srs/stats'
import { normPinyin } from '../lib/answer'
import { CardEditor } from '../components/CardEditor'
import { Button, Pinyin, SpeakButton, StatusPill } from '../components/ui'

const PAGE = 100

export function ListView({ category }: { category: Category }) {
  const meta = CATEGORIES.find((c) => c.id === category)!
  const cards = useLiveQuery(
    () => db.cards.where('[category+frequency_rank]').between([category, 1], [category, Infinity]).toArray(),
    [category],
  )
  const srs = useLiveQuery(() => db.srs.where('category').equals(category).toArray(), [category])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<Status | 'all'>('all')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<Card | 'new' | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const byCard = useMemo(() => {
    const m = new Map<string, SrsState[]>()
    for (const s of srs ?? []) {
      if (!m.has(s.cardId)) m.set(s.cardId, [])
      m.get(s.cardId)!.push(s)
    }
    return m
  }, [srs])

  const filtered = useMemo(() => {
    if (!cards) return []
    const needle = q.trim().toLowerCase()
    const py = normPinyin(needle)
    return cards.filter((c) => {
      if (c.deleted) return false
      if (status !== 'all' && cardStatus(c.id, byCard) !== status) return false
      if (!needle) return true
      return c.hanzi.includes(needle) || c.english.toLowerCase().includes(needle) || (py && normPinyin(c.pinyin).includes(py)) || String(c.frequency_rank) === needle
    })
  }, [cards, q, status, byCard])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <a href="#/" className="text-sm text-ink-3 hover:text-ink">
            ← Dashboard
          </a>
          <h1 className="text-2xl font-semibold">
            {meta.label} <span className="han text-lg font-normal text-ink-3">{meta.zh}</span>
          </h1>
          <p className="text-sm text-ink-3">Ordered by frequency, #1 is the most common.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setEditing('new')}>+ Add card</Button>
          <a href={`#/study/${category}`} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90">
            Study
          </a>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(0)
          }}
          placeholder="Search hanzi, pinyin, English or rank…"
          className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as Status | 'all')
            setPage(0)
          }}
          className="rounded-lg border border-line px-3 py-2 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="new">New</option>
          <option value="learning">Learning</option>
          <option value="review">Review</option>
          <option value="mastered">Mastered</option>
        </select>
      </div>

      {!cards ? (
        <p className="py-10 text-center text-ink-3">Loading…</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-ink-3">
                <tr>
                  <th className="w-14 px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Hanzi</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">Pinyin</th>
                  <th className="px-3 py-2 font-medium">English</th>
                  <th className="hidden w-24 px-3 py-2 font-medium md:table-cell">Status</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <Row key={c.id} card={c} status={cardStatus(c.id, byCard)} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} onEdit={() => setEditing(c)} />
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-ink-3">
                      No cards match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-ink-3">
            <span className="tabular-nums">
              {filtered.length.toLocaleString()} cards · page {page + 1} of {pages}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
                ← Prev
              </Button>
              <Button variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                Next →
              </Button>
            </div>
          </div>
        </>
      )}

      {editing && <CardEditor card={editing === 'new' ? undefined : editing} defaultCategory={category} onClose={() => setEditing(null)} />}
    </div>
  )
}

function Row({ card, status, open, onToggle, onEdit }: { card: Card; status: Status; open: boolean; onToggle: () => void; onEdit: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-t border-line hover:bg-surface-2/60" onClick={onToggle}>
        <td className="px-3 py-2 text-ink-3 tabular-nums">{card.frequency_rank}</td>
        <td className="han px-3 py-2 text-lg">{card.hanzi}</td>
        <td className="hidden px-3 py-2 sm:table-cell">
          <Pinyin text={card.pinyin} />
        </td>
        <td className="px-3 py-2 text-ink-2">
          <span className="line-clamp-1">{card.english}</span>
        </td>
        <td className="hidden px-3 py-2 md:table-cell">
          <StatusPill status={status} />
        </td>
        <td className="px-2 py-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            className="rounded px-2 py-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
            aria-label={`Edit ${card.hanzi}`}
            title="Edit"
          >
            ✎
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-surface-2/40">
          <td />
          <td colSpan={5} className="px-3 pt-1 pb-3">
            <div className="flex items-center gap-2 sm:hidden">
              <Pinyin text={card.pinyin} />
              <StatusPill status={status} />
            </div>
            <p className="text-ink-2">{card.english}</p>
            {card.hsk && <p className="text-xs text-ink-3">{card.hsk}</p>}
            <ul className="mt-2 space-y-2">
              {card.examples.map((ex, i) => (
                <li key={i} className="flex items-start gap-1">
                  <SpeakButton text={ex.hanzi} className="-mt-1 shrink-0" />
                  <div>
                    <div className="han text-base">{ex.hanzi}</div>
                    <div className="text-xs text-ink-3">{ex.pinyin}</div>
                    <div className="text-xs text-ink-2">{ex.english}</div>
                  </div>
                </li>
              ))}
              {card.examples.length === 0 && <li className="text-xs text-ink-3">No examples yet. Edit the card to add some.</li>}
            </ul>
          </td>
        </tr>
      )}
    </>
  )
}
