// HanziLists sync API: accounts, cookie sessions, and per-user record sync.
// Zero dependencies (node:http + node:sqlite + node:crypto).
//
// Records are generic rows (kind, key, updatedAt, data):
//   srs, settings    → last-write-wins by updatedAt
//   review, cardop   → append-only (insert if absent)
// Clients push their changes and pull everything newer than their last seq.
import http from 'node:http'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const COOKIE = 'hz_session'
const SESSION_DAYS = 180
const DAY = 86_400_000
const MAX_BODY = 4 * 1024 * 1024
const MAX_CHANGES = 5000
const PULL_LIMIT = 5000
const MAX_RECORDS_PER_USER = 1_000_000
const LWW = new Set(['srs', 'settings'])
const APPEND = new Set(['review', 'cardop'])
const USERNAME = /^[a-zA-Z0-9_.-]{3,32}$/

export function openDb(path) {
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass TEXT NOT NULL,
      created INTEGER NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      reset_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created INTEGER NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (user_id, kind, key)
    );
    CREATE INDEX IF NOT EXISTS records_seq ON records(user_id, seq);
  `)
  return db
}

// ---------------------------------------------------------------- crypto helpers

const scrypt = (pw, salt) =>
  new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))))

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16)
  return `scrypt$${salt.toString('base64')}$${(await scrypt(pw, salt)).toString('base64')}`
}
async function verifyPassword(pw, stored) {
  const [, salt, hash] = stored.split('$')
  const got = await scrypt(pw, Buffer.from(salt, 'base64'))
  const want = Buffer.from(hash, 'base64')
  return got.length === want.length && crypto.timingSafeEqual(got, want)
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
// constant-cost dummy so unknown usernames take as long as wrong passwords
const DUMMY = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64')

// ---------------------------------------------------------------- rate limiting

function limiter(max, windowMs) {
  const hits = new Map()
  return (id) => {
    const now = Date.now()
    const h = (hits.get(id) ?? []).filter((t) => now - t < windowMs)
    h.push(now)
    hits.set(id, h)
    if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k)
    return h.length <= max
  }
}

// ---------------------------------------------------------------- app

export function createApp({ dbPath = ':memory:', signup = 'open', secureCookie = true } = {}) {
  const db = openDb(dbPath)
  const authLimit = limiter(20, 10 * 60_000)
  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (username, pass, created) VALUES (?, ?, ?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)'),
    session: db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires > ?'),
    extendSession: db.prepare('UPDATE sessions SET expires = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
    getRecord: db.prepare('SELECT updated_at FROM records WHERE user_id = ? AND kind = ? AND key = ?'),
    upsert: db.prepare(`INSERT INTO records (user_id, kind, key, updated_at, seq, data) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, kind, key) DO UPDATE SET updated_at = excluded.updated_at, seq = excluded.seq, data = excluded.data`),
    bumpSeq: db.prepare('UPDATE users SET seq = seq + 1 WHERE id = ? RETURNING seq'),
    count: db.prepare('SELECT COUNT(*) AS n FROM records WHERE user_id = ?'),
    pull: db.prepare('SELECT kind, key, updated_at AS updatedAt, seq, data FROM records WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?'),
    resetProgress: db.prepare("DELETE FROM records WHERE user_id = ? AND kind IN ('srs', 'review')"),
    setResetAt: db.prepare('UPDATE users SET reset_at = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  }
  q.purgeSessions.run(Date.now())

  const cookieHeader = (token, maxAgeSec) =>
    `${COOKIE}=${token}; Path=/hanzi/api; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secureCookie ? '; Secure' : ''}`

  function startSession(res, userId) {
    const token = crypto.randomBytes(32).toString('base64url')
    const now = Date.now()
    q.insertSession.run(sha256(token), userId, now, now + SESSION_DAYS * DAY)
    res.setHeader('Set-Cookie', cookieHeader(token, SESSION_DAYS * 86400))
  }

  function currentUser(req) {
    const m = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)`))
    if (!m) return null
    const th = sha256(m[1])
    const now = Date.now()
    const s = q.session.get(th, now)
    if (!s) return null
    // sliding expiry: renew when less than half the lifetime is left
    if (s.expires - now < (SESSION_DAYS / 2) * DAY) q.extendSession.run(now + SESSION_DAYS * DAY, th)
    return { user: q.userById.get(s.user_id), tokenHash: th }
  }

  const routes = {
    'GET /api/me': (req, res, body, auth) => (auth ? send(res, 200, publicUser(auth.user)) : send(res, 401, { error: 'not signed in' })),

    'POST /api/register': async (req, res, body) => {
      if (signup !== 'open') return send(res, 403, { error: 'Sign-ups are closed' })
      if (!authLimit(ip(req))) return send(res, 429, { error: 'Too many attempts, try again later' })
      const { username, password } = body ?? {}
      if (typeof username !== 'string' || !USERNAME.test(username)) return send(res, 400, { error: 'Username: 3–32 letters, digits, . _ -' })
      if (typeof password !== 'string' || password.length < 8 || password.length > 200) return send(res, 400, { error: 'Password: at least 8 characters' })
      if (q.userByName.get(username)) return send(res, 409, { error: 'That username is taken' })
      const { lastInsertRowid } = q.insertUser.run(username, await hashPassword(password), Date.now())
      startSession(res, Number(lastInsertRowid))
      send(res, 201, publicUser(q.userById.get(lastInsertRowid)))
    },

    'POST /api/login': async (req, res, body) => {
      if (!authLimit(ip(req))) return send(res, 429, { error: 'Too many attempts, try again later' })
      const { username, password } = body ?? {}
      if (typeof username !== 'string' || typeof password !== 'string' || password.length > 200) return send(res, 400, { error: 'Missing username or password' })
      const user = q.userByName.get(username)
      const ok = await verifyPassword(password, user?.pass ?? DUMMY)
      if (!user || !ok) return send(res, 401, { error: 'Wrong username or password' })
      startSession(res, user.id)
      send(res, 200, publicUser(user))
    },

    'POST /api/logout': (req, res, body, auth) => {
      if (auth) q.deleteSession.run(auth.tokenHash)
      res.setHeader('Set-Cookie', cookieHeader('', 0))
      send(res, 200, { ok: true })
    },

    'POST /api/sync': (req, res, body, auth) => {
      if (!auth) return send(res, 401, { error: 'not signed in' })
      const user = auth.user
      const since = Number.isFinite(body?.since) ? body.since : 0
      const clientResetAt = Number.isFinite(body?.resetAt) ? body.resetAt : 0
      const changes = Array.isArray(body?.changes) ? body.changes : []
      if (changes.length > MAX_CHANGES) return send(res, 413, { error: `At most ${MAX_CHANGES} changes per request` })
      if (changes.length && q.count.get(user.id).n + changes.length > MAX_RECORDS_PER_USER) return send(res, 507, { error: 'Storage limit reached' })

      let accepted = 0
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const c of changes) {
          if (!c || typeof c.key !== 'string' || c.key.length > 200 || !Number.isFinite(c.updatedAt) || c.data === undefined) continue
          if (!LWW.has(c.kind) && !APPEND.has(c.kind)) continue
          // progress written before the account's last reset (by a device that hadn't heard of it) is dropped
          if ((c.kind === 'srs' || c.kind === 'review') && clientResetAt < user.reset_at && c.updatedAt < user.reset_at) continue
          const data = JSON.stringify(c.data)
          if (data.length > 64 * 1024) continue
          const existing = q.getRecord.get(user.id, c.kind, c.key)
          if (existing && (APPEND.has(c.kind) || existing.updated_at >= c.updatedAt)) continue
          const { seq } = q.bumpSeq.get(user.id)
          q.upsert.run(user.id, c.kind, c.key, c.updatedAt, seq, data)
          accepted++
        }
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }

      const fresh = q.userById.get(user.id)
      const from = clientResetAt < fresh.reset_at ? 0 : since // a reset happened elsewhere: resend everything
      const rows = q.pull.all(user.id, from, PULL_LIMIT)
      send(res, 200, {
        accepted,
        resetAt: fresh.reset_at,
        changes: rows.map((r) => ({ kind: r.kind, key: r.key, updatedAt: r.updatedAt, data: JSON.parse(r.data) })),
        seq: rows.length ? rows[rows.length - 1].seq : Math.max(from, 0),
        more: rows.length === PULL_LIMIT,
      })
    },

    'POST /api/reset': (req, res, body, auth) => {
      if (!auth) return send(res, 401, { error: 'not signed in' })
      const now = Date.now()
      q.resetProgress.run(auth.user.id)
      q.setResetAt.run(now, auth.user.id)
      send(res, 200, { resetAt: now })
    },

    'POST /api/delete-account': async (req, res, body, auth) => {
      if (!auth) return send(res, 401, { error: 'not signed in' })
      if (typeof body?.password !== 'string' || !(await verifyPassword(body.password, auth.user.pass))) return send(res, 401, { error: 'Wrong password' })
      q.deleteUser.run(auth.user.id)
      res.setHeader('Set-Cookie', cookieHeader('', 0))
      send(res, 200, { ok: true })
    },
  }

  async function handle(req, res) {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const path = new URL(req.url, 'http://x').pathname.replace(/^\/hanzi/, '')
    const route = routes[`${req.method} ${path}`]
    if (!route) return send(res, 404, { error: 'not found' })
    let body = null
    if (req.method === 'POST') {
      // CSRF: require a custom header (cross-site forms can't send it, and we never answer CORS preflights)
      if (req.headers['x-hanzi'] !== '1') return send(res, 403, { error: 'missing X-Hanzi header' })
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'JSON only' })
      try {
        body = JSON.parse(await readBody(req))
      } catch (e) {
        return send(res, e.message === 'too large' ? 413 : 400, { error: e.message === 'too large' ? 'Request too large' : 'Invalid JSON' })
      }
    }
    await route(req, res, body, currentUser(req))
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e)
      if (!res.headersSent) send(res, 500, { error: 'server error' })
    })
  })
  server.on('close', () => db.close())
  return server
}

const publicUser = (u) => ({ username: u.username, created: u.created, resetAt: u.reset_at })
const ip = (req) => String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim()

function send(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
