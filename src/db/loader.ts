import { CATEGORIES, type Card } from '../types'
import { db, getMeta, setMeta } from './schema'

const DATA = `${import.meta.env.BASE_URL}data/`

export interface Manifest {
  version: string
  counts: Record<string, number>
}

/**
 * Load (or refresh) the dataset into IndexedDB. Runs only when the published
 * dataset version differs from the one stored locally. Cards you created, edited
 * or deleted are never overwritten; if you ever re-ordered cards, ranks and
 * categories of existing cards are preserved too.
 */
export async function ensureDataset(onProgress?: (msg: string) => void): Promise<void> {
  const manifest: Manifest = await fetch(`${DATA}manifest.json`, { cache: 'no-cache' }).then((r) => r.json())
  const current = await getMeta<string | null>('datasetVersion', null)
  if (current === manifest.version) return

  const reordered = await getMeta<boolean>('reordered', false)
  for (const { id: cat, label } of CATEGORIES) {
    onProgress?.(`Loading ${label}…`)
    const incoming: Card[] = await fetch(`${DATA}${cat}.json?v=${manifest.version}`).then((r) => r.json())
    const existing = await db.cards.bulkGet(incoming.map((c) => c.id))
    const toPut: Card[] = []
    incoming.forEach((c, i) => {
      const old = existing[i]
      if (!old) toPut.push(c)
      else if (old.userEdited || old.userCreated || old.deleted) return
      else if (reordered) toPut.push({ ...c, frequency_rank: old.frequency_rank, category: old.category })
      else toPut.push(c)
    })
    await db.cards.bulkPut(toPut)
  }
  await setMeta('datasetVersion', manifest.version)
}
