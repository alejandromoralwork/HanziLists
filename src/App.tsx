import { useEffect, useState } from 'react'
import { ensureDataset } from './db/loader'
import { useRoute } from './lib/hooks'
import { CATEGORIES, directionsFor, type Category, type Direction } from './types'
import { Dashboard } from './pages/Dashboard'
import { ListView } from './pages/ListView'
import { StudySession, StudyStart } from './pages/Study'
import { Settings } from './pages/Settings'

const isCat = (s?: string): s is Category => CATEGORIES.some((c) => c.id === s)

export function App() {
  const [loading, setLoading] = useState<string | null>('Opening your library…')
  const [error, setError] = useState<string | null>(null)
  const route = useRoute()

  useEffect(() => {
    ensureDataset(setLoading)
      .then(() => setLoading(null))
      .catch((e) => setError(String(e?.message ?? e)))
  }, [])

  const [page, a, b, c] = route
  let body: React.ReactNode
  if (error) body = <p className="py-20 text-center text-bad">Could not load the word lists: {error}</p>
  else if (loading) body = <p className="py-20 text-center text-ink-3">{loading}</p>
  else if (page === 'list' && isCat(a)) body = <ListView category={a} />
  else if (page === 'study' && isCat(a) && b && directionsFor(a).includes(b as Direction))
    body = <StudySession key={route.join('/')} category={a} direction={b as Direction} extra={Number(c) || 0} />
  else if (page === 'study' && isCat(a)) body = <StudyStart category={a} />
  else if (page === 'settings') body = <Settings />
  else body = <Dashboard />

  const inSession = page === 'study' && !!b
  return (
    <div className="min-h-screen bg-bg">
      {!inSession && (
        <header className="border-b border-line bg-surface/80 backdrop-blur">
          <nav className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-3 text-sm">
            <a href="#/" className="mr-3 flex items-center gap-2 font-semibold">
              <span className="han rounded-md bg-accent px-1.5 text-on-accent">字</span>
              HanziLists
            </a>
            <div className="flex flex-1 gap-1 overflow-x-auto">
              {CATEGORIES.map((cat) => (
                <a
                  key={cat.id}
                  href={`#/list/${cat.id}`}
                  className={`shrink-0 rounded-md px-2 py-1 hover:bg-surface-2 ${a === cat.id ? 'text-ink' : 'text-ink-3'}`}
                >
                  {cat.label}
                </a>
              ))}
            </div>
            <a href="#/settings" className={`rounded-md px-2 py-1 hover:bg-surface-2 ${page === 'settings' ? 'text-ink' : 'text-ink-3'}`} aria-label="Settings">
              ⚙
            </a>
          </nav>
        </header>
      )}
      <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8">{body}</main>
    </div>
  )
}
