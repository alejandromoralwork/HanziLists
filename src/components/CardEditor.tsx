import { useEffect, useRef, useState } from 'react'
import { addCard, editCard, lastRank, removeCard } from '../db/cards'
import { CATEGORIES, type Card, type Category, type Example } from '../types'
import { Button } from './ui'

interface Props {
  card?: Card // undefined = create new
  defaultCategory?: Category
  onClose: (result?: { saved?: Card; deletedId?: string }) => void
}

const emptyEx = (): Example => ({ hanzi: '', pinyin: '', english: '' })

export function CardEditor({ card, defaultCategory = 'verb', onClose }: Props) {
  const [draft, setDraft] = useState<Card>(
    () =>
      card ?? {
        id: '',
        category: defaultCategory,
        frequency_rank: 0,
        global_rank: 0,
        hanzi: '',
        pinyin: '',
        english: '',
        examples: [emptyEx()],
      },
  )
  const [maxRank, setMaxRank] = useState<number>(0)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  useEffect(() => {
    lastRank(draft.category).then((n) => {
      const max = card && card.category === draft.category ? n : n + 1
      setMaxRank(max)
      if (!card && !draft.frequency_rank) setDraft((d) => ({ ...d, frequency_rank: max }))
    })
  }, [draft.category, card])

  const set = <K extends keyof Card>(k: K, v: Card[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const setEx = (i: number, k: keyof Example, v: string) =>
    setDraft((d) => ({ ...d, examples: d.examples.map((e, j) => (j === i ? { ...e, [k]: v } : e)) }))

  const valid = draft.hanzi.trim() && draft.english.trim()

  async function save() {
    if (!valid) return
    setBusy(true)
    const clean: Card = {
      ...draft,
      hanzi: draft.hanzi.trim(),
      pinyin: draft.pinyin.trim(),
      english: draft.english.trim(),
      examples: draft.examples.filter((e) => e.hanzi.trim()).map((e) => ({ hanzi: e.hanzi.trim(), pinyin: e.pinyin.trim(), english: e.english.trim() })),
    }
    if (card) {
      await editCard(clean)
      onClose({ saved: clean })
    } else {
      const { id: _omit, global_rank: _g, ...rest } = clean
      const id = await addCard(rest)
      onClose({ saved: { ...clean, id } })
    }
  }

  async function remove() {
    if (!card) return
    setBusy(true)
    await removeCard(card.id)
    onClose({ deletedId: card.id })
  }

  const field = 'w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent'
  const label = 'mb-1 block text-xs font-medium text-ink-3'

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className="m-auto w-[min(640px,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/40"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        className="max-h-[85vh] overflow-y-auto p-5"
      >
        <h2 className="mb-4 text-lg font-semibold">{card ? 'Edit card' : 'New card'}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>Hanzi</label>
            <input className={`${field} han text-lg`} value={draft.hanzi} onChange={(e) => set('hanzi', e.target.value)} autoFocus required />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>Pinyin</label>
            <input className={field} value={draft.pinyin} onChange={(e) => set('pinyin', e.target.value)} placeholder="shuō" />
          </div>
          <div>
            <label className={label}>List</label>
            <select className={field} value={draft.category} onChange={(e) => set('category', e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Frequency rank (1–{maxRank || '…'})</label>
            <input
              className={field}
              type="number"
              min={1}
              max={maxRank || undefined}
              value={draft.frequency_rank || ''}
              onChange={(e) => set('frequency_rank', Number(e.target.value))}
            />
          </div>
          <div className="col-span-2 sm:col-span-4">
            <label className={label}>English meaning</label>
            <input className={field} value={draft.english} onChange={(e) => set('english', e.target.value)} required />
          </div>
        </div>

        <div className="mt-5 mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Example sentences</span>
          <Button type="button" variant="ghost" onClick={() => set('examples', [...draft.examples, emptyEx()])} disabled={draft.examples.length >= 5}>
            + Add example
          </Button>
        </div>
        <div className="space-y-3">
          {draft.examples.map((ex, i) => (
            <div key={i} className="relative grid gap-2 rounded-xl border border-line p-3 pr-10">
              <input className={`${field} han`} placeholder="汉字句子" value={ex.hanzi} onChange={(e) => setEx(i, 'hanzi', e.target.value)} />
              <input className={field} placeholder="Pīnyīn" value={ex.pinyin} onChange={(e) => setEx(i, 'pinyin', e.target.value)} />
              <input className={field} placeholder="English translation" value={ex.english} onChange={(e) => setEx(i, 'english', e.target.value)} />
              <button
                type="button"
                className="absolute top-2 right-2 rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-bad"
                onClick={() => set('examples', draft.examples.filter((_, j) => j !== i))}
                aria-label="Remove example"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {card &&
            (confirmDelete ? (
              <>
                <span className="text-sm text-bad">Delete this card and its progress?</span>
                <Button type="button" variant="danger" onClick={remove} disabled={busy}>
                  Yes, delete
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  No
                </Button>
              </>
            ) : (
              <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ))}
          <div className="ml-auto flex gap-2">
            <Button type="button" onClick={() => onClose()}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!valid || busy}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </dialog>
  )
}
