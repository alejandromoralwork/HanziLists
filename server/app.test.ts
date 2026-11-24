import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
// @ts-expect-error plain JS module
import { createApp } from './app.mjs'

let base = ''
let server: import('node:http').Server
beforeAll(async () => {
  server = createApp({ dbPath: ':memory:', secureCookie: false })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hanzi/api`
})
afterAll(() => new Promise((r) => server.close(r)))

async function call(path: string, body?: unknown, cookie = '', headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hanzi': '1', Cookie: cookie, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookie = res.headers.get('set-cookie') ?? ''
  return { status: res.status, json: await res.json(), cookie: setCookie.split(';')[0] }
}

describe('auth', () => {
  it('registers, rejects duplicates and weak input, logs in and out', async () => {
    const r = await call('/register', { username: 'alice', password: 'correct horse' })
    expect(r.status).toBe(201)
    expect(r.cookie).toMatch(/^hz_session=/)
    expect((await call('/me', undefined, r.cookie)).json.username).toBe('alice')
    expect((await call('/register', { username: 'ALICE', password: 'whatever12' })).status).toBe(409)
    expect((await call('/register', { username: 'x', password: 'whatever12' })).status).toBe(400)
    expect((await call('/register', { username: 'bob', password: 'short' })).status).toBe(400)
    expect((await call('/login', { username: 'alice', password: 'nope-nope' })).status).toBe(401)
    expect((await call('/login', { username: 'ghost', password: 'nope-nope' })).status).toBe(401)
    const l = await call('/login', { username: 'alice', password: 'correct horse' })
    expect(l.status).toBe(200)
    await call('/logout', {}, l.cookie)
    expect((await call('/me', undefined, l.cookie)).status).toBe(401)
  })
  it('requires the CSRF header and a session for sync', async () => {
    expect((await call('/sync', {}, '', { 'X-Hanzi': '' })).status).toBe(403)
    expect((await call('/sync', { since: 0, changes: [] })).status).toBe(401)
  })
})

describe('sync', () => {
  let a = ''
  beforeAll(async () => {
    a = (await call('/register', { username: 'syncer', password: 'password123' })).cookie
  })
  it('pushes, pulls by seq, and resolves srs by last-write-wins', async () => {
    const push = await call('/sync', {
      since: 0,
      changes: [
        { kind: 'srs', key: 'v:说|en-zh', updatedAt: 100, data: { interval: 1 } },
        { kind: 'review', key: 'r1', updatedAt: 100, data: { grade: 'easy' } },
        { kind: 'bogus', key: 'x', updatedAt: 1, data: {} },
      ],
    }, a)
    expect(push.json.accepted).toBe(2)
    expect(push.json.changes).toHaveLength(2)
    const seq = push.json.seq

    // a stale write loses, a newer one wins; appends are idempotent
    const p2 = await call('/sync', {
      since: seq,
      changes: [
        { kind: 'srs', key: 'v:说|en-zh', updatedAt: 50, data: { interval: 99 } },
        { kind: 'review', key: 'r1', updatedAt: 999, data: { grade: 'again' } },
      ],
    }, a)
    expect(p2.json.accepted).toBe(0)
    expect(p2.json.changes).toHaveLength(0)
    const p3 = await call('/sync', { since: seq, changes: [{ kind: 'srs', key: 'v:说|en-zh', updatedAt: 200, data: { interval: 4 } }] }, a)
    expect(p3.json.changes).toEqual([{ kind: 'srs', key: 'v:说|en-zh', updatedAt: 200, data: { interval: 4 } }])
  })
  it('keeps users isolated', async () => {
    const b = (await call('/register', { username: 'other', password: 'password123' })).cookie
    expect((await call('/sync', { since: 0, changes: [] }, b)).json.changes).toHaveLength(0)
  })
  it('reset clears progress, tells stale devices, and drops their old writes', async () => {
    await call('/sync', { since: 0, changes: [{ kind: 'cardop', key: 'op1', updatedAt: 5, data: { type: 'delete', id: 'v:x' } }] }, a)
    const { json } = await call('/reset', {}, a)
    // a device that hasn't seen the reset pushes old progress and gets a full resend
    const stale = await call('/sync', { since: 50, resetAt: 0, changes: [{ kind: 'srs', key: 'n:人|zh-en', updatedAt: 300, data: {} }] }, a)
    expect(stale.json.resetAt).toBe(json.resetAt)
    expect(stale.json.accepted).toBe(0)
    expect(stale.json.changes.map((c: { kind: string }) => c.kind)).toEqual(['cardop']) // card edits survive a progress reset
  })
})
