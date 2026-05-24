import { create } from 'zustand'
import type { MatchResponse, ArtistResponse } from '../types/api'

export type AppState = 'start' | 'idle' | 'listening' | 'searching' | 'revealed' | 'exploring' | 'graph'

export interface DiscoveryEntry {
  id: string
  name: string
  photo_url: string
  year: number
  score: number
}

interface AppStore {
  appState: AppState
  currentMatch: MatchResponse | null
  currentArtist: ArtistResponse | null
  audioPlaying: boolean
  micVolume: number
  history: DiscoveryEntry[]
  setAppState: (s: AppState) => void
  setMatch: (m: MatchResponse) => void
  setCurrentArtist: (a: ArtistResponse) => void
  setAudioPlaying: (v: boolean) => void
  setMicVolume: (v: number) => void
  pushDiscovery: (e: DiscoveryEntry) => void
  reset: () => void
}

export const useAppStore = create<AppStore>((set) => ({
  appState: 'start',
  currentMatch: null,
  currentArtist: null,
  audioPlaying: false,
  micVolume: 0,
  history: [],

  setAppState: (s) => set({ appState: s }),
  setMatch: (m) => set({ currentMatch: m }),
  setCurrentArtist: (a) => set({ currentArtist: a }),
  setAudioPlaying: (v) => set({ audioPlaying: v }),
  setMicVolume: (v) => set({ micVolume: v }),
  pushDiscovery: (e) => set((state) => {
    const without = state.history.filter((h) => h.id !== e.id)
    return { history: [e, ...without].slice(0, 8) }
  }),
  reset: () => set({
    appState: 'idle',
    currentMatch: null,
    currentArtist: null,
    audioPlaying: false,
    micVolume: 0,
  }),
}))

if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__appStore = useAppStore
}
