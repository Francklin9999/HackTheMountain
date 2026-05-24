import { lazy, Suspense } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from './state/appStore'
import StartScreen from './screens/StartScreen'
import HumScreen from './screens/HumScreen'
import SearchingScreen from './screens/SearchingScreen'
import RevealScreen from './screens/RevealScreen'
import ScreenLoader from './components/ScreenLoader'
import type { AppState } from './state/appStore'

const ExploreScreen = lazy(() => import('./screens/ExploreScreen'))
const GraphScreen = lazy(() => import('./screens/GraphScreen'))

const PRIMARY_ROUTES: Array<{
  id: 'start' | 'listen' | 'revealed' | 'exploring' | 'graph'
  label: string
  mobileLabel: string
}> = [
  { id: 'start', label: 'Home', mobileLabel: 'Home' },
  { id: 'listen', label: 'Listen', mobileLabel: 'Listen' },
  { id: 'revealed', label: 'Reveal', mobileLabel: 'Reveal' },
  { id: 'exploring', label: 'Explore', mobileLabel: 'Explore' },
  { id: 'graph', label: 'Graph', mobileLabel: 'Map' },
]

export default function App() {
  const { appState, currentMatch, currentArtist, setAppState } = useAppStore()

  const activeRoute = normalizeRoute(appState)
  const currentRouteLabel = PRIMARY_ROUTES.find((route) => route.id === activeRoute)?.label ?? 'Home'
  const currentRouteMeta = activeRoute === 'graph'
    ? 'Constellated archive'
    : activeRoute === 'exploring'
      ? 'Archive dossier'
      : activeRoute === 'revealed'
        ? 'Recovered match'
        : activeRoute === 'listen'
          ? 'Intake ritual'
          : 'Sound archive'

  const screen = (
    <>
      {appState === 'start' && <StartScreen />}
      {(appState === 'idle' || appState === 'listening') && <HumScreen />}
      {appState === 'searching' && <SearchingScreen />}
      {appState === 'revealed' && <RevealScreen />}
      {appState === 'exploring' && (
        <Suspense fallback={<ScreenLoader />}>
          <ExploreScreen />
        </Suspense>
      )}
      {appState === 'graph' && (
        <Suspense fallback={<ScreenLoader />}>
          <GraphScreen />
        </Suspense>
      )}
    </>
  )

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>

      <header className="site-header">
        <div className="header-inner">
          <button
            type="button"
            className="brand-button"
            onClick={() => setAppState('start')}
          >
            <span className="brand-button__title">
              Sillon
            </span>
            <span className="brand-button__subtitle">
              Québec Sound Archive
            </span>
          </button>

          <div className="header-mobile-summary" aria-live="polite">
            <span className="header-mobile-summary__eyebrow">{currentRouteMeta}</span>
            <span className="header-mobile-summary__title">{currentRouteLabel}</span>
          </div>

          <nav className="header-nav header-nav--desktop" aria-label="Primary">
            <HeaderNavButton
              label="Home"
              active={activeRoute === 'start'}
              onClick={() => setAppState('start')}
            />
            <HeaderNavButton
              label="Listen"
              active={activeRoute === 'listen'}
              onClick={() => setAppState('idle')}
            />
            <HeaderNavButton
              label="Reveal"
              active={activeRoute === 'revealed'}
              disabled={!currentMatch}
              onClick={() => setAppState('revealed')}
            />
            <HeaderNavButton
              label="Explore"
              active={activeRoute === 'exploring'}
              disabled={!currentMatch && !currentArtist}
              onClick={() => setAppState('exploring')}
            />
            <HeaderNavButton
              label="Graph"
              active={activeRoute === 'graph'}
              onClick={() => setAppState('graph')}
            />
          </nav>

          <div className="header-status">
            {currentMatch && (
              <span className="header-pill header-pill--soft">
                current match · {currentMatch.artist.name}
              </span>
            )}
          </div>
        </div>
      </header>

      <main id="main-content" className="app-main">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={appState}
            className="app-view"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {screen}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="mobile-route-nav" aria-label="Primary mobile">
        {PRIMARY_ROUTES.map((route) => {
          const active = route.id === activeRoute
          const disabled =
            (route.id === 'revealed' && !currentMatch) ||
            (route.id === 'exploring' && !currentMatch && !currentArtist)

          return (
            <button
              key={route.id}
              type="button"
              className={`mobile-route-nav__button${active ? ' is-active' : ''}`}
              disabled={disabled}
              onClick={() => setAppState(resolveRouteState(route.id))}
            >
              <span className="mobile-route-nav__label">{route.mobileLabel}</span>
              <span className="mobile-route-nav__marker" aria-hidden="true" />
            </button>
          )
        })}
      </nav>
    </div>
  )
}

function HeaderNavButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`header-nav__button${active ? ' is-active' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function normalizeRoute(appState: AppState): typeof PRIMARY_ROUTES[number]['id'] {
  if (appState === 'idle' || appState === 'listening' || appState === 'searching') return 'listen'
  return appState
}

function resolveRouteState(routeId: typeof PRIMARY_ROUTES[number]['id']): AppState {
  if (routeId === 'listen') return 'idle'
  return routeId
}
