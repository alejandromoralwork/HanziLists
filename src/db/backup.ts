import { db } from './schema'

const FORMAT = 'hanzilists-backup'

export async function exportBackup(): Promise<Blob> {
  const [cards, srs, logs, meta] = await Promise.all([db.cards.toArray(), db.srs.toArray(), db.logs.toArray(), db.meta.toArray()])
  const data = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), cards, srs, logs, meta }
  return new Blob([JSON.stringify(data)], { type: 'application/json' })
}

export async function importBackup(file: File) {
  const data = JSON.parse(await file.text())
  if (data?.format !== FORMAT) throw new Error('Not a HanziLists backup file')
  await db.transaction('rw', [db.cards, db.srs, db.logs, db.meta], async () => {
    await Promise.all([db.cards.clear(), db.srs.clear(), db.logs.clear(), db.meta.clear()])
    await db.cards.bulkPut(data.cards)
    await db.srs.bulkPut(data.srs)
    await db.logs.bulkPut(data.logs)
    await db.meta.bulkPut(data.meta)
  })
}

/** Forget all study progress but keep cards (including your edits). */
export async function resetProgress() {
  await db.transaction('rw', db.srs, db.logs, async () => {
    await db.srs.clear()
    await db.logs.clear()
  })
}
