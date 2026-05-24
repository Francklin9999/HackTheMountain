import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/appStore'
import ShareButton from '../components/ShareButton'
import RehumButton from '../components/RehumButton'
import Waveform from '../components/Waveform'
import { hapticReveal } from '../utils/haptic'
import { hasAudioLoaded, pauseAudio, playAudio, resumeAudio, stopAudio } from '../audio/player'
import { speak, cancelNarration } from '../utils/narrate'
import { Play, Pause, GitBranch, ArrowLeft, Network } from 'lucide-react'

export default function RevealScreen() {
  const { currentMatch, setAppState, setAudioPlaying, audioPlaying, reset } = useAppStore()
  const [visible, setVisible] = useState(false)
  const [audioStarted, setAudioStarted] = useState(false)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const [interactiveMotion, setInteractiveMotion] = useState(false)
  const [photoError, setPhotoError] = useState(false)
  const hapticFired = useRef(false)
  const narratedFor = useRef<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)')
    const syncMotionMode = () => setInteractiveMotion(media.matches)

    syncMotionMode()
    media.addEventListener('change', syncMotionMode)
    return () => media.removeEventListener('change', syncMotionMode)
  }, [])

  useEffect(() => {
    if (!currentMatch) return

    hapticFired.current = false
    cancelNarration()
    const resetFrameId = window.requestAnimationFrame(() => {
      setAudioStarted(false)
      setVisible(false)
      setTilt({ x: 0, y: 0 })
      setPhotoError(false)
    })
    const timeoutId = window.setTimeout(() => setVisible(true), 120)

    const tryPlay = async () => {
      try {
        await playAudio(currentMatch.track.audio_url, () => setAudioPlaying(false))
        setAudioPlaying(true)
        setAudioStarted(true)
        if (!hapticFired.current) {
          hapticFired.current = true
          hapticReveal()
        }
      } catch {
        setAudioPlaying(false)
      }
    }

    void tryPlay()

    return () => {
      window.cancelAnimationFrame(resetFrameId)
      window.clearTimeout(timeoutId)
      stopAudio()
      cancelNarration()
      setAudioPlaying(false)
    }
  }, [currentMatch, setAudioPlaying])

  useEffect(() => {
    if (!currentMatch || !audioStarted) return
    const key = `${currentMatch.artist.id}:${currentMatch.track.id}`
    if (narratedFor.current === key) return

    const timeoutId = window.setTimeout(() => {
      narratedFor.current = key
      speak(
        `${currentMatch.artist.name}, born ${currentMatch.artist.born}. ${currentMatch.connection.explanation}`,
        { volume: 0.5, rate: 0.92 },
      )
    }, 1100)

    return () => window.clearTimeout(timeoutId)
  }, [audioStarted, currentMatch])

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!interactiveMotion) return

    const element = containerRef.current
    if (!element) return
    const bounds = element.getBoundingClientRect()
    const dx = (event.clientX - bounds.left - bounds.width / 2) / (bounds.width / 2)
    const dy = (event.clientY - bounds.top - bounds.height / 2) / (bounds.height / 2)
    setTilt({ x: dy * 4, y: -dx * 6 })
  }

  if (!currentMatch) return null

  const { artist, track, connection } = currentMatch
  const scoreInt = Math.round(connection.score * 100)
  const trackDuration = `${Math.floor(track.duration_s / 60)}:${String(track.duration_s % 60).padStart(2, '0')}`
  const artistFacts = [
    `${artist.born}-${artist.died}`,
    artist.region,
    `${scoreInt}% affinity`,
  ]

  const handlePlaybackToggle = async () => {
    if (audioPlaying) {
      pauseAudio()
      setAudioPlaying(false)
      return
    }

    try {
      if (hasAudioLoaded()) {
        await resumeAudio()
      } else {
        await playAudio(track.audio_url, () => setAudioPlaying(false))
      }
      setAudioPlaying(true)
      setAudioStarted(true)
    } catch {
      setAudioPlaying(false)
    }
  }

  return (
    <div
      ref={containerRef}
      className={`reveal-screen${interactiveMotion ? ' reveal-screen--interactive' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setTilt({ x: 0, y: 0 })}
    >
      <div
        className="reveal-screen__backdrop"
        style={{
          backgroundImage: artist.photo_url && !photoError ? `url(${artist.photo_url})` : undefined,
          transform: `scale(1.08) translate(${tilt.y * 3}px, ${tilt.x * 3}px)`,
        }}
      />
      <div className="reveal-screen__scrim" />

      <div
        className={`reveal-screen__frame${visible ? ' is-visible' : ''}`}
        style={interactiveMotion ? { transform: `rotateX(${2 + tilt.x}deg) rotateY(${-5 + tilt.y}deg)` } : undefined}
      >
        <aside className="reveal-screen__panel">
          <div className="reveal-screen__panel-top">
            <div>
              <p className="reveal-screen__brand">Sillon</p>
              <p className="reveal-screen__brand-subtitle">Québec Sound Archive</p>
            </div>

            <div className="reveal-screen__tool-row">
              <ToolBtn
                label="Back to start"
                onClick={() => {
                  stopAudio()
                  cancelNarration()
                  reset()
                }}
              >
                <ArrowLeft size={16} />
              </ToolBtn>
              <ToolBtn label="Explore lineage" onClick={() => setAppState('exploring')}>
                <GitBranch size={16} />
              </ToolBtn>
              <ToolBtn label="Open graph" onClick={() => setAppState('graph')}>
                <Network size={16} />
              </ToolBtn>
            </div>
          </div>

          <div className="reveal-screen__score-block">
            <p className="reveal-screen__section-label">Signal match</p>
            <ScoreBar score={connection.score} />
          </div>

          <div className="reveal-screen__identity">
            <span className="reveal-screen__identity-kicker">{artist.era} · Identified</span>
            <h2 className="reveal-screen__artist-name">{artist.name}</h2>
            <div className="reveal-screen__identity-meta">
              {artistFacts.map((fact) => (
                <span key={fact}>{fact}</span>
              ))}
            </div>
          </div>

          <blockquote className="reveal-screen__quote">{connection.explanation}</blockquote>

          {connection.shared_features.length > 0 && (
            <div className="reveal-screen__feature-chips">
              {connection.shared_features.map((feature) => (
                <span key={feature} className="reveal-screen__feature-chip">
                  {feature}
                </span>
              ))}
            </div>
          )}

          <div className="reveal-screen__archive-copy">
            <p className="reveal-screen__section-label">Archive record</p>
            <p className="reveal-screen__bio">{artist.bio}</p>
          </div>

          {artist.source_url && (
            <a
              href={artist.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="reveal-screen__source"
            >
              ↗ {artist.source_label || 'Verify source'}
            </a>
          )}

          <div className="reveal-screen__panel-actions">
            <div className="reveal-screen__action-group">
              <ShareButton artist={artist} />
              <button
                type="button"
                className="reveal-action-btn"
                onClick={() => setAppState('exploring')}
              >
                Explore lineage
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>

            <div className="reveal-screen__rehum">
              <RehumButton />
              <button
                type="button"
                className="reveal-screen__text-action"
                onClick={() => {
                  stopAudio()
                  cancelNarration()
                  reset()
                }}
              >
                Back to start
              </button>
            </div>
          </div>
        </aside>

        <section className="reveal-screen__visual">
          {photoError ? (
            <div
              className="reveal-screen__portrait-placeholder"
              style={{
                transform: interactiveMotion
                  ? `scale(1.04) translate(${-tilt.y * 1.5}px, ${-tilt.x * 1.5}px)`
                  : undefined,
              }}
            >
              <span className="reveal-screen__portrait-initials">
                {artist.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
            </div>
          ) : (
            <img
              src={artist.photo_url}
              alt={artist.name}
              className="reveal-screen__portrait"
              style={{
                transform: interactiveMotion
                  ? `scale(1.04) translate(${-tilt.y * 1.5}px, ${-tilt.x * 1.5}px)`
                  : undefined,
              }}
              onError={() => setPhotoError(true)}
            />
          )}
          <div className="reveal-screen__visual-fade reveal-screen__visual-fade--side" />
          <div className="reveal-screen__visual-fade reveal-screen__visual-fade--bottom" />

          <div className="reveal-screen__match-badge">{scoreInt}% match</div>

          <div className="reveal-screen__headline">
            <p className="reveal-screen__headline-meta">{artist.era} · {artist.region}</p>
            <h2 className="reveal-screen__headline-title">{artist.name}</h2>
          </div>

          <div className="reveal-screen__player">
            <button
              type="button"
              className={`reveal-screen__player-toggle${audioPlaying ? ' is-playing' : ''}`}
              onClick={() => { void handlePlaybackToggle() }}
            >
              {audioPlaying
                ? <Pause size={16} color="oklch(0.07 0.006 60)" />
                : <Play size={16} color="rgba(255,255,255,0.88)" style={{ marginLeft: 2 }} />
              }
            </button>

            <div className="reveal-screen__player-copy">
              <p className="reveal-screen__player-title">{track.title}</p>
              <p className="reveal-screen__player-meta">{track.year} · {trackDuration}</p>
            </div>

            {audioStarted && (
              <div className="reveal-screen__player-waveform">
                <Waveform playing={audioPlaying} color="rgba(255,255,255,0.6)" />
              </div>
            )}

            <div className="reveal-screen__player-divider" />

            <div className="reveal-screen__player-score">
              <strong>{scoreInt}%</strong>
              <span>match</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function ScoreBar({ score }: { score: number }) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setWidth(Math.round(score * 100)), 400)
    return () => window.clearTimeout(timeoutId)
  }, [score])

  return (
    <div className="reveal-screen__scorebar">
      <div className="reveal-screen__scorebar-track">
        <div
          className="reveal-screen__scorebar-fill"
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="reveal-screen__scorebar-value">{Math.round(score * 100)}%</span>
    </div>
  )
}

function ToolBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="reveal-screen__tool-btn"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}
