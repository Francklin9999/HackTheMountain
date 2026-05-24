export interface MicSession {
  stream: MediaStream
  analyser: AnalyserNode
  recorder: MediaRecorder
  chunks: Blob[]
  stop: () => Promise<Blob>
  getVolume: () => number
}

export async function startMicSession(): Promise<MicSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })

  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  source.connect(analyser)

  const buf = new Uint8Array(analyser.frequencyBinCount)

  const getVolume = (): number => {
    analyser.getByteFrequencyData(buf)
    const avg = buf.reduce((s, v) => s + v, 0) / buf.length
    return Math.min(avg / 128, 1)
  }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm')
    ? 'audio/webm'
    : 'audio/mp4'

  const recorder = new MediaRecorder(stream, { mimeType })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
  recorder.start(100)

  const stop = (): Promise<Blob> =>
    new Promise((resolve) => {
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        ctx.close()
        resolve(new Blob(chunks, { type: mimeType }))
      }
      recorder.stop()
    })

  return { stream, analyser, recorder, chunks, stop, getVolume }
}

export function requestGyroPermission(): Promise<void> {
  if (typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function') {
    return (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> })
      .requestPermission()
      .then(() => undefined)
  }
  return Promise.resolve()
}
