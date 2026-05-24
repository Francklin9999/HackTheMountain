export function hapticReveal(): void {
  if ('vibrate' in navigator) {
    navigator.vibrate([100, 50, 200, 50, 100])
  }
}

export function hapticTap(): void {
  if ('vibrate' in navigator) {
    navigator.vibrate(30)
  }
}
