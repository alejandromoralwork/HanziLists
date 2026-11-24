import { db, uuid } from './schema'
import { enqueueEverything, resetEverywhere, syncNow } from '../sync/sync'
import type { ReviewLog } from '../types'

const FORMAT = 'hanzilists-backup'
const LOCAL_ONLY_META = new Set(['sync']) // never export or overwrite the sign-in state

export async function exportBackup(): Promise<Blob> {
  const [cards, srs, reviews, cardops, meta] = await Promise.all([
    db.cards.toArray(),
    db.srs.toArray(),
    db.reviews.toArray(),
    db.cardops.toArray(),
    db.meta.toArray(),
  ])
  const data = { format: FORMAT, version: 2, exportedAt: new Date().toISOString(), cards, srs, reviews, cardops, meta: meta.filter((m) => !LOCAL_ONLY_META.has(m.key)) }
  return new Blob([JSON.stringify(data)], { type: 'application/json' })
}

export async function importBackup(file: File) {
  const data = JSON.parse(await file.text())
  if (data?.format !== FORMAT) throw new Error('Not a HanziLists backup file')
  // v1 backups stored review logs with numeric ids
  const reviews: ReviewLog[] = data.reviews ?? (data.logs ?? []).map(({ id: _n, ...l }: ReviewLog) => ({ ...l, id: uuid() }))
  await db.transaction('rw', [db.cards, db.srs, db.reviews, db.cardops, db.meta, db.outbox], async () => {
    await Promise.all([db.cards.clear(), db.srs.clear(), db.reviews.clear(), db.cardops.clear(), db.outbox.clear()])
    await db.meta.filter((m) => !LOCAL_ONLY_META.has(m.key)).delete()
    await db.cards.bulkPut(data.cards)
    await db.srs.bulkPut(data.srs)
    await db.reviews.bulkPut(reviews)
    await db.cardops.bulkPut(data.cardops ?? [])
    await db.meta.bulkPut(data.meta.filter((m: { key: string }) => !LOCAL_ONLY_META.has(m.key)))
  })
  // when signed in, merge the restored data into the account
  await enqueueEverything()
  await syncNow()
}

/** Forget all study progress (on every device when signed in) but keep cards and edits. */
export const resetProgress = resetEverywhere
