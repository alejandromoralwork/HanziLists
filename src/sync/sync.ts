import { useSyncExternalStore } from 'react'
import { db, getMeta, setMeta } from '../db/schema'
import { applyCardOp } from '../db/cards'
import type { CardOp, ReviewLog, Settings, SrsState, SyncKind } from '../types'

const API = `${import.meta.env.BASE_URL}api`
const BATCH = 2000

export interface SyncState {
  username: string | null
  since: number // last server seq pulled
  resetAt: number // last account-wide progress reset this device knows about
  lastSyncAt: number
}
const EMPTY: SyncState = { username: null, since: 0, resetAt: 0, lastSyncAt: 0 }

interface Change {
  kind: SyncKind
  key: string
  updatedAt: number
  data: unknown
}

// ---------------------------------------------------------------- status store for the UI

export interface SyncStatus extends SyncState {
  phase: 'idle' | 'syncing' | 'error' | 'offline'
  error?: string
}
let status: SyncStatus = { ...EMPTY, phase: 'idle' }
const listeners = new Set<() => void>()
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  listeners.forEach((l) => l())
}
export const useSyncStatus = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => status,
  )

async function loadState(): Promise<SyncState> {
  return { ...EMPTY, ...(await getMeta<Partial<SyncState>>('sync', {})) }
}
async function saveState(s: SyncState) {
  await setMeta('sync', s)
  setStatus(s)
}

export async function initSync() {
  setStatus(await loadState())
}

// ---------------------------------------------------------------- http

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Hanzi': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'You appear to be offline')
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, json.error ?? `HTTP ${res.status}`)
  return json as T
}

// ---------------------------------------------------------------- push / pull

async function buildChanges(rows: { kind: SyncKind; key: string }[]): Promise<Change[]> {
  const out: Change[] = []
  for (const r of rows) {
    if (r.kind === 'srs') {
      const s = await db.srs.get(r.key)
      if (s) out.push({ kind: 'srs', key: r.key, updatedAt: s.updatedAt ?? s.lastReviewed, data: s })
    } else if (r.kind === 'review') {
      const l = await db.reviews.get(r.key)
      if (l) out.push({ kind: 'review', key: r.key, updatedAt: l.ts, data: l })
    } else if (r.kind === 'cardop') {
      const op = await db.cardops.get(r.key)
      if (op) out.push({ kind: 'cardop', key: r.key, updatedAt: op.ts, data: op })
    } else if (r.kind === 'settings') {
      const s = await getMeta<Settings | null>('settings', null)
      if (s) out.push({ kind: 'settings', key: 'settings', updatedAt: s.updatedAt ?? 0, data: s })
    }
  }
  return out
}

async function applyRemote(changes: Change[]) {
  const ops: CardOp[] = []
  await db.transaction('rw', db.srs, db.reviews, db.meta, db.cardops, async () => {
    for (const c of changes) {
      if (c.kind === 'srs') {
        const remote = c.data as SrsState
        const local = await db.srs.get(c.key)
        if (!local || (local.updatedAt ?? local.lastReviewed) < c.updatedAt) await db.srs.put({ ...remote, updatedAt: c.updatedAt })
      } else if (c.kind === 'review') {
        await db.reviews.put(c.data as ReviewLog)
      } else if (c.kind === 'settings') {
        const local = await getMeta<Settings | null>('settings', null)
        if (!local || (local.updatedAt ?? 0) < c.updatedAt) await setMeta('settings', c.data)
      } else if (c.kind === 'cardop') {
        if (!(await db.cardops.get(c.key))) ops.push(c.data as CardOp)
      }
    }
  })
  // card edits are replayed in the order they were made
  for (const op of ops.sort((a, b) => a.ts - b.ts)) {
    await applyCardOp(op)
    await db.cardops.put(op)
  }
}

async function clearLocalProgress() {
  await db.transaction('rw', db.srs, db.reviews, db.outbox, async () => {
    await db.srs.clear()
    await db.reviews.clear()
    await db.outbox.where('kind').anyOf('srs', 'review').delete()
  })
}

let running: Promise<void> | null = null
let again = false

