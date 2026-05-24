import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useAppStore } from '../state/appStore'
import { startMicSession, requestGyroPermission } from '../audio/mic'
import { postMatch } from '../api/match'
import type { MicSession } from '../audio/mic'

export default function MicButton() {
  const { appState, setAppState, setMatch, setMicVolume, pushDiscovery } = useAppStore()
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef<MicSession | null>(null)
  const rafRef = useRef<number>(0)
  const processingRef = useRef(false)   // prevents overlapping async calls
  const isListening = appState === 'listening'

  const updateVolume = () => {
    if (sessionRef.current) {
      setMicVolume(sessionRef.current.getVolume())
      rafRef.current = requestAnimationFrame(updateVolume)
    }
  }

  const stopAndSearch = async () => {
    const session = sessionRef.current
    if (!session) return

    cancelAnimationFrame(rafRef.current)
    setMicVolume(0)
    sessionRef.current = null
    setAppState('searching')

    const blob = await session.stop()

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
      setAppState('revealed')
    } catch {
      setAppState('idle')
      setError('Match failed. Try again.')
      window.setTimeout(() => setError(null), 3000)
    }
  }

  const beginListening = async () => {
    setError(null)
    try {
      await requestGyroPermission()
      const session = await startMicSession()
      sessionRef.current = session
      setAppState('listening')
      rafRef.current = requestAnimationFrame(updateVolume)
    } catch {
      setError('Microphone access denied.')
    }
  }

  // Use sessionRef (ref, never stale) rather than isListening (closure, can be stale)
  // to decide start vs stop. processingRef prevents overlapping async calls.
  const handleClick = async () => {
    if (processingRef.current || appState === 'searching') return
    processingRef.current = true
    try {
      if (sessionRef.current) {
        await stopAndSearch()
      } else {
        await beginListening()
      }
    } finally {
      processingRef.current = false
    }
  }

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    await handleClick()
  }

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
      sessionRef.current?.stop()
    }
  }, [])

  if (appState === 'searching') return null

  const size = isListening ? 156 : 144

  return (
    <div className="mic-button">
      <div className="mic-button__halo">
        {isListening && <span className="mic-button__pulse" />}

        <button
          type="button"
          onClick={() => { void handleClick() }}
          onKeyDown={(event) => { void handleKeyDown(event) }}
          aria-label={isListening ? 'Stop recording' : 'Start humming'}
          className={`mic-button__control${isListening ? ' is-listening' : ''}`}
          style={{ '--mic-size': `${size}px` } as CSSProperties}
        >
          <span className="mic-button__inner-ring" />

          {isListening ? (
            <span className="mic-button__stop" />
          ) : (
            <MicIcon />
          )}
        </button>
      </div>

      <p className={`mic-button__label${isListening ? ' is-listening' : ''}`}>
        {isListening ? 'Click to stop' : 'Click to hum'}
      </p>

      {error && <p className="mic-button__error">{error}</p>}
    </div>
  )
}

function MicIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#d9e2ef" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="9" y1="22" x2="15" y2="22" />
    </svg>
  )
}
