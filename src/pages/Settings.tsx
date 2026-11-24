import { useRef, useState } from 'react'
import { exportBackup, importBackup, resetProgress } from '../db/backup'
import { useSettings } from '../lib/hooks'
import { Button } from '../components/ui'

export function Settings() {
  const [settings, update] = useSettings()
  const file = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  async function doExport() {
    const blob = await exportBackup()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `hanzilists-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    setMsg('Backup downloaded.')
  }

  async function doImport(f: File) {
    try {
      await importBackup(f)
      setMsg('Backup restored.')
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="space-y-4 rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-medium">Study</h2>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            New cards per day <span className="text-ink-3">(per list and direction)</span>
          </span>
          <input
            type="number"
            min={0}
            max={200}
            value={settings.newPerDay}
            onChange={(e) => update({ newPerDay: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })}
            className="w-20 rounded-lg border border-line px-2 py-1 text-right"
          />
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>Show pinyin on the front (Chinese → English)</span>
          <input type="checkbox" checked={settings.showPinyin} onChange={(e) => update({ showPinyin: e.target.checked })} className="h-4 w-4" />
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>Type answers before revealing</span>
          <input type="checkbox" checked={settings.typeAnswer} onChange={(e) => update({ typeAnswer: e.target.checked })} className="h-4 w-4" />
        </label>
      </section>

      <section className="space-y-3 rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-medium">Backup</h2>
        <p className="text-sm text-ink-3">
          Download everything as a JSON file, or restore one. When you are signed in, a restored backup is merged into your account.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={doExport}>Export backup</Button>
          <Button onClick={() => file.current?.click()}>Import backup…</Button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        </div>
        {msg && <p className="text-sm text-ink-2">{msg}</p>}
      </section>

      <section className="space-y-3 rounded-2xl border border-bad/30 bg-surface p-5">
        <h2 className="font-medium">Reset</h2>
        <p className="text-sm text-ink-3">Forget all study progress and history (on all your devices when signed in). Your cards and edits are kept.</p>
        {confirmReset ? (
          <div className="flex gap-2">
            <Button
              variant="danger"
              onClick={async () => {
                await resetProgress()
                setConfirmReset(false)
                setMsg('Progress reset.')
              }}
            >
              Yes, reset progress
            </Button>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirmReset(true)}>
            Reset progress
          </Button>
        )}
      </section>

      <section className="text-xs leading-relaxed text-ink-3">
        <p>
          Data: word lists and frequency ranks from{' '}
          <a className="underline" href="https://github.com/drkameleon/complete-hsk-vocabulary">complete-hsk-vocabulary</a> (MIT), character frequency from{' '}
          <a className="underline" href="https://github.com/ruddfawcett/hanziDB.csv">hanziDB</a> (Jun Da), example sentences from{' '}
          <a className="underline" href="https://tatoeba.org">Tatoeba</a> (CC BY 2.0 FR), definitions from CC-CEDICT.
        </p>
      </section>
    </div>
  )
}
