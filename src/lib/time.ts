export const MIN = 60_000
export const DAY = 86_400_000

/** Local calendar day key, e.g. "2026-11-24". */
export const dayKey = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const startOfDay = (ts: number) => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export const endOfDay = (ts: number) => startOfDay(ts) + DAY - 1
