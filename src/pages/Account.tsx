import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { ApiError, signIn, signOut, syncNow, useSyncStatus } from '../sync/sync'
import { Button } from '../components/ui'

const ago = (ts: number) => {
  if (!ts) return 'never'
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(ts).toLocaleString()
}

export function Account() {
  const st = useSyncStatus()
  return <div className="mx-auto max-w-md">{st.username ? <SignedIn /> : <SignInForm />}</div>
}

function SignInForm() {
  const st = useSyncStatus()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const local = useLiveQuery(() => db.reviews.count(), [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(username.trim(), password, mode === 'register')
      window.location.hash = '/'
    } catch (err) {
      setError((err as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-accent'
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold">{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
      <p className="mb-6 text-sm text-ink-3">
        Sign in to save your progress and card edits, and to continue on any device. You can still study without an account; progress then stays in this browser only.
      </p>
      {st.error && <p className="mb-4 rounded-lg bg-warn/10 p-3 text-sm text-warn">{st.error}</p>}
      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-5">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-3" htmlFor="u">
            Username
          </label>
          <input id="u" className={field} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_.\-]+" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-3" htmlFor="p">
            Password {mode === 'register' && <span className="font-normal">(at least 8 characters)</span>}
          </label>
          <input
            id="p"
            type="password"
            className={field}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 8 : 1}
          />
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
        {!!local && (
          <p className="text-xs text-ink-3">The {local.toLocaleString()} reviews already on this device will be merged into the account.</p>
        )}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-ink-3">
        {mode === 'login' ? 'New here? ' : 'Already have an account? '}
        <button className="text-accent underline-offset-4 hover:underline" onClick={() => (setMode(mode === 'login' ? 'register' : 'login'), setError(null))}>
          {mode === 'login' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </>
  )
}

function SignedIn() {
  const st = useSyncStatus()
  const pending = useLiveQuery(() => db.outbox.count(), [])
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function out(force: boolean) {
    setError(null)
    try {
      await signOut(force)
    } catch (e) {
      setError((e as Error).message)
      setConfirm(true)
    }
  }

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Account</h1>
      <section className="space-y-3 rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-3">Signed in as</span>
          <span className="font-medium">{st.username}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-3">Last synced</span>
          <span>{st.phase === 'syncing' ? 'syncing…' : ago(st.lastSyncAt)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-3">Changes waiting to upload</span>
          <span className="tabular-nums">{pending ?? '–'}</span>
        </div>
        {st.error && <p className="text-sm text-warn">{st.error}</p>}
        <Button onClick={() => void syncNow()} disabled={st.phase === 'syncing'}>
          Sync now
        </Button>
      </section>

      <section className="mt-6 space-y-3 rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-medium">Sign out</h2>
        <p className="text-sm text-ink-3">Your progress stays in your account. This device is cleared so the next person starts fresh.</p>
        {error && <p className="text-sm text-bad">{error}. Sign out anyway and lose them?</p>}
        {confirm ? (
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => out(true)}>
              Sign out anyway
            </Button>
            <Button variant="ghost" onClick={() => (setConfirm(false), setError(null))}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button onClick={() => out(false)}>Sign out</Button>
        )}
      </section>
    </>
  )
}
