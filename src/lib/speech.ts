let voice: SpeechSynthesisVoice | null | undefined

function zhVoice() {
  if (voice !== undefined) return voice
  const voices = window.speechSynthesis?.getVoices() ?? []
  if (!voices.length) return null
  voice = voices.find((v) => /zh[-_]CN/i.test(v.lang)) ?? voices.find((v) => /^zh/i.test(v.lang)) ?? null
  return voice
}

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window

/** Speak Chinese text with the browser's built-in TTS (no server involved). */
export function speak(text: string) {
  if (!canSpeak()) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'zh-CN'
  u.rate = 0.85
  const v = zhVoice()
  if (v) u.voice = v
  window.speechSynthesis.speak(u)
}
