import type { Artist } from '../types/api'

export async function shareArtist(artist: Artist): Promise<void> {
  if (navigator.share) {
    await navigator.share({
      title: `Sillon — ${artist.name}`,
      text: `I discovered ${artist.name} (${artist.born}–${artist.died}), a forgotten Quebec musician from ${artist.era}. Listen via Sillon.`,
      url: window.location.href,
    })
  }
}
