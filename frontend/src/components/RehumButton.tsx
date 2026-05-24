import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/appStore'
import { startMicSession } from '../audio/mic'
import type { MicSession } from '../audio/mic'
import { postMatch } from '../api/match'
import { stopAudio } from '../audio/player'

type Mode = 'idle' | 'listening' | 'matching'

export default function RehumButton() {
  const { setMatch, pushDiscovery, setAudioPlaying } = useAppStore()
  const [mode, setMode] = useState<Mode>('idle')
  const sessionRef = useRef<MicSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => () => { sessionRef.current?.stop() }, [])

  const handle = async () => {
    if (mode === 'matching') return

    if (mode === 'listening') {
      if (!sessionRef.current) return
      setMode('matching')
      const blob = await sessionRef.current.stop()
      sessionRef.current = null
      stopAudio()
      setAudioPlaying(false)

      try {
        const match = await postMatch(blob)
        setMatch(match)
        pushDiscovery({
          id: match.artist.id,
          name: match.artist.name,
          photo_url: match.artist.photo_url,
          year: match.track.year,
          score: match.connection.score,
        })
      } catch {
        setError('Match failed.')
        window.setTimeout(() => setError(null), 2500)
      }

      setMode('idle')
      return
    }

    setError(null)
    try {
      const session = await startMicSession()
      sessionRef.current = session
      setMode('listening')
    } catch {
      setError('Microphone denied.')
      window.setTimeout(() => setError(null), 2500)
    }
  }

  const label = mode === 'listening' ? 'Tap to stop & search' : mode === 'matching' ? 'Tracing…' : 'Listen again'

  return (
    <div className="rehum-button">
      <button
        type="button"
        onClick={() => { void handle() }}
        disabled={mode === 'matching'}
        className={`rehum-button__control is-${mode}`}
        aria-label={label}
      >
        {mode === 'listening' ? (
          <span className="rehum-button__stop" />
        ) : mode === 'matching' ? (
          <span className="rehum-button__spinner" />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="9" y="2" width="6" height="11" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="9" y1="22" x2="15" y2="22" />
          </svg>
        )}
      </button>

      <p className={`rehum-button__label is-${mode}`}>{label}</p>

      {error && <p className="rehum-button__error">{error}</p>}
    </div>
  )
}
