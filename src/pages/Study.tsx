import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { CATEGORIES, directionsFor, type Card, type Category, type Direction, type Grade, type SrsState } from '../types'
import { grade as gradeState, isDue, newState, srsKey } from '../srs/scheduler'
import { buildQueue, Session } from '../srs/session'
import { dayKey } from '../lib/time'
import { go, useSettings } from '../lib/hooks'
import { checkChinese, checkEnglish } from '../lib/answer'
import { speak } from '../lib/speech'
import { CardEditor } from '../components/CardEditor'
import { Bar, Button, Pinyin, RankBadge, SpeakButton } from '../components/ui'

const DIR_LABEL: Record<Direction, { title: string; sub: string }> = {
  'en-zh': { title: 'English → Chinese', sub: 'See the English, recall the hanzi and pinyin (production)' },
  'zh-en': { title: 'Chinese → English', sub: 'See the hanzi, recall the meaning (comprehension)' },
}

async function newIntroducedToday(category: Category, direction: Direction) {
  const today = dayKey(Date.now())
  const logs = await db.logs.where('category').equals(category).filter((l) => l.direction === direction && l.wasNew && dayKey(l.ts) === today).toArray()
  return new Set(logs.map((l) => l.cardId)).size
}

// ---------------------------------------------------------------- start screen

