import { useEffect, useRef, useState } from 'react'
import type { Artist, Connection, Track } from '../types/api'

interface Props {
  artist: Artist
  track: Track
  connection: Connection
  visible: boolean
  audioStarted?: boolean
}

function useCountUp(target: number, duration: number, active: boolean): number {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number>(0)
  const startRef = useRef<number>(0)

  useEffect(() => {
    if (!active) {
      const resetId = requestAnimationFrame(() => setValue(0))
      return () => cancelAnimationFrame(resetId)
    }

    startRef.current = performance.now()
    const tick = (now: number) => {
      const elapsed = now - startRef.current
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(eased * target))
      if (progress < 1) rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [active, duration, target])

  return value
}

function useTypewriter(text: string, charDelay: number, startDelay: number, active: boolean): string {
  const [displayed, setDisplayed] = useState('')

  useEffect(() => {
    if (!active) {
      const resetId = window.setTimeout(() => setDisplayed(''), 0)
      return () => window.clearTimeout(resetId)
    }

    let cancelled = false
    let charIndex = 0
    const startTimer = window.setTimeout(() => {
      const intervalId = window.setInterval(() => {
        if (cancelled) {
          window.clearInterval(intervalId)
          return
        }

        charIndex += 1
        setDisplayed(text.slice(0, charIndex))
        if (charIndex >= text.length) window.clearInterval(intervalId)
      }, charDelay)
    }, startDelay)

    return () => {
      cancelled = true
      window.clearTimeout(startTimer)
    }
  }, [active, charDelay, startDelay, text])

  return displayed
}

interface BreakdownRowProps {
  label: string
  sublabel?: string
  value: number
  active: boolean
  delay: number
}

function BreakdownRow({ label, sublabel, value, active, delay }: BreakdownRowProps) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (!active) {
      const resetId = window.setTimeout(() => setWidth(0), 0)
      return () => window.clearTimeout(resetId)
    }

    const timeoutId = window.setTimeout(() => setWidth(Math.round(value * 100)), delay)
    return () => window.clearTimeout(timeoutId)
  }, [active, delay, value])

  return (
    <div className="artist-card__breakdown-row">
      <div className="artist-card__breakdown-head">
        <span className="artist-card__breakdown-label">{label}</span>
        {sublabel && <span className="artist-card__breakdown-sublabel">{sublabel}</span>}
      </div>

      <div className="artist-card__breakdown-track">
        <div className="artist-card__breakdown-fill" style={{ width: `${width}%` }} />
      </div>

      <div className="artist-card__breakdown-value">{value.toFixed(2)}</div>
    </div>
  )
}

export default function ArtistCard({ artist, track, connection, visible, audioStarted = false }: Props) {
  const scoreTarget = Math.round(connection.score * 100)
  const animatedScore = useCountUp(scoreTarget, 1200, visible)
  const typewrittenExplanation = useTypewriter(connection.explanation, 28, 800, audioStarted)

  const breakdown = connection.breakdown
  const keySub = connection.key_label || ''
  const tempoSub = connection.tempo_bpm ? `${Math.round(connection.tempo_bpm)} bpm` : ''
  const contourSub = connection.contour_label || ''
  const modeSub = connection.mode_label ? `· ${connection.mode_label}` : ''

  return (
    <div
      className={`artist-card${visible ? ' is-visible' : ''}`}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(16px)',
      }}
    >
      <div className="artist-card__scorehead">
        <span className="artist-card__scorehead-label">Archive match</span>
        <div className="artist-card__scorehead-line" />
        <span className="artist-card__scorehead-value">{animatedScore}%</span>
      </div>

      <div className="artist-card__identity">
        <h2 className="artist-card__title">{artist.name}</h2>
        <p className="artist-card__meta">{artist.born}–{artist.died} · {artist.region}</p>
      </div>

      <div className="artist-card__surface">
        <p className="artist-card__surface-label">Recovered recording</p>
        <p className="artist-card__surface-title">
          {track.title} <span>— {track.year}</span>
        </p>
      </div>

      {breakdown && (
        <div className="artist-card__breakdown">
          <div className="artist-card__breakdown-top">
            <p className="artist-card__breakdown-title">Alignment record</p>
            <p className="artist-card__breakdown-note">4-signal blend</p>
          </div>

          <div className="artist-card__breakdown-list">
            <BreakdownRow label="Vibe" sublabel="MERT 768d" value={breakdown.vibe} active={visible} delay={300} />
            <BreakdownRow label="Key" sublabel={`${keySub} ${modeSub}`.trim()} value={breakdown.key} active={visible} delay={450} />
            <BreakdownRow label="Tempo" sublabel={tempoSub} value={breakdown.tempo} active={visible} delay={600} />
            <BreakdownRow label="Contour" sublabel={contourSub} value={breakdown.contour} active={visible} delay={750} />
          </div>

          <p className="artist-card__breakdown-weights">weights: 0.50 vibe · 0.20 key · 0.15 tempo · 0.15 contour</p>
        </div>
      )}

      <div className="artist-card__chips">
        {connection.shared_features.map((feature) => (
          <span key={feature} className="artist-card__chip">
            {feature}
          </span>
        ))}
      </div>

      <div className="artist-card__quote">
        <p>
          "{typewrittenExplanation || (audioStarted ? '' : connection.explanation)}"
          {audioStarted && typewrittenExplanation.length < connection.explanation.length && (
            <span className="artist-card__cursor" />
          )}
        </p>
      </div>

      <p className="artist-card__bio">{artist.bio}</p>

      {artist.source_url && (
        <a
          href={artist.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="artist-card__source"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M7 17l10-10M9 7h8v8" />
          </svg>
          Verify · {artist.source_label || 'Source'}
        </a>
      )}
    </div>
  )
}
