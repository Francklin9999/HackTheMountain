import { useEffect, useState } from 'react'
import { useAppStore } from '../state/appStore'
import { getArtist } from '../api/artists'
import ExploreGraph from '../components/ExploreGraph'
import ArtistCard from '../components/ArtistCard'
import ShareButton from '../components/ShareButton'
import ScreenLoader from '../components/ScreenLoader'
import { playAudio, stopAudio } from '../audio/player'
import type { ArtistResponse } from '../types/api'

export default function ExploreScreen() {
  const { currentMatch, currentArtist, setCurrentArtist, setAppState, reset } = useAppStore()
  const [loading, setLoading] = useState(false)
  const [audioPlaying, setAudioPlaying] = useState(false)

  const artistData: ArtistResponse | null = currentArtist ?? (currentMatch ? {
    artist: currentMatch.artist,
    related: [],
    tracks: [currentMatch.track],
  } : null)

  const loadArtist = async (id: string) => {
    setLoading(true)
    try {
      const data = await getArtist(id)
      setCurrentArtist(data)
    } catch {
      // Stay on the current artist context.
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (currentMatch && !currentArtist) {
      const frameId = window.requestAnimationFrame(() => {
        void loadArtist(currentMatch.artist.id)
      })
      return () => window.cancelAnimationFrame(frameId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlayTrack = async (audioUrl: string) => {
    if (audioPlaying) {
      stopAudio()
      setAudioPlaying(false)
      return
    }

    try {
      await playAudio(audioUrl, () => setAudioPlaying(false))
      setAudioPlaying(true)
    } catch {
      setAudioPlaying(false)
    }
  }

  useEffect(() => () => { stopAudio() }, [])

  if (!artistData) {
    return (
      <div className="screen-empty screen-empty--rich">
        <p className="screen-empty__label">No artist selected</p>
        <p className="screen-empty__copy">
          Start with a hum, a description, or a song link to open an artist dossier.
        </p>
        <button className="screen-empty__action" onClick={() => useAppStore.getState().setAppState('idle')}>
          Start listening
        </button>
      </div>
    )
  }

  const { artist, related, tracks } = artistData
  const matchTrack = currentMatch?.track ?? tracks[0]
  const connection = currentMatch?.connection ?? { score: 0, explanation: '', shared_features: [] }

  return (
    <div className="explore-screen">
      <div className="explore-screen__toolbar">
        <div className="explore-screen__toolbar-inner">
          <button
            type="button"
            className="explore-screen__back"
            onClick={() => {
              stopAudio()
              setAppState('revealed')
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to reveal
          </button>

          <div className="explore-screen__toolbar-copy">
            <span className="explore-screen__eyebrow">Archive lineage</span>
            <strong>{artist.name}</strong>
          </div>

          <div className="explore-screen__toolbar-actions">
            <ShareButton artist={artist} />
          </div>
        </div>
      </div>

      {loading && <ScreenLoader />}

      {!loading && (
        <div className="explore-layout explore-layout--screen">
          <aside className="explore-screen__sidebar">
            <ArtistCard
              artist={artist}
              track={matchTrack}
              connection={connection}
              visible={true}
            />

            <button
              type="button"
              className="explore-screen__reset"
              onClick={reset}
            >
              Listen again
            </button>
          </aside>

          <section className="explore-screen__content">
            {tracks.length > 0 && (
              <div className="explore-screen__section">
                <div className="explore-screen__section-heading">
                  <p className="explore-screen__section-label">Recovered recordings</p>
                  <p className="explore-screen__section-copy">
                    Tap a track to hear the voice that anchors this dossier.
                  </p>
                </div>

                <div className="explore-screen__track-list">
                  {tracks.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={`explore-screen__track-card${audioPlaying ? ' is-playing' : ''}`}
                      onClick={() => { void handlePlayTrack(entry.audio_url) }}
                    >
                      <div className="explore-screen__track-copy">
                        <p className="explore-screen__track-title">{entry.title}</p>
                        <p className="explore-screen__track-meta">{entry.year}</p>
                      </div>

                      <span className="explore-screen__track-icon" aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {related.length > 0 && (
              <div className="explore-screen__section">
                <div className="explore-screen__section-heading">
                  <p className="explore-screen__section-label">Nearby voices</p>
                  <p className="explore-screen__section-copy">
                    Move laterally through the archive without losing your place.
                  </p>
                </div>

                <ExploreGraph related={related} onSelect={(id) => { void loadArtist(id) }} />
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
