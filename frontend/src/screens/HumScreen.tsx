import { lazy, Suspense, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../state/appStore'
import MicButton from '../components/MicButton'
import { createAssistedMatch } from '../api/match'

const IdleScene = lazy<React.ComponentType<{ volume: number }>>(() =>
  import('../scenes/IdleScene').catch(() => ({ default: () => null as unknown as React.ReactElement }))
)

type AssistedMode = 'description' | 'link'

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
})

export default function HumScreen() {
  const { micVolume, backendAlive, appState, setMatch, pushDiscovery, setAppState } = useAppStore()
  const [description, setDescription] = useState('')
  const [songLink, setSongLink] = useState('')
  const [activeAssist, setActiveAssist] = useState<AssistedMode | null>(null)
  const [assistError, setAssistError] = useState<string | null>(null)

  const handleAssistedSubmit = async (mode: AssistedMode, rawValue: string) => {
    const value = rawValue.trim()
    if (!value) {
      setAssistError(mode === 'description' ? 'Add a few words about the melody.' : 'Paste a song link to continue.')
      return
    }

    setAssistError(null)
    setActiveAssist(mode)
    setAppState('searching')

    try {
      const match = await createAssistedMatch(mode, value)
      setMatch(match)
      pushDiscovery({
        id: match.artist.id,
        name: match.artist.name,
        photo_url: match.artist.photo_url,
        year: match.track.year,
        score: match.connection.score,
      })
      setAppState('revealed')
      if (mode === 'description') setDescription('')
      if (mode === 'link') setSongLink('')
    } catch {
      setAppState('idle')
      setAssistError('We could not trace that input right now.')
    } finally {
      setActiveAssist(null)
    }
  }

  return (
    <div className="hum-screen">
      <Suspense fallback={null}>
        <IdleScene volume={micVolume} />
      </Suspense>

      <div className="hum-screen__vignette" />
      <div className="hum-screen__grain" />

      <div className="hum-screen__layout">
        {/* Left: Mic column */}
        <div className="hum-screen__col--mic">
          <motion.div className="hum-screen__eyebrow-wrap" {...fadeUp(0.05)}>
            <p className="hum-screen__eyebrow">Archive Intake</p>
          </motion.div>

          <motion.div className="hum-screen__mic-wrap" {...fadeUp(0.15)}>
            <MicButton />
          </motion.div>
        </div>

        {/* Right: Title + stacked cards */}
        <div className="hum-screen__col--content">
          <motion.div className="hum-screen__hero" {...fadeUp(0.08)}>
            <h1 className="hum-screen__title">Sillon</h1>
            <p className="hum-screen__subtitle">
              Click to hum. Discover a forgotten Québec artist.
            </p>
          </motion.div>

          <div className="hum-screen__assist-stack">
            <motion.div {...fadeUp(0.18)}>
              <AssistCard
                primary
                title="Describe the song"
                hint="Tell us the mood, instruments, tempo, or a lyric fragment."
                actionLabel={activeAssist === 'description' || appState === 'searching' ? 'Tracing…' : 'Search by description'}
                disabled={activeAssist !== null || appState === 'searching'}
                value={description}
                placeholder="Melancholic fiddle tune, slow reel, feels homesick…"
                onChange={setDescription}
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleAssistedSubmit('description', description)
                }}
              />
            </motion.div>

            <motion.div {...fadeUp(0.26)}>
              <AssistCard
                title="Paste a song link"
                hint="YouTube, Spotify, SoundCloud, or an archive page."
                actionLabel={activeAssist === 'link' || appState === 'searching' ? 'Linking…' : 'Search by link'}
                disabled={activeAssist !== null || appState === 'searching'}
                value={songLink}
                placeholder="https://…"
                onChange={setSongLink}
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleAssistedSubmit('link', songLink)
                }}
              />
            </motion.div>
          </div>

          {(assistError || backendAlive === false) && (
            <motion.div className="hum-screen__footer" {...fadeUp(0.1)}>
              {assistError && <p className="hum-screen__error">{assistError}</p>}
              {backendAlive === false && <p className="hum-screen__status">backend offline</p>}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}

interface AssistCardProps {
  actionLabel: string
  disabled: boolean
  hint: string
  onChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  placeholder: string
  primary?: boolean
  title: string
  value: string
}

function AssistCard({
  actionLabel,
  disabled,
  hint,
  onChange,
  onSubmit,
  placeholder,
  primary,
  title,
  value,
}: AssistCardProps) {
  const inputId = `assist-${title.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <form
      className={`hum-screen__assist-card${primary ? ' hum-screen__assist-card--primary' : ''}`}
      onSubmit={onSubmit}
    >
      <div className="hum-screen__assist-copy">
        <label htmlFor={inputId} className="hum-screen__assist-title">{title}</label>
        <p className="hum-screen__assist-hint">{hint}</p>
      </div>

      <div className="hum-screen__assist-controls">
        <input
          id={inputId}
          className="hum-screen__input"
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
        <button className="hum-screen__assist-button" type="submit" disabled={disabled}>
          {actionLabel}
        </button>
      </div>
    </form>
  )
}

