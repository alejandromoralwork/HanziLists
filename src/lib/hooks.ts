import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, setMeta } from '../db/schema'
import { DEFAULT_SETTINGS, type Settings } from '../types'

/** Minimal hash router: "#/list/verb" → ["list", "verb"]. */
export function useRoute(): string[] {
  const parse = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => {
      setRoute(parse())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const go = (path: string) => {
  window.location.hash = path
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const row = useLiveQuery(() => db.meta.get('settings'), [])
  const settings = { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) }
  return [settings, (patch) => void setMeta('settings', { ...settings, ...patch })]
}
