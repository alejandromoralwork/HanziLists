// Entry point: node server/index.mjs
//   HANZI_PORT   (default 4620, listens on 127.0.0.1 only; Caddy proxies /hanzi/api/*)
//   HANZI_DB     (default server/data/hanzi.db)
//   HANZI_SIGNUP (open | closed, default open)
//   HANZI_INSECURE_COOKIE=1 for plain-http local dev
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createApp } from './app.mjs'

const port = Number(process.env.HANZI_PORT ?? 4620)
const dbPath = process.env.HANZI_DB ?? new URL('./data/hanzi.db', import.meta.url).pathname
mkdirSync(dirname(dbPath), { recursive: true })

const server = createApp({ dbPath, signup: process.env.HANZI_SIGNUP ?? 'open', secureCookie: process.env.HANZI_INSECURE_COOKIE !== '1' })
server.listen(port, '127.0.0.1', () => console.log(`hanzilists api on 127.0.0.1:${port} (db ${dbPath})`))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)))