/** Push pending local changes and pull everything new. Safe to call often. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    try {
      do {
        again = false
        await syncOnce()
      } while (again)
    } finally {
      running = null
    }
  })()
  return running
}

async function syncOnce() {
  let state = await loadState()
  if (!state.username) return
  setStatus({ phase: 'syncing', error: undefined })
  try {
    for (let round = 0; round < 1000; round++) {
      const pending = await db.outbox.limit(BATCH).toArray()
      const changes = await buildChanges(pending)
      const res = await api<{ resetAt: number; changes: Change[]; seq: number; more: boolean }>('/sync', {
        since: state.since,
        resetAt: state.resetAt,
        changes,
      })
      if (res.resetAt > state.resetAt) {
        // progress was reset from another device: start over from the server's copy
        await clearLocalProgress()
        state = { ...state, resetAt: res.resetAt }
      }
      await applyRemote(res.changes)
      // clear only what was sent and hasn't changed since
      await db.transaction('rw', db.outbox, async () => {
        for (const p of pending) {
          const cur = await db.outbox.get(p.id)
          if (cur && cur.v === p.v) await db.outbox.delete(p.id)
        }
      })
      state = { ...state, since: res.seq, lastSyncAt: Date.now() }
      await saveState(state)
      if (!res.more && pending.length < BATCH) break
    }
    setStatus({ phase: 'idle' })
  } catch (e) {
    const err = e as ApiError
    if (err.status === 401) {
      // session expired or revoked: keep local data, ask to sign in again
      await saveState({ ...state, username: null })
      setStatus({ phase: 'error', error: 'Signed out. Sign in again to keep syncing.' })
    } else setStatus({ phase: err.status === 0 ? 'offline' : 'error', error: err.message })
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
/** Debounced sync after local changes. */
export function scheduleSync(delay = 3000) {
  if (!status.username) return
  clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), delay)
}

/** Background triggers: on focus, when back online, when the tab is hidden, and every 2 minutes. */
export function startAutoSync() {
  const run = () => void syncNow()
  window.addEventListener('focus', run)
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && run())
  setInterval(() => document.visibilityState === 'visible' && run(), 120_000)
  run()
}

// ---------------------------------------------------------------- account actions

/** Queue every local record so it gets merged into the account. */
export async function enqueueEverything() {
  const [srs, reviews, ops, settings] = await Promise.all([
    db.srs.toCollection().primaryKeys(),
    db.reviews.toCollection().primaryKeys(),
    db.cardops.toCollection().primaryKeys(),
    db.meta.get('settings'),
  ])
  const v = Date.now() * 1000
  const rows = [
    ...srs.map((k) => ({ id: `srs|${k}`, kind: 'srs' as const, key: String(k), v })),
    ...reviews.map((k) => ({ id: `review|${k}`, kind: 'review' as const, key: String(k), v })),
    ...ops.map((k) => ({ id: `cardop|${k}`, kind: 'cardop' as const, key: String(k), v })),
    ...(settings ? [{ id: 'settings|settings', kind: 'settings' as const, key: 'settings', v }] : []),
  ]
  await db.outbox.bulkPut(rows)
}

interface Me {
  username: string
  resetAt: number
}

/** Sign in or create an account. Progress already on this device is merged into the account. */
export async function signIn(username: string, password: string, create: boolean) {
  const me = await api<Me>(create ? '/register' : '/login', { username, password })
  await enqueueEverything()
  await saveState({ username: me.username, since: 0, resetAt: me.resetAt, lastSyncAt: 0 })
  await syncNow()
}

export async function pendingChanges() {
  return db.outbox.count()
}

/**
 * Sign out and clear this device (the account keeps everything).
 * Pending changes are pushed first; with `force` they are discarded if that fails.
 */
export async function signOut(force = false) {
  await syncNow()
  if (!force && (await db.outbox.count()) > 0) throw new ApiError(0, 'Some changes have not been synced yet')
  await api('/logout', {}).catch(() => {})
  await db.transaction('rw', [db.srs, db.reviews, db.cardops, db.outbox, db.meta, db.cards], async () => {
    await Promise.all([db.srs.clear(), db.reviews.clear(), db.cardops.clear(), db.outbox.clear()])
    await db.cards.filter((c) => !!(c.userCreated || c.userEdited || c.deleted)).delete()
    await db.meta.bulkDelete(['settings', 'sync', 'reordered', 'datasetVersion'])
  })
  window.location.hash = '/'
  window.location.reload() // reloads the pristine word lists
}

/** Reset study progress here and, when signed in, on every device. */
export async function resetEverywhere() {
  const state = await loadState()
  if (state.username) {
    const { resetAt } = await api<{ resetAt: number }>('/reset', {})
    await clearLocalProgress()
    await saveState({ ...state, resetAt })
  } else await clearLocalProgress()
}

/** Check the server session on startup (cookie may have expired or been revoked). */
export async function checkSession() {
  const state = await loadState()
  if (!state.username) return
  try {
    const me = await api<Me>('/me')
    if (me.username !== state.username) await saveState({ ...state, username: me.username })
  } catch (e) {
    if ((e as ApiError).status === 401) {
      await saveState({ ...state, username: null })
      setStatus({ phase: 'error', error: 'Your session expired. Sign in again to keep syncing.' })
    }
  }
}