export function StudyStart({ category }: { category: Category }) {
  const meta = CATEGORIES.find((c) => c.id === category)!
  const dirs = directionsFor(category)
  const [dir, setDir] = useState<Direction>(dirs[0])
  const [settings, update] = useSettings()

  const info = useLiveQuery(async () => {
    const now = Date.now()
    const states = await db.srs.where('[category+direction]').equals([category, dir]).toArray()
    const total = await db.cards.where('[category+frequency_rank]').between([category, 1], [category, Infinity]).count()
    const introducedToday = await newIntroducedToday(category, dir)
    const next = await db.cards
      .where('[category+frequency_rank]')
      .between([category, 1], [category, Infinity])
      .filter((c) => !states.some((s) => s.cardId === c.id && s.status !== 'new'))
      .first()
    return {
      due: states.filter((s) => isDue(s, now)).length,
      unseen: total - states.filter((s) => s.status !== 'new').length,
      introducedToday,
      next,
    }
  }, [category, dir])

  const newLeft = info ? Math.max(0, Math.min(settings.newPerDay - info.introducedToday, info.unseen)) : 0

  return (
    <div className="mx-auto max-w-xl">
      <a href="#/" className="text-sm text-ink-3 hover:text-ink">
        ← Dashboard
      </a>
      <h1 className="mb-6 text-2xl font-semibold">
        Study {meta.label} <span className="han text-lg font-normal text-ink-3">{meta.zh}</span>
      </h1>

      {dirs.length > 1 ? (
        <fieldset className="mb-6 grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium text-ink-3">Direction</legend>
          {dirs.map((d) => (
            <label
              key={d}
              className={`cursor-pointer rounded-2xl border p-4 transition ${dir === d ? 'border-accent bg-accent/5' : 'border-line bg-surface hover:bg-surface-2'}`}
            >
              <input type="radio" name="dir" value={d} checked={dir === d} onChange={() => setDir(d)} className="sr-only" />
              <div className="font-medium">{DIR_LABEL[d].title}</div>
              <div className="mt-1 text-sm text-ink-3">{DIR_LABEL[d].sub}</div>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="mb-6 rounded-2xl border border-line bg-surface p-4 text-sm text-ink-2">
          Recognition only: see each character in frequency order and check its reading and meaning.
        </p>
      )}

      <div className="mb-6 grid grid-cols-3 gap-3 text-center">
        <Stat n={info?.due} label="due reviews" />
        <Stat n={newLeft} label="new today" />
        <Stat n={info?.unseen} label="not started" />
      </div>
      {info?.next && (
        <p className="mb-6 text-sm text-ink-3">
          Next new card: <span className="han text-ink">{info.next.hanzi}</span> (#{info.next.frequency_rank})
        </p>
      )}

      <div className="mb-6 space-y-2 text-sm">
        {dir === 'zh-en' && category !== 'character' && (
          <Toggle checked={settings.showPinyin} onChange={(v) => update({ showPinyin: v })} label="Show pinyin on the front of the card" />
        )}
        <Toggle checked={settings.typeAnswer} onChange={(v) => update({ typeAnswer: v })} label="Type my answer before revealing" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" className="px-6" disabled={!info || info.due + newLeft === 0} onClick={() => go(`/study/${category}/${dir}`)}>
          Start session ({(info?.due ?? 0) + newLeft})
        </Button>
        {info && info.unseen > 0 && (
          <Button onClick={() => go(`/study/${category}/${dir}/10`)} title="Ignore today's new-card limit">
            +10 extra new
          </Button>
        )}
      </div>
    </div>
  )
}

function Stat({ n, label }: { n?: number; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="text-2xl font-semibold tabular-nums">{n ?? '–'}</div>
      <div className="text-xs text-ink-3">{label}</div>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
      {label}
    </label>
  )
}

// ---------------------------------------------------------------- session

const fmtInterval = (s: SrsState) => (s.interval < 1 ? '1m' : s.interval < 30 ? `${s.interval}d` : s.interval < 365 ? `${Math.round(s.interval / 30)}mo` : `${(s.interval / 365).toFixed(1)}y`)

export function StudySession({ category, direction, extra }: { category: Category; direction: Direction; extra: number }) {
  const [settings] = useSettings()
  const session = useRef<Session | null>(null)
  const states = useRef(new Map<string, SrsState>())
  const total = useRef(0)
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  const [ready, setReady] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [typed, setTyped] = useState('')
  const [checked, setChecked] = useState<boolean | null>(null)
  const [pinyinOn, setPinyinOn] = useState<boolean | null>(null)
  const [context, setContext] = useState(false)
  const [editing, setEditing] = useState(false)
  const [tally, setTally] = useState({ again: 0, hard: 0, easy: 0 })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [cards, srs, introduced, s] = await Promise.all([
        db.cards.where('[category+frequency_rank]').between([category, 1], [category, Infinity]).toArray(),
        db.srs.where('[category+direction]').equals([category, direction]).toArray(),
        newIntroducedToday(category, direction),
        db.meta.get('settings'),
      ])
      const newPerDay = (s?.value as { newPerDay?: number })?.newPerDay ?? 20
      states.current = new Map(srs.map((x) => [x.key, x]))
      const q = buildQueue(cards, states.current, direction, Date.now(), Math.max(0, newPerDay - introduced) + extra)
      if (!alive) return
      session.current = new Session(q)
      total.current = q.length
      setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [category, direction, extra])

  const item = session.current?.current
  const card = item?.card
  const showPinyinFront = category === 'character' ? false : (pinyinOn ?? settings.showPinyin)
  const state = card ? (states.current.get(srsKey(card.id, direction)) ?? newState(card, direction)) : null

  const reveal = useCallback(() => {
    if (!card || revealed) return
    if (settings.typeAnswer && typed.trim()) {
      setChecked(direction === 'en-zh' ? checkChinese(typed, card.hanzi, card.pinyin) : checkEnglish(typed, card.english))
    }
    setRevealed(true)
  }, [card, revealed, settings.typeAnswer, typed, direction])

  const answer = useCallback(
    (g: Grade) => {
      if (!card || !state || !revealed || !session.current) return
      const now = Date.now()
      const next = gradeState(state, g, now)
      states.current.set(next.key, next)
      // advance the UI immediately; persist in the background (IndexedDB writes are ordered)
      db.transaction('rw', db.srs, db.logs, async () => {
        await db.srs.put(next)
        await db.logs.add({ ts: now, cardId: card.id, category, direction, grade: g, correct: g !== 'again', wasNew: state.status === 'new' })
      }).catch((e) => console.error('save failed', e))
      session.current.answer(g)
      setTally((t) => ({ ...t, [g]: t[g] + 1 }))
      setRevealed(false)
      setTyped('')
      setChecked(null)
      setContext(false)
      rerender()
      setTimeout(() => inputRef.current?.focus(), 0)
    },
    [card, state, revealed, category, direction],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (e.key === 'Enter' || (e.key === ' ' && !typing)) {
        if (!revealed) {
          e.preventDefault()
          reveal()
        } else if (e.key === 'Enter' && checked !== null) {
          e.preventDefault()
          answer(checked ? 'easy' : 'again')
        }
        return
      }
      if (typing) return
      if (revealed && ['1', '2', '3'].includes(e.key)) answer((['again', 'hard', 'easy'] as const)[Number(e.key) - 1])
      else if (e.key === 'e') setEditing(true)
      else if (e.key === 'p') setPinyinOn(!showPinyinFront)
      else if (e.key === 's' && card) speak(card.hanzi)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [revealed, reveal, answer, editing, checked, showPinyinFront, card])

  if (!ready || !session.current) return <p className="py-20 text-center text-ink-3">Preparing session…</p>

  const s = session.current
  const back = `#/study/${category}`

  if (!card || !state) {
    const n = tally.again + tally.hard + tally.easy
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="han mb-4 text-5xl">好！</div>
        <h1 className="text-xl font-semibold">{total.current ? 'Session complete' : 'Nothing to study right now'}</h1>
        {n > 0 && (
          <p className="mt-2 text-ink-3 tabular-nums">
            {n} answers · {tally.easy} easy · {tally.hard} hard · {tally.again} again
          </p>
        )}
        <div className="mt-8 flex justify-center gap-2">
          <a href="#/" className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-surface-2">
            Dashboard
          </a>
          <a href={back} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent">
            Study more
          </a>
        </div>
      </div>
    )
  }

  const progress = total.current ? (s.done / (s.done + s.remaining)) * 100 : 0
  const previews = (['again', 'hard', 'easy'] as const).map((g) => fmtInterval(gradeState(state, g, Date.now())))

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center gap-3">
        <a href={back} className="text-sm text-ink-3 hover:text-ink" aria-label="End session">
          ✕
        </a>
        <Bar value={progress} />
        <span className="shrink-0 text-xs text-ink-3 tabular-nums">{s.remaining} left</span>
      </div>

      <article className="rounded-3xl border border-line bg-surface p-6 sm:p-10">
        <div className="mb-6 flex items-center justify-between text-xs text-ink-3">
          <div className="flex items-center gap-2">
            <RankBadge rank={card.frequency_rank} />
            {item!.isNew && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">new</span>}
            {card.hsk && <span>{card.hsk}</span>}
          </div>
          <div className="flex items-center gap-1">
            {(direction === 'zh-en' || revealed) && <SpeakButton text={card.hanzi} />}
            <button onClick={() => setEditing(true)} className="rounded px-2 py-1 hover:bg-surface-2 hover:text-ink" title="Edit card (e)">
              ✎ Edit
            </button>
          </div>
        </div>

        {/* front */}
        <div className="min-h-40 text-center">
          {direction === 'zh-en' ? (
            <>
              <div className="han text-6xl leading-tight sm:text-7xl">{card.hanzi}</div>
              <div className="mt-3 h-7 text-lg">
                {showPinyinFront || revealed ? (
                  <Pinyin text={card.pinyin} />
                ) : (
                  <button className="text-sm text-ink-3 underline-offset-4 hover:underline" onClick={() => setPinyinOn(true)}>
                    show pinyin <kbd>p</kbd>
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl font-medium sm:text-3xl">{card.english}</div>
              {!revealed && card.examples.length > 0 && (
                <div className="mt-4">
                  {context ? (
                    <p className="text-sm text-ink-3 italic">“{card.examples[0].english}”</p>
                  ) : (
                    <button className="text-sm text-ink-3 underline-offset-4 hover:underline" onClick={() => setContext(true)}>
                      show context
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {settings.typeAnswer && !revealed && (
          <form
            className="mt-6"
            onSubmit={(e) => {
              e.preventDefault()
              reveal()
            }}
          >
            <input
              ref={inputRef}
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={direction === 'en-zh' ? 'Type hanzi or pinyin (tones optional)…' : 'Type the English meaning…'}
              className="w-full rounded-xl border border-line px-4 py-3 text-center outline-none focus:border-accent"
              lang={direction === 'en-zh' ? 'zh' : 'en'}
            />
          </form>
        )}

        {!revealed ? (
          <div className="mt-8 text-center">
            <Button variant="primary" className="px-8 py-3" onClick={reveal}>
              Show answer <kbd className="ml-1 hidden !border-white/40 !text-white/80 sm:inline">space</kbd>
            </Button>
          </div>
        ) : (
          <div className="mt-6 border-t border-line pt-6">
            {checked !== null && (
              <p className={`mb-4 text-center text-sm font-medium ${checked ? 'text-good' : 'text-bad'}`}>
                {checked ? '✓ Correct' : `✗ You wrote “${typed}”`}
              </p>
            )}
            <div className="text-center">
              {direction === 'en-zh' ? (
                <>
                  <div className="han text-6xl leading-tight">{card.hanzi}</div>
                  <Pinyin text={card.pinyin} className="mt-2 block text-lg" />
                </>
              ) : (
                <div className="text-xl font-medium">{card.english}</div>
              )}
            </div>
            {card.examples.length > 0 && (
              <ul className="mt-6 space-y-3">
                {card.examples.map((ex, i) => (
                  <li key={i} className="flex items-start gap-1 rounded-xl bg-surface-2/50 p-3">
                    <SpeakButton text={ex.hanzi} className="shrink-0" />
                    <div>
                      <div className="han text-lg">{ex.hanzi}</div>
                      <div className="text-sm text-ink-3">{ex.pinyin}</div>
                      <div className="text-sm text-ink-2">{ex.english}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </article>

      {revealed && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <GradeButton onClick={() => answer('again')} k="1" label="Don't know" sub={`again · ${previews[0]}`} tone="bad" />
          <GradeButton onClick={() => answer('hard')} k="2" label="Hard" sub={previews[1]} tone="warn" />
          <GradeButton onClick={() => answer('easy')} k="3" label="I know it" sub={previews[2]} tone="good" />
        </div>
      )}

      <p className="mt-6 hidden text-center text-xs text-ink-3 sm:block">
        <kbd>space</kbd> reveal · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> grade · <kbd>s</kbd> listen · <kbd>e</kbd> edit
      </p>

      {editing && (
        <CardEditor
          card={card}
          onClose={(r) => {
            setEditing(false)
            if (r?.deletedId) s.remove(r.deletedId)
            else if (r?.saved) db.cards.get(r.saved.id).then((c?: Card) => c && (c.category === category ? s.updateCard(c) : s.remove(c.id), rerender()))
            rerender()
          }}
        />
      )}
    </div>
  )
}

function GradeButton({ onClick, k, label, sub, tone }: { onClick: () => void; k: string; label: string; sub: string; tone: 'bad' | 'warn' | 'good' }) {
  const c = { bad: 'border-bad/40 hover:bg-bad/10 text-bad', warn: 'border-warn/40 hover:bg-warn/10 text-warn', good: 'border-good/40 hover:bg-good/10 text-good' }[tone]
  return (
    <button onClick={onClick} className={`rounded-2xl border bg-surface px-2 py-3 text-center transition ${c}`}>
      <div className="font-medium">
        {label} <kbd className="ml-1 hidden sm:inline">{k}</kbd>
      </div>
      <div className="text-xs opacity-70">{sub}</div>
    </button>
  )
}
