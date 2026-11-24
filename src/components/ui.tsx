import type { ReactNode } from 'react'
import { canSpeak, speak } from '../lib/speech'
import type { Status } from '../types'

const TONE_CLASS = ['text-ink-3', 'text-tone1', 'text-tone2', 'text-tone3', 'text-tone4']
const toneOf = (syl: string) => {
  const d = syl.normalize('NFD')
  if (/̄/.test(d)) return 1
  if (/́/.test(d)) return 2
  if (/̌/.test(d)) return 3
  if (/̀/.test(d)) return 4
  return 0
}

/** Pinyin with each syllable tinted by tone (colour is a hint, never the only cue: marks stay). */
export function Pinyin({ text, className = '' }: { text: string; className?: string }) {
  const parts = text.split(/(\s+|,\s*)/)
  return (
    <span className={className}>
      {parts.map((p, i) => (
        <span key={i} className={TONE_CLASS[toneOf(p)]}>
          {p}
        </span>
      ))}
    </span>
  )
}

export function RankBadge({ rank }: { rank: number }) {
  return (
    <span className="rounded-full border border-line px-2 py-0.5 text-xs tabular-nums text-ink-3" title="Frequency rank within this list (1 = most frequent)">
      #{rank}
    </span>
  )
}

const STATUS_STYLE: Record<Status, string> = {
  new: 'bg-surface-2 text-ink-3',
  learning: 'bg-warn/15 text-warn',
  review: 'bg-accent/15 text-accent',
  mastered: 'bg-good/15 text-good',
}
export const STATUS_LABEL: Record<Status, string> = { new: 'New', learning: 'Learning', review: 'Review', mastered: 'Mastered' }

export function StatusPill({ status }: { status: Status }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
}

export function SpeakButton({ text, className = '' }: { text: string; className?: string }) {
  if (!canSpeak()) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        speak(text)
      }}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink ${className}`}
      aria-label={`Play pronunciation of ${text}`}
      title="Listen"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5 6 9H2v6h4l5 4V5z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
      </svg>
    </button>
  )
}

export function Button({
  children,
  variant = 'default',
  className = '',
  ...rest
}: { children: ReactNode; variant?: 'default' | 'primary' | 'ghost' | 'danger' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const v = {
    default: 'border border-line bg-surface hover:bg-surface-2',
    primary: 'bg-accent text-on-accent hover:opacity-90',
    ghost: 'hover:bg-surface-2',
    danger: 'border border-bad/40 text-bad hover:bg-bad/10',
  }[variant]
  return (
    <button {...rest} className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-40 ${v} ${className}`}>
      {children}
    </button>
  )
}

export function Bar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-2 ${className}`}>
      <div className="h-full rounded-full bg-good transition-all" style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  )
}
