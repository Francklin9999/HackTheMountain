let audioEl: HTMLAudioElement | null = null
let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let sourceNode: MediaElementAudioSourceNode | null = null
let directGain: GainNode | null = null

let crackleSource: AudioBufferSourceNode | null = null
let crackleGain: GainNode | null = null

export function getAnalyser(): AnalyserNode | null {
  return analyser
}

function makeCrackleBuffer(ctx: AudioContext, seconds = 4): AudioBuffer {
  const sampleRate = ctx.sampleRate
  const length = Math.floor(seconds * sampleRate)
  const buf = ctx.createBuffer(1, length, sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < length; i++) {
    const hiss = (Math.random() * 2 - 1) * 0.08
    const pop = Math.random() < 0.002 ? (Math.random() * 2 - 1) * 0.85 : 0
    data[i] = hiss + pop
  }
  return buf
}

function startCrackle(level: number) {
  if (!audioCtx) return
  stopCrackle()

  crackleGain = audioCtx.createGain()
  crackleGain.gain.value = 0

  const bandpass = audioCtx.createBiquadFilter()
  bandpass.type = 'bandpass'
  bandpass.frequency.value = 3000
  bandpass.Q.value = 0.6

  crackleSource = audioCtx.createBufferSource()
  crackleSource.buffer = makeCrackleBuffer(audioCtx)
  crackleSource.loop = true

  crackleSource.connect(bandpass)
  bandpass.connect(crackleGain)
  crackleGain.connect(audioCtx.destination)

  crackleSource.start()

  const now = audioCtx.currentTime
  crackleGain.gain.setValueAtTime(0, now)
  crackleGain.gain.linearRampToValueAtTime(0.55, now + 0.05)
  crackleGain.gain.linearRampToValueAtTime(level, now + 1.5)
}

function stopCrackle() {
  if (crackleSource) {
    try { crackleSource.stop() } catch { /* already stopped */ }
    crackleSource.disconnect()
    crackleSource = null
  }
  if (crackleGain) {
    crackleGain.disconnect()
    crackleGain = null
  }
}

export async function playAudio(url: string, onEnd?: () => void): Promise<void> {
  stopAudio()

  audioEl = new Audio(url)
  audioEl.crossOrigin = 'anonymous'
  audioEl.preload = 'auto'

  audioCtx = new AudioContext()
  analyser = audioCtx.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.8

  sourceNode = audioCtx.createMediaElementSource(audioEl)

  directGain = audioCtx.createGain()
  directGain.gain.value = 1

  sourceNode.connect(directGain)
  directGain.connect(analyser)
  analyser.connect(audioCtx.destination)

  audioEl.onended = () => onEnd?.()

  startCrackle(0.05)

  await audioEl.play()
}

export async function resumeAudio(): Promise<boolean> {
  if (!audioEl) return false
  if (audioEl.ended) {
    audioEl.currentTime = 0
  }
  await audioEl.play()
  return true
}

export function pauseAudio(): boolean {
  if (!audioEl) return false
  audioEl.pause()
  return true
}

export function hasAudioLoaded(): boolean {
  return Boolean(audioEl)
}

export function stopAudio(): void {
  if (audioEl) {
    audioEl.pause()
    audioEl.onended = null
    audioEl = null
  }
  stopCrackle()
  if (sourceNode) {
    sourceNode.disconnect()
    sourceNode = null
  }
  if (directGain) { directGain.disconnect(); directGain = null }
  if (analyser) {
    analyser.disconnect()
    analyser = null
  }
  if (audioCtx) {
    audioCtx.close()
    audioCtx = null
  }
}
