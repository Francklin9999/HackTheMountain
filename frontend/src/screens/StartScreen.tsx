import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../state/appStore'

const LANDING_STATS = [
  { label: 'Voices Preserved', value: 'Hundreds of forgotten souls' },
  { label: 'Era', value: '1900 - 1970' },
  { label: 'Origin', value: 'Quebec archives' },
]

const FEATURED_ARTISTS = [
  {
    id: 'joseph-allard',
    name: 'Joseph Allard',
    era: '1920s-1940s',
    track: 'Reel du Pendu',
    mood: 'nostalgic',
    photo: '/landing-artists/joseph-allard.jpg',
  },
  {
    id: 'la-bolduc',
    name: 'La Bolduc',
    era: '1920s-1940s',
    track: 'La Cuisiniere',
    mood: 'wry',
    photo: '/landing-artists/la-bolduc.jpg',
  },
  {
    id: 'jean-carignan',
    name: 'Jean Carignan',
    era: '1940s-1980s',
    track: 'Reel de Rimouski',
    mood: 'electric',
    photo: '/landing-artists/jean-carignan.jpg',
  },
  {
    id: 'ovila-legare',
    name: 'Ovila Legare',
    era: '1920s-1970s',
    track: "V'la l'bon vent",
    mood: 'haunting',
    photo: '/landing-artists/ovila-legare.jpg',
  },
  {
    id: 'alfred-montmarquette',
    name: 'Alfred Montmarquette',
    era: '1910s-1940s',
    track: 'Marche des Canadiens',
    mood: 'spirited',
    photo: '/landing-artists/alfred-montmarquette.jpg',
  },
] as const

const stagger = {
  animate: { transition: { staggerChildren: 0.08 } },
}

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
}

const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.8, ease: 'easeOut' as const },
}

export default function StartScreen() {
  const setAppState = useAppStore((s) => s.setAppState)
  const [launching, setLaunching] = useState(false)
  const [artistIndex, setArtistIndex] = useState(0)
  const [previousArtistIndex, setPreviousArtistIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!launching) return

    const timeoutId = window.setTimeout(() => {
      setAppState('idle')
    }, 1400)

    return () => window.clearTimeout(timeoutId)
  }, [launching, setAppState])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setArtistIndex((current) => {
        setPreviousArtistIndex(current)
        return (current + 1) % FEATURED_ARTISTS.length
      })
    }, 3000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (previousArtistIndex === null) return
    const timeoutId = window.setTimeout(() => setPreviousArtistIndex(null), 500)
    return () => window.clearTimeout(timeoutId)
  }, [previousArtistIndex])

  useEffect(() => {
    FEATURED_ARTISTS.forEach((artist) => {
      const img = new Image()
      img.src = artist.photo
    })
  }, [])

  const activeArtist = FEATURED_ARTISTS[artistIndex]

  return (
    <div className={`archive-start ${launching ? 'is-launching' : ''}`}>
      <div className="archive-start__grain" />
      <div className="archive-start__scanlines" />

      <section className="archive-start__panel archive-start__panel--copy">
        <motion.div
          className="archive-start__copy-inner"
          initial="initial"
          animate="animate"
          variants={stagger}
        >
          <motion.div className="archive-start__eyebrow" variants={fadeUp}>
            <span className="archive-start__eyebrow-line" />
            <span>Sound Archive</span>
          </motion.div>

          <motion.div className="archive-start__hero" variants={stagger}>
            <motion.h1 className="archive-start__title" variants={fadeUp}>
              Sillon
            </motion.h1>
            <motion.p className="archive-start__subtitle" variants={fadeUp}>
              Some melodies never disappeared.
            </motion.p>
            <motion.p className="archive-start__body" variants={fadeUp}>
              Share a sound, describe a feeling, or whisper into the archive and awaken a forgotten
              Quebec voice that echoes your emotional resonance.
            </motion.p>
          </motion.div>

          <motion.div className="archive-start__actions" variants={fadeUp}>
            <button
              type="button"
              className="archive-start__button archive-start__button--primary"
              onClick={() => setLaunching(true)}
              disabled={launching}
            >
              <span>Begin Listening</span>
              <ArrowIcon />
            </button>

            <button
              type="button"
              className="archive-start__button archive-start__button--secondary"
              onClick={() => setAppState('graph')}
            >
              Enter the Archive
            </button>
          </motion.div>

          <motion.div className="archive-start__stats" variants={stagger}>
            {LANDING_STATS.map((stat) => (
              <motion.div key={stat.label} className="archive-start__stat" variants={fadeUp}>
                <p className="archive-start__stat-label">{stat.label}</p>
                <p className="archive-start__stat-value">{stat.value}</p>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      <section className="archive-start__panel archive-start__panel--portrait">
        <motion.div className="archive-start__portrait-wrap" {...fadeIn}>
          <span className="archive-start__corner archive-start__corner--top" />
          <span className="archive-start__corner archive-start__corner--bottom" />

          {previousArtistIndex !== null && (
            <img
              className="archive-start__portrait archive-start__portrait--outgoing"
              src={FEATURED_ARTISTS[previousArtistIndex].photo}
              alt=""
            />
          )}
          <img
            key={activeArtist.id}
            className="archive-start__portrait archive-start__portrait--active"
            src={activeArtist.photo}
            alt={`${activeArtist.name} portrait`}
          />

          <div className="archive-start__portrait-fade" />

          <div className="archive-start__index">
            <span className="archive-start__index-line" />
            <span>01</span>
          </div>

          <div className="archive-start__caption" aria-live="polite" aria-atomic="true">
            <p className="archive-start__caption-era">{activeArtist.era}</p>
            <h2 className="archive-start__caption-name">{activeArtist.name}</h2>
            <p className="archive-start__caption-track">{activeArtist.track}</p>
            <div className="archive-start__caption-footer">
              <span className="archive-start__caption-line" />
              <span>{activeArtist.mood}</span>
            </div>
          </div>
        </motion.div>
      </section>
    </div>
  )
}

function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h12m-5-5 5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
