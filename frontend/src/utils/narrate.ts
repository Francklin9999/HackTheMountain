function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null

  const ranked = [
    (v: SpeechSynthesisVoice) => v.lang === 'fr-CA',
    (v: SpeechSynthesisVoice) => v.lang?.startsWith('fr-CA'),
    (v: SpeechSynthesisVoice) => v.lang?.startsWith('fr'),
    (v: SpeechSynthesisVoice) => v.lang?.startsWith('en-CA'),
    (v: SpeechSynthesisVoice) => v.lang?.startsWith('en'),
  ]
  for (const test of ranked) {
    const hit = voices.find(test)
    if (hit) return hit
  }
  return voices[0] ?? null
}

export function speak(text: string, opts: { volume?: number; rate?: number; pitch?: number } = {}) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  try {
    cancelNarration()
    const utter = new SpeechSynthesisUtterance(text)
    const voice = pickVoice()
    if (voice) {
      utter.voice = voice
      utter.lang = voice.lang
    }
    utter.volume = opts.volume ?? 0.55
    utter.rate = opts.rate ?? 0.92
    utter.pitch = opts.pitch ?? 1.0
    window.speechSynthesis.speak(utter)
  } catch {
  }
}

export function cancelNarration() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  try {
    window.speechSynthesis.cancel()
  } catch { /* noop */ }
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices()
  }
}
