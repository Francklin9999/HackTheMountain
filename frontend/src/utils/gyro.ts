export interface GyroState { beta: number; gamma: number }

export function watchGyro(cb: (s: GyroState) => void): () => void {
  const handler = (e: DeviceOrientationEvent) => {
    cb({ beta: e.beta ?? 0, gamma: e.gamma ?? 0 })
  }
  window.addEventListener('deviceorientation', handler, true)
  return () => window.removeEventListener('deviceorientation', handler, true)
}
