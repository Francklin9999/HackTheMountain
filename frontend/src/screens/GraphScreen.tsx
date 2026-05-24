import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, Dispatch, MutableRefObject, SetStateAction } from 'react'
import { getArtist } from '../api/artists'
import { getGraph } from '../api/graph'
import { useAppStore } from '../state/appStore'
import type { ArtistResponse, GraphEdge, GraphNode, Track } from '../types/api'
import { useMediaQuery } from '../hooks/useMediaQuery'

const WORLD_WIDTH = 3200
const WORLD_HEIGHT = 2200
const WORLD_PADDING = 180
const FOCUS_CENTER_X = 1360
const FOCUS_CENTER_Y = 1080
const MIN_ZOOM = 0.68
const MAX_ZOOM = 1.92
const ZOOM_STEP = 0.14
const DEFAULT_OVERVIEW_ZOOM = 0.9
const DEFAULT_FOCUS_ZOOM = 1.06
const NODE_FOCUS_ZOOM = 1.22
const SECTION_CARD_WIDTH = 278
const SECTION_CARD_HEIGHT = 138
const GRAPH_REVEAL_WINDOW_MS = 800

interface ThemeSection {
  key: string
  label: string
  summary: string
  artistIds: string[]
}

type DisplayNodeKind = 'artist' | 'track' | 'theme'
type DisplayEdgeKind = 'artist-link' | 'artist-track' | 'artist-theme'
type ZoomState = 'idle' | 'in' | 'out'
type SectionLabelAlign = 'start' | 'center' | 'end'
type ActivityLevel = 'idle' | 'current' | 'direct' | 'echo' | 'muted'

interface DisplayNode {
  key: string
  kind: DisplayNodeKind
  label: string
  subtitle: string
  x: number
  y: number
  baseX: number
  baseY: number
  radius: number
  color: string
  stroke: string
  draggable: boolean
  importance: number
  artistId?: string
  graphNode?: GraphNode
  track?: Track
  themeKey?: string
}

interface DisplayEdge {
  id: string
  source: string
  target: string
  kind: DisplayEdgeKind
}

interface DustPoint {
  x: number
  y: number
  radius: number
  opacity: number
}

interface SectionOverview {
  key: string
  label: string
  summary: string
  x: number
  y: number
  radius: number
  artistIds: string[]
  artistCount: number
  trackCount: number
  labelX: number
  labelY: number
  labelAlign: SectionLabelAlign
  haloScale: number
  dust: DustPoint[]
}

interface FocusGraph {
  nodes: DisplayNode[]
  edges: DisplayEdge[]
}

interface GraphModel {
  sections: SectionOverview[]
  focusGraphs: Record<string, FocusGraph>
}

interface ActivityModel {
  activeKey: string
  nodeDepth: Map<string, number>
  edgeDepth: Map<string, number>
}

interface ThemeLayoutPreset {
  x: number
  y: number
  labelX: number
  labelY: number
  labelAlign: SectionLabelAlign
  radius: number
  haloScale: number
}

const THEME_SECTIONS: ThemeSection[] = [
  {
    key: 'fiddle-lineage',
    label: 'Fiddle Lineage',
    summary: 'Reels, bowing, and virtuoso inheritance',
    artistIds: ['joseph-allard', 'jean-carignan', 'isidore-soucy'],
  },
  {
    key: 'song-and-chanson',
    label: 'Song & Chanson',
    summary: 'Poetry, wit, and the sung archive',
    artistIds: ['la-bolduc', 'felix-leclerc', 'charles-marchand'],
  },
  {
    key: 'voice-and-memory',
    label: 'Voice & Memory',
    summary: 'Storytelling, radio, and collective memory',
    artistIds: ['ovila-legare', 'conrad-gauthier'],
  },
  {
    key: 'dancehall-instruments',
    label: 'Dancehall Instruments',
    summary: 'Accordion, harmonica, and moving rooms',
    artistIds: ['alfred-montmarquette', 'philippe-bruneau'],
  },
]

const THEME_LAYOUTS: Record<string, ThemeLayoutPreset> = {
  'fiddle-lineage': {
    x: 760,
    y: 760,
    labelX: 304,
    labelY: 320,
    labelAlign: 'start',
    radius: 176,
    haloScale: 1.92,
  },
  'song-and-chanson': {
    x: 1960,
    y: 560,
    labelX: 1630,
    labelY: 162,
    labelAlign: 'start',
    radius: 186,
    haloScale: 2.04,
  },
  'voice-and-memory': {
    x: 2580,
    y: 1160,
    labelX: 2278,
    labelY: 1330,
    labelAlign: 'start',
    radius: 160,
    haloScale: 1.84,
  },
  'dancehall-instruments': {
    x: 1340,
    y: 1590,
    labelX: 1548,
    labelY: 1738,
    labelAlign: 'start',
    radius: 172,
    haloScale: 1.9,
  },
  'cross-currents': {
    x: 620,
    y: 1548,
    labelX: 270,
    labelY: 1692,
    labelAlign: 'start',
    radius: 150,
    haloScale: 1.74,
  },
}

const THEME_LINKS: Array<[string, string]> = [
  ['fiddle-lineage', 'song-and-chanson'],
  ['fiddle-lineage', 'dancehall-instruments'],
  ['song-and-chanson', 'voice-and-memory'],
  ['song-and-chanson', 'cross-currents'],
  ['voice-and-memory', 'dancehall-instruments'],
  ['dancehall-instruments', 'cross-currents'],
]

const PRIMARY_ARTIST_ANGLES = [-2.32, -1.78, -1.18, -0.54, 0.08, 0.76, 1.28, 1.86, 2.38, 2.92]
const SECONDARY_ARTIST_ANGLES = [-2.9, -2.36, -1.92, 0.84, 1.26, 1.68, 2.08, 2.58]

export default function GraphScreen() {
  const { currentMatch, setAppState, setCurrentArtist } = useAppStore()
  const isCompactGraph = useMediaQuery('(max-width: 900px)')
  const [graphModel, setGraphModel] = useState<GraphModel>({ sections: [], focusGraphs: {} })
  const [artistDetails, setArtistDetails] = useState<Record<string, ArtistResponse>>({})
  const [focusSectionKey, setFocusSectionKey] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [hoveredSectionKey, setHoveredSectionKey] = useState<string | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [zoomState, setZoomState] = useState<ZoomState>('idle')
  const [zoom, setZoom] = useState(DEFAULT_OVERVIEW_ZOOM)
  const [cameraDrift, setCameraDrift] = useState({ x: 0, y: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const inertiaFrameRef = useRef<number | null>(null)
  const panRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    velocityX: 0,
    velocityY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  })
  const nodeDragRef = useRef<{
    active: boolean
    key: string | null
    moved: boolean
    startX: number
    startY: number
  }>({
    active: false,
    key: null,
    moved: false,
    startX: 0,
    startY: 0,
  })
  const [mobileZoomLevel, setMobileZoomLevel] = useState(1)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const graph = await getGraph()
        const detailPairs = await Promise.all(
          graph.nodes.map(async (node) => {
            try {
              const detail = await getArtist(node.id)
              return [node.id, detail] as const
            } catch {
              return [node.id, null] as const
            }
          }),
        )

        if (cancelled) return

        const detailMap = Object.fromEntries(
          detailPairs.filter((entry): entry is readonly [string, ArtistResponse] => entry[1] !== null),
        )

        setArtistDetails(detailMap)
        setGraphModel(buildGraphModel(graph.nodes, graph.edges, detailMap))
        setLoading(false)
      } catch {
        if (!cancelled) {
          setError('Could not load the memory map.')
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (zoomState === 'idle') return
    const timeoutId = window.setTimeout(() => setZoomState('idle'), 620)
    return () => window.clearTimeout(timeoutId)
  }, [zoomState])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedKey(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    return () => stopInertia(inertiaFrameRef)
  }, [])

  useEffect(() => {
    syncCameraDrift(viewportRef.current, zoom, setCameraDrift)
  }, [zoom, graphModel.sections.length, focusSectionKey])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    if (focusSectionKey) {
      centerOnPoint(FOCUS_CENTER_X, FOCUS_CENTER_Y, viewport, 'smooth', zoom)
      return
    }

    if (graphModel.sections.length === 0) return
    const matchedSection = currentMatch
      ? graphModel.sections.find((section) => section.key === themeKeyForArtist(currentMatch.artist.id)) ?? null
      : null

    if (matchedSection) {
      centerOnPoint(matchedSection.x, matchedSection.y, viewport, 'auto', zoom)
      return
    }

    centerOnPoint(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, viewport, 'auto', zoom)
  }, [focusSectionKey, graphModel.sections, currentMatch, zoom])

  const matchedArtistId = currentMatch?.artist.id ?? null
  const matchedSectionKey = currentMatch ? themeKeyForArtist(currentMatch.artist.id) : null
  const focusSection = focusSectionKey
    ? graphModel.sections.find((section) => section.key === focusSectionKey) ?? null
    : null
  const currentFocusGraph = focusSectionKey ? graphModel.focusGraphs[focusSectionKey] ?? null : null
  const overviewSpotlightKey = hoveredSectionKey ?? matchedSectionKey ?? null
  const focusNodeKey = selectedKey ?? hoveredKey
  const archiveTotals = useMemo(() => {
    const artistCount = graphModel.sections.reduce((sum, section) => sum + section.artistCount, 0)
    const trackCount = graphModel.sections.reduce((sum, section) => sum + section.trackCount, 0)
    return {
      sectionCount: graphModel.sections.length,
      artistCount,
      trackCount,
    }
  }, [graphModel.sections])
  const focusNodeMap = useMemo(
    () => new Map((currentFocusGraph?.nodes ?? []).map((node) => [node.key, node] as const)),
    [currentFocusGraph],
  )
  const selectedNode = useMemo(
    () => (selectedKey ? focusNodeMap.get(selectedKey) ?? null : null),
    [focusNodeMap, selectedKey],
  )
  const activeNode = useMemo(
    () => (focusNodeKey ? focusNodeMap.get(focusNodeKey) ?? null : null),
    [focusNodeKey, focusNodeMap],
  )
  const selectedArtist =
    selectedNode?.kind === 'artist' && selectedNode.artistId ? artistDetails[selectedNode.artistId] ?? null : null
  const activityModel = useMemo(
    () => buildActivityModel(currentFocusGraph, focusNodeKey),
    [currentFocusGraph, focusNodeKey],
  )
  const contextCard = useMemo(
    () => buildContextCard(activeNode, focusSection, artistDetails),
    [activeNode, artistDetails, focusSection],
  )
  const mobileOverviewFocus = overviewSpotlightKey
    ? graphModel.sections.find((section) => section.key === overviewSpotlightKey) ?? null
    : graphModel.sections[0] ?? null
  const mobileOverviewViewBox = useMemo(
    () => buildMobileOverviewViewBox(mobileOverviewFocus),
    [mobileOverviewFocus],
  )
  const mobileFocusNodes = useMemo(
    () => buildMobileNodeDeck(currentFocusGraph),
    [currentFocusGraph],
  )
  const mobileStageViewBox = useMemo(
    () => buildMobileFocusViewBox(currentFocusGraph, focusNodeKey, mobileZoomLevel),
    [currentFocusGraph, focusNodeKey, mobileZoomLevel],
  )

  const worldInnerStyle = {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    transform: `scale(${zoom})`,
    '--drift-x': `${cameraDrift.x}px`,
    '--drift-y': `${cameraDrift.y}px`,
  } as CSSProperties

  const openSection = (sectionKey: string) => {
    stopInertia(inertiaFrameRef)
    setFocusSectionKey(sectionKey)
    setSelectedKey(null)
    setHoveredKey(null)
    setHoveredSectionKey(null)
    setZoomState('in')
    setZoom(DEFAULT_FOCUS_ZOOM)
  }

  const closeSection = () => {
    stopInertia(inertiaFrameRef)
    setFocusSectionKey(null)
    setSelectedKey(null)
    setHoveredKey(null)
    setHoveredSectionKey(null)
    setZoomState('out')
    setZoom(DEFAULT_OVERVIEW_ZOOM)
    setMobileZoomLevel(1)
  }

  const selectAndCenter = (key: string) => {
    if (!currentFocusGraph) return
    setSelectedKey(key)
    const node = currentFocusGraph.nodes.find((entry) => entry.key === key)
    if (!node) return
    const targetZoom = Math.max(zoom, NODE_FOCUS_ZOOM)
    if (targetZoom !== zoom) {
      setZoom(targetZoom)
      window.requestAnimationFrame(() => {
        centerOnPoint(node.x, node.y, viewportRef.current, 'smooth', targetZoom)
        syncCameraDrift(viewportRef.current, targetZoom, setCameraDrift)
      })
      return
    }

    centerOnPoint(node.x, node.y, viewportRef.current, 'smooth', zoom)
  }

  const updateZoom = (nextZoom: number) => {
    const viewport = viewportRef.current
    const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
    if (!viewport) {
      setZoom(clampedZoom)
      return
    }

    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / zoom
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / zoom
    setZoom(clampedZoom)

    window.requestAnimationFrame(() => {
      centerOnPoint(centerX, centerY, viewportRef.current, 'auto', clampedZoom)
      syncCameraDrift(viewportRef.current, clampedZoom, setCameraDrift)
    })
  }

  useEffect(() => {
    if (!focusSectionKey) {
      const resetId = window.requestAnimationFrame(() => setMobileZoomLevel(1))
      return () => window.cancelAnimationFrame(resetId)
    }

    const resetId = window.requestAnimationFrame(() => setMobileZoomLevel(1))
    return () => window.cancelAnimationFrame(resetId)
  }, [focusSectionKey])

  useEffect(() => {
    if (!isCompactGraph || !focusSectionKey || !currentFocusGraph) return

    const nextSelected = selectedKey && currentFocusGraph.nodes.some((node) => node.key === selectedKey)
      ? selectedKey
      : currentFocusGraph.nodes.find((node) => node.kind === 'theme')?.key
        ?? currentFocusGraph.nodes[0]?.key
        ?? null

    if (nextSelected && nextSelected !== selectedKey) {
      const frameId = window.requestAnimationFrame(() => setSelectedKey(nextSelected))
      return () => window.cancelAnimationFrame(frameId)
    }
  }, [currentFocusGraph, focusSectionKey, isCompactGraph, selectedKey])

  const zoomAroundPointer = (nextZoom: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current
    const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
    if (!viewport) {
      setZoom(clampedZoom)
      return
    }

    const bounds = viewport.getBoundingClientRect()
    const anchorX = (viewport.scrollLeft + (clientX - bounds.left)) / zoom
    const anchorY = (viewport.scrollTop + (clientY - bounds.top)) / zoom
    setZoom(clampedZoom)

    window.requestAnimationFrame(() => {
      if (!viewportRef.current) return
      viewportRef.current.scrollLeft = clamp(
        anchorX * clampedZoom - (clientX - bounds.left),
        0,
        WORLD_WIDTH * clampedZoom - viewportRef.current.clientWidth,
      )
      viewportRef.current.scrollTop = clamp(
        anchorY * clampedZoom - (clientY - bounds.top),
        0,
        WORLD_HEIGHT * clampedZoom - viewportRef.current.clientHeight,
      )
      syncCameraDrift(viewportRef.current, clampedZoom, setCameraDrift)
    })
  }

  const handleExploreArtist = () => {
    if (!selectedArtist) return
    setCurrentArtist(selectedArtist)
    setAppState('exploring')
  }

  const handleViewportScroll = () => {
    syncCameraDrift(viewportRef.current, zoom, setCameraDrift)
  }

  const handleViewportWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const delta = event.deltaY > 0 ? -0.11 : 0.11
    zoomAroundPointer(zoom + delta, event.clientX, event.clientY)
  }

  const handleSurfacePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('[data-graph-node="true"]')) return
    if (target.closest('.graph-screen__dossier')) return
    if (target.closest('[data-graph-section="true"]')) return

    stopInertia(inertiaFrameRef)
    setSelectedKey(null)

    panRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocityX: 0,
      velocityY: 0,
      scrollLeft: viewportRef.current?.scrollLeft ?? 0,
      scrollTop: viewportRef.current?.scrollTop ?? 0,
    }
    setIsPanning(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleSurfacePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (nodeDragRef.current.active && nodeDragRef.current.key && viewportRef.current && currentFocusGraph) {
      const viewport = viewportRef.current
      const bounds = viewport.getBoundingClientRect()
      const x = clamp(
        (viewport.scrollLeft + (event.clientX - bounds.left)) / zoom,
        WORLD_PADDING,
        WORLD_WIDTH - WORLD_PADDING,
      )
      const y = clamp(
        (viewport.scrollTop + (event.clientY - bounds.top)) / zoom,
        WORLD_PADDING,
        WORLD_HEIGHT - WORLD_PADDING,
      )

      if (
        Math.abs(event.clientX - nodeDragRef.current.startX) > 4 ||
        Math.abs(event.clientY - nodeDragRef.current.startY) > 4
      ) {
        nodeDragRef.current.moved = true
      }

      setGraphModel((prev) => {
        if (!focusSectionKey || !prev.focusGraphs[focusSectionKey]) return prev
        return {
          ...prev,
          focusGraphs: {
            ...prev.focusGraphs,
            [focusSectionKey]: {
              ...prev.focusGraphs[focusSectionKey],
              nodes: prev.focusGraphs[focusSectionKey].nodes.map((node) =>
                node.key === nodeDragRef.current.key
                  ? { ...node, x, y, baseX: x, baseY: y }
                  : node,
              ),
            },
          },
        }
      })
      return
    }

    if (!panRef.current.active || !viewportRef.current) return
    const now = event.timeStamp
    const dx = event.clientX - panRef.current.lastX
    const dy = event.clientY - panRef.current.lastY
    const dt = Math.max(now - panRef.current.lastTime, 16)

    viewportRef.current.scrollLeft -= dx
    viewportRef.current.scrollTop -= dy
    panRef.current.velocityX = -dx / dt
    panRef.current.velocityY = -dy / dt
    panRef.current.lastX = event.clientX
    panRef.current.lastY = event.clientY
    panRef.current.lastTime = now
    syncCameraDrift(viewportRef.current, zoom, setCameraDrift)
  }

  const handleSurfacePointerUp = () => {
    const viewport = viewportRef.current
    const velocityX = panRef.current.velocityX
    const velocityY = panRef.current.velocityY

    panRef.current.active = false
    setIsPanning(false)

    if (viewport && (Math.abs(velocityX) > 0.02 || Math.abs(velocityY) > 0.02)) {
      startInertia(viewport, inertiaFrameRef, velocityX, velocityY, () => syncCameraDrift(viewportRef.current, zoom, setCameraDrift))
    }

    if (nodeDragRef.current.active && nodeDragRef.current.key) {
      if (!nodeDragRef.current.moved) {
        selectAndCenter(nodeDragRef.current.key)
      }
      nodeDragRef.current = { active: false, key: null, moved: false, startX: 0, startY: 0 }
    }
  }

  const beginNodeDrag = (event: React.PointerEvent<SVGGElement>, key: string) => {
    event.stopPropagation()
    stopInertia(inertiaFrameRef)
    event.currentTarget.setPointerCapture(event.pointerId)
    nodeDragRef.current = {
      active: true,
      key,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
    }
  }

  if (isCompactGraph) {
    return (
      <GraphMobileView
        archiveTotals={archiveTotals}
        contextCard={contextCard}
        currentFocusGraph={currentFocusGraph}
        currentFocusNodeKey={focusNodeKey}
        currentFocusSection={focusSection}
        error={error}
        focusNodeMap={focusNodeMap}
        focusSectionKey={focusSectionKey}
        loading={loading}
        matchedSectionKey={matchedSectionKey}
        mobileFocusNodes={mobileFocusNodes}
        mobileFocusViewBox={mobileStageViewBox}
        mobileOverviewFocus={mobileOverviewFocus}
        mobileOverviewViewBox={mobileOverviewViewBox}
        onBack={() => setAppState(currentMatch ? 'revealed' : 'idle')}
        onCloseSection={closeSection}
        onExploreArtist={handleExploreArtist}
        onOpenSection={openSection}
        onResetFocus={() => {
          const themeNodeKey = currentFocusGraph?.nodes.find((node) => node.kind === 'theme')?.key ?? null
          setSelectedKey(themeNodeKey)
          setMobileZoomLevel(1)
        }}
        onSelectKey={setSelectedKey}
        onSetCompactZoom={setMobileZoomLevel}
        overviewSpotlightKey={overviewSpotlightKey}
        sections={graphModel.sections}
        selectedArtist={selectedArtist}
        selectedNode={selectedNode}
        zoomLevel={mobileZoomLevel}
      />
    )
  }

  return (
    <div className="graph-screen">
      <div className="graph-screen__header">
        <div className="graph-screen__heading">
          <button
            type="button"
            className="graph-screen__back"
            onClick={() => setAppState(currentMatch ? 'revealed' : 'idle')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Return
          </button>

          <div className="graph-screen__title-wrap">
            <p className="graph-screen__eyebrow">
              {focusSection ? 'Inner memory cluster' : 'Living musical memory map'}
            </p>
            <h1 className="graph-screen__title">
              {focusSection ? focusSection.label : 'Constellated archive of remembered sound'}
            </h1>
            <p className="graph-screen__meta">
              {focusSection
                ? `${focusSection.summary}. Let the brighter trails carry you through recordings, neighboring voices, and lines of influence.`
                : 'Dense zones hold strong inheritances, quiet fields mark distance and loss. Enter a constellation to reveal the people and recordings keeping it alive.'}
            </p>
          </div>
        </div>

        <div className="graph-screen__header-side">
          <div className="graph-screen__atlas">
            <div className="graph-screen__atlas-line">
              <span>constellations</span>
              <strong>{focusSection ? 1 : archiveTotals.sectionCount}</strong>
            </div>
            <div className="graph-screen__atlas-line">
              <span>voices</span>
              <strong>{focusSection ? focusSection.artistCount : archiveTotals.artistCount}</strong>
            </div>
            <div className="graph-screen__atlas-line">
              <span>recordings</span>
              <strong>{focusSection ? focusSection.trackCount : archiveTotals.trackCount}</strong>
            </div>
          </div>

          <div className="graph-screen__controls">
            <span className="graph-screen__mode-pill">
              {focusSection ? 'cluster depth' : 'macro archive'}
            </span>
            <div className="graph-screen__zoom-controls">
              <button type="button" className="graph-screen__zoom-button" onClick={() => updateZoom(zoom - ZOOM_STEP)}>
                -
              </button>
              <span className="graph-screen__zoom-readout">{Math.round(zoom * 100)}%</span>
              <button type="button" className="graph-screen__zoom-button" onClick={() => updateZoom(zoom + ZOOM_STEP)}>
                +
              </button>
              <button
                type="button"
                className="graph-screen__mode-action"
                onClick={() => updateZoom(focusSection ? DEFAULT_FOCUS_ZOOM : DEFAULT_OVERVIEW_ZOOM)}
              >
                Center lens
              </button>
              {focusSection && (
                <button type="button" className="graph-screen__mode-action" onClick={closeSection}>
                  All constellations
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`graph-screen__viewport ${isPanning ? 'is-panning' : ''}`}
        onPointerDown={handleSurfacePointerDown}
        onPointerMove={handleSurfacePointerMove}
        onPointerUp={handleSurfacePointerUp}
        onPointerCancel={handleSurfacePointerUp}
        onScroll={handleViewportScroll}
        onWheel={handleViewportWheel}
      >
        <div
          className={`graph-screen__world${zoomState !== 'idle' ? ` is-zoom-${zoomState}` : ''}`}
          style={{ width: WORLD_WIDTH * zoom, height: WORLD_HEIGHT * zoom }}
        >
          <div className="graph-screen__world-inner" style={worldInnerStyle}>
            <div className="graph-screen__surface-vignette" />
            <div className="graph-screen__surface-fog graph-screen__surface-fog--far" />
            <div className="graph-screen__surface-fog graph-screen__surface-fog--near" />
            <div className="graph-screen__surface-glow" />
            <div className="graph-screen__surface-noise" />

            {!focusSection && (
              <svg className="graph-screen__svg" viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`}>
                <GraphSvgDefs />
                {THEME_LINKS.map(([sourceKey, targetKey], index) => {
                  const source = graphModel.sections.find((section) => section.key === sourceKey)
                  const target = graphModel.sections.find((section) => section.key === targetKey)
                  if (!source || !target) return null

                  const relationClass = getOverviewRelationClass(sourceKey, targetKey, overviewSpotlightKey)
                  return (
                    <g
                      key={`section-edge:${sourceKey}:${targetKey}`}
                      className={`graph-screen__section-link ${relationClass}`}
                      style={{ '--graph-delay': `${buildStaggerDelay(index, THEME_LINKS.length, 180)}ms` } as CSSProperties}
                    >
                      <g className="graph-screen__edge-body">
                        <path
                          d={buildSectionCurve(source, target)}
                          className="graph-screen__section-link-glow"
                          pathLength={1}
                        />
                        <path
                          d={buildSectionCurve(source, target)}
                          className="graph-screen__section-link-line"
                          pathLength={1}
                        />
                      </g>
                    </g>
                  )
                })}

                {graphModel.sections.map((section, index) => {
                  const sectionClass = getOverviewSectionClass(section.key, overviewSpotlightKey, matchedSectionKey)
                  const plateX = section.labelX + plaqueOffsetX(section.labelAlign, SECTION_CARD_WIDTH)
                  const lineOffset = section.labelAlign === 'center'
                    ? 0
                    : section.labelAlign === 'end'
                      ? SECTION_CARD_WIDTH - 34
                      : 34

                  return (
                    <g key={section.key}>
                      {section.dust.map((dustPoint, index) => (
                        <circle
                          key={`${section.key}:dust:${index}`}
                          cx={section.x + dustPoint.x}
                          cy={section.y + dustPoint.y}
                          r={dustPoint.radius}
                          className="graph-screen__section-dust"
                          opacity={dustPoint.opacity}
                        />
                      ))}

                      <g
                        data-graph-section="true"
                        role="button"
                        tabIndex={0}
                        aria-label={`Enter ${section.label}`}
                        className={`graph-screen__section ${sectionClass}`}
                        transform={`translate(${section.x}, ${section.y})`}
                        style={{ '--graph-delay': `${buildStaggerDelay(index, graphModel.sections.length)}ms` } as CSSProperties}
                        onMouseEnter={() => setHoveredSectionKey(section.key)}
                        onMouseLeave={() => setHoveredSectionKey(null)}
                        onClick={() => openSection(section.key)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            openSection(section.key)
                          }
                        }}
                      >
                        <g className="graph-screen__section-body">
                          <circle className="graph-screen__section-bloom" r={section.radius * section.haloScale} />
                          <circle className="graph-screen__section-ring graph-screen__section-ring--outer" r={section.radius + 58} />
                          <circle className="graph-screen__section-ring graph-screen__section-ring--middle" r={section.radius + 28} />
                          <circle className="graph-screen__section-ring graph-screen__section-ring--inner" r={section.radius + 12} />
                          <circle className="graph-screen__section-core-shadow" r={section.radius + 5} />
                          <circle className="graph-screen__section-core" r={section.radius} />
                          <circle className="graph-screen__section-core-inset" r={section.radius * 0.58} />
                          <circle className="graph-screen__section-dot" r="3" />
                        </g>
                      </g>

                      <line
                        x1={section.x}
                        y1={section.y}
                        x2={section.labelAlign === 'center' ? section.labelX : section.labelAlign === 'end' ? section.labelX - 14 : section.labelX + 14}
                        y2={section.labelY + 52}
                        className={`graph-screen__section-callout ${sectionClass}`}
                      />

                      <foreignObject
                        x={plateX}
                        y={section.labelY}
                        width={SECTION_CARD_WIDTH}
                        height={SECTION_CARD_HEIGHT}
                        className="graph-screen__section-plate-wrap"
                      >
                        <div className={`graph-screen__section-plate ${sectionClass}`}>
                          <div className="graph-screen__section-plate-top">
                            <span>{section.artistCount} voices</span>
                            <span>{section.trackCount} recordings</span>
                          </div>
                          <h2 className="graph-screen__section-plate-title">{section.label}</h2>
                          <p className="graph-screen__section-plate-copy">{section.summary}</p>
                          <div className="graph-screen__section-plate-line" style={{ '--line-offset': `${lineOffset}px` } as CSSProperties} />
                        </div>
                      </foreignObject>
                    </g>
                  )
                })}
              </svg>
            )}

            {focusSection && currentFocusGraph && (
              <svg className="graph-screen__svg" viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`}>
                <GraphSvgDefs />
                {currentFocusGraph.edges.map((edge, index) => {
                  const source = focusNodeMap.get(edge.source)
                  const target = focusNodeMap.get(edge.target)
                  if (!source || !target) return null

                  const edgeClass = getEdgeActivityClass(edge.id, activityModel)
                  return (
                    <g
                      key={edge.id}
                      className={`graph-screen__edge-group ${edgeClass}`}
                      style={{ '--graph-delay': `${buildStaggerDelay(index, currentFocusGraph.edges.length, 180)}ms` } as CSSProperties}
                    >
                      <g className="graph-screen__edge-body">
                        <line
                          x1={source.x}
                          y1={source.y}
                          x2={target.x}
                          y2={target.y}
                          className={`graph-screen__edge-glow graph-screen__edge-glow--${edge.kind}`}
                          pathLength={1}
                        />
                        <line
                          x1={source.x}
                          y1={source.y}
                          x2={target.x}
                          y2={target.y}
                          className={`graph-screen__edge graph-screen__edge--${edge.kind}`}
                          pathLength={1}
                        />
                      </g>
                    </g>
                  )
                })}

                {currentFocusGraph.nodes.map((node, index) => {
                  const nodeLevel = getNodeActivityLevel(node.key, activityModel)
                  const isSelected = node.key === selectedKey
                  const isMatched = node.kind === 'artist' && node.artistId === matchedArtistId
                  const lines = splitLabel(node.label)
                  const showTrackLabel = node.kind !== 'track' || nodeLevel === 'current' || nodeLevel === 'direct' || isSelected
                  const showSubtitle = node.kind === 'theme' || nodeLevel !== 'muted' || isSelected || isMatched
                  const nodeStyle = {
                    '--graph-delay': `${buildStaggerDelay(index, currentFocusGraph.nodes.length)}ms`,
                  } as CSSProperties

                  return (
                    <g
                      key={node.key}
                      data-graph-node="true"
                      transform={`translate(${node.x}, ${node.y})`}
                      className={`graph-screen__node graph-screen__node--${node.kind} is-${nodeLevel}${isSelected ? ' is-selected' : ''}${isMatched ? ' is-matched' : ''}`}
                      style={nodeStyle}
                      onMouseEnter={() => setHoveredKey(node.key)}
                      onMouseLeave={() => setHoveredKey((current) => (current === node.key ? null : current))}
                      onPointerDown={node.draggable ? (event) => beginNodeDrag(event, node.key) : undefined}
                      onPointerUp={!node.draggable ? (event) => {
                        event.stopPropagation()
                        selectAndCenter(node.key)
                      } : undefined}
                      role="button"
                      tabIndex={0}
                      aria-label={`Inspect ${node.label}`}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          selectAndCenter(node.key)
                        }
                      }}
                    >
                      <g className="graph-screen__node-body">
                        {node.kind === 'theme' && <ThemeGlyph node={node} />}
                        {node.kind === 'artist' && <ArtistGlyph node={node} />}
                        {node.kind === 'track' && <TrackGlyph node={node} />}

                        {showTrackLabel && (
                          <>
                            <text
                              textAnchor="middle"
                              y={node.kind === 'theme' ? node.radius + 24 : node.radius + 18}
                              className={`graph-screen__label graph-screen__label--${node.kind}`}
                            >
                              {formatGraphLabel(lines[0])}
                            </text>
                            {lines[1] && (
                              <text
                                textAnchor="middle"
                                y={node.kind === 'theme' ? node.radius + 38 : node.radius + 32}
                                className={`graph-screen__label graph-screen__label--${node.kind}`}
                              >
                                {formatGraphLabel(lines[1])}
                              </text>
                            )}
                          </>
                        )}

                        {showSubtitle && node.subtitle && (
                          <text
                            textAnchor="middle"
                            y={node.kind === 'theme' ? node.radius + 52 : node.radius + (showTrackLabel ? 46 : 24)}
                            className={`graph-screen__sublabel graph-screen__sublabel--${node.kind}`}
                          >
                            {node.subtitle}
                          </text>
                        )}
                      </g>
                    </g>
                  )
                })}
              </svg>
            )}
          </div>
        </div>

        {!loading && !error && (
          <>
            {contextCard && (
              <div className="graph-screen__context-panel is-active">
                <p className="graph-screen__context-eyebrow">{contextCard.eyebrow}</p>
                <h2 className="graph-screen__context-title">{contextCard.title}</h2>
                <p className="graph-screen__context-copy">{contextCard.body}</p>
                <div className="graph-screen__context-meta">
                  {contextCard.meta.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="graph-screen__viewport-note">
              {focusSection
                ? 'Slow down on the brighter threads. They reveal the nearest lineage first.'
                : 'The larger bodies are entry points into the archive. Their plaques explain the current before you enter it.'}
            </div>
          </>
        )}

        {loading && (
          <div className="graph-screen__overlay">
            <p>Loading memory field…</p>
          </div>
        )}

        {error && (
          <div className="graph-screen__overlay">
            <p className="graph-screen__overlay-error">{error}</p>
          </div>
        )}
      </div>

      {focusSection && selectedNode && (
        <aside className="graph-screen__dossier" aria-labelledby="graph-node-title">
          <button
            type="button"
            className="graph-screen__dossier-close"
            onClick={() => setSelectedKey(null)}
            aria-label="Close details"
          >
            ×
          </button>

          <p className="graph-screen__detail-kind">
            {selectedNode.kind === 'theme' ? 'cluster anchor' : selectedNode.kind}
          </p>
          <h2 id="graph-node-title" className="graph-screen__detail-title">
            {selectedNode.label}
          </h2>
          <p className="graph-screen__detail-subtitle">{selectedNode.subtitle}</p>

          {selectedNode.kind === 'artist' && selectedArtist && (
            <>
              <p className="graph-screen__detail-body">{selectedArtist.artist.bio}</p>

              <div className="graph-screen__detail-meta">
                <span>{focusSection.label}</span>
                <span>{selectedArtist.tracks.length} recordings</span>
                <span>{selectedArtist.related.length} nearby ties</span>
              </div>

              <div className="graph-screen__detail-chips">
                {selectedArtist.related.slice(0, 4).map((related) => (
                  <button
                    key={related.id}
                    type="button"
                    className="graph-screen__detail-chip"
                    onClick={() => {
                      const target = currentFocusGraph?.nodes.find((node) => node.artistId === related.id)
                      if (target) selectAndCenter(target.key)
                    }}
                  >
                    {related.name}
                  </button>
                ))}
              </div>

              <div className="graph-screen__detail-actions">
                <button type="button" className="graph-screen__detail-primary" onClick={handleExploreArtist}>
                  Open dossier
                </button>
                {selectedArtist.artist.source_url && (
                  <a
                    className="graph-screen__detail-secondary"
                    href={selectedArtist.artist.source_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source
                  </a>
                )}
              </div>
            </>
          )}

          {selectedNode.kind === 'track' && selectedNode.track && (
            <>
              <p className="graph-screen__detail-body">
                {selectedNode.track.title} fixes this lineage to an actual recording, turning a conceptual thread into an audible trace.
              </p>

              <div className="graph-screen__detail-meta">
                <span>{selectedNode.track.year}</span>
                <span>{selectedNode.track.duration_s}s</span>
                <span>{artistDetails[selectedNode.artistId ?? '']?.artist.name ?? 'unknown artist'}</span>
              </div>
            </>
          )}

          {selectedNode.kind === 'theme' && (
            <>
              <p className="graph-screen__detail-body">
                {focusSection.summary}. This inner anchor concentrates the artists and recordings defining the cluster’s shape.
              </p>

              <div className="graph-screen__detail-meta">
                <span>{focusSection.label}</span>
                <span>{focusSection.artistCount} voices</span>
                <span>{focusSection.trackCount} recordings</span>
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  )
}

function GraphSvgDefs() {
  return (
    <defs>
      <radialGradient id="graph-core-gradient" cx="50%" cy="42%" r="68%">
        <stop offset="0%" stopColor="rgba(196, 167, 126, 0.96)" />
        <stop offset="52%" stopColor="rgba(141, 111, 77, 0.94)" />
        <stop offset="100%" stopColor="rgba(75, 58, 41, 0.98)" />
      </radialGradient>
      <radialGradient id="graph-shell-gradient" cx="50%" cy="50%" r="70%">
        <stop offset="0%" stopColor="rgba(34, 27, 21, 0.12)" />
        <stop offset="100%" stopColor="rgba(14, 12, 10, 0.86)" />
      </radialGradient>
      <radialGradient id="graph-inset-gradient" cx="50%" cy="50%" r="70%">
        <stop offset="0%" stopColor="rgba(27, 21, 16, 0.92)" />
        <stop offset="100%" stopColor="rgba(10, 9, 8, 0.98)" />
      </radialGradient>
    </defs>
  )
}

function ThemeGlyph({ node }: { node: DisplayNode }) {
  return (
    <>
      <circle className="graph-screen__node-bloom" r={node.radius * 1.9} />
      <circle className="graph-screen__node-shell" r={node.radius + 8} />
      <circle className="graph-screen__node-ring graph-screen__node-ring--outer" r={node.radius + 34} />
      <circle className="graph-screen__node-ring graph-screen__node-ring--middle" r={node.radius + 16} />
      <circle className="graph-screen__node-ring graph-screen__node-ring--inner" r={node.radius + 6} />
      <circle className="graph-screen__node-core" r={node.radius} />
      <circle className="graph-screen__node-core-inset" r={node.radius * 0.58} />
      <circle className="graph-screen__node-dot" r="4" />
    </>
  )
}

function ArtistGlyph({ node }: { node: DisplayNode }) {
  return (
    <>
      <circle className="graph-screen__node-bloom" r={node.radius + 30} />
      <circle className="graph-screen__node-shell" r={node.radius + 7} />
      <circle className="graph-screen__node-ring graph-screen__node-ring--outer" r={node.radius + 20} />
      <circle className="graph-screen__node-ring graph-screen__node-ring--artist" r={node.radius + 8} />
      <circle className="graph-screen__node-ring graph-screen__node-ring--inner" r={node.radius + 2.5} />
      <circle className="graph-screen__node-core" r={node.radius} />
      <circle className="graph-screen__node-core-inset" r={Math.max(node.radius * 0.54, 10)} />
      <circle className="graph-screen__node-dot" r="3" />
    </>
  )
}

function TrackGlyph({ node }: { node: DisplayNode }) {
  return (
    <>
      <circle className="graph-screen__node-bloom" r={node.radius + 16} />
      <circle className="graph-screen__node-shell graph-screen__node-shell--track" r={node.radius + 4} />
      <circle className="graph-screen__node-ring graph-screen__node-ring--outer" r={node.radius + 10} />
      <circle className="graph-screen__node-ring graph-screen__node-ring--inner" r={node.radius + 2} />
      <circle className="graph-screen__node-core graph-screen__node-core--track" r={node.radius} />
      <circle className="graph-screen__node-core-inset" r={Math.max(node.radius * 0.46, 4.5)} />
      <circle className="graph-screen__node-dot" r="2.4" />
    </>
  )
}

interface GraphMobileViewProps {
  archiveTotals: { sectionCount: number; artistCount: number; trackCount: number }
  contextCard: ReturnType<typeof buildContextCard>
  currentFocusGraph: FocusGraph | null
  currentFocusNodeKey: string | null
  currentFocusSection: SectionOverview | null
  error: string | null
  focusNodeMap: Map<string, DisplayNode>
  focusSectionKey: string | null
  loading: boolean
  matchedSectionKey: string | null
  mobileFocusNodes: DisplayNode[]
  mobileFocusViewBox: string
  mobileOverviewFocus: SectionOverview | null
  mobileOverviewViewBox: string
  onBack: () => void
  onCloseSection: () => void
  onExploreArtist: () => void
  onOpenSection: (sectionKey: string) => void
  onResetFocus: () => void
  onSelectKey: Dispatch<SetStateAction<string | null>>
  onSetCompactZoom: Dispatch<SetStateAction<number>>
  overviewSpotlightKey: string | null
  sections: SectionOverview[]
  selectedArtist: ArtistResponse | null
  selectedNode: DisplayNode | null
  zoomLevel: number
}

function GraphMobileView({
  archiveTotals,
  contextCard,
  currentFocusGraph,
  currentFocusNodeKey,
  currentFocusSection,
  error,
  focusNodeMap,
  focusSectionKey,
  loading,
  matchedSectionKey,
  mobileFocusNodes,
  mobileFocusViewBox,
  mobileOverviewFocus,
  mobileOverviewViewBox,
  onBack,
  onCloseSection,
  onExploreArtist,
  onOpenSection,
  onResetFocus,
  onSelectKey,
  onSetCompactZoom,
  overviewSpotlightKey,
  sections,
  selectedArtist,
  selectedNode,
  zoomLevel,
}: GraphMobileViewProps) {
  const focusIndex = mobileFocusNodes.findIndex((node) => node.key === currentFocusNodeKey)
  const canStepBackward = focusIndex > 0
  const canStepForward = focusIndex >= 0 && focusIndex < mobileFocusNodes.length - 1
  const compactActivityModel = buildActivityModel(currentFocusGraph, currentFocusNodeKey)

  return (
    <div className="graph-screen graph-screen--compact">
      <div className="graph-screen__header graph-screen__header--compact">
        <div className="graph-screen__heading">
          <button type="button" className="graph-screen__back" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Return
          </button>

          <div className="graph-screen__title-wrap">
            <p className="graph-screen__eyebrow">
              {currentFocusSection ? 'Focused constellation' : 'Guided archive map'}
            </p>
            <h1 className="graph-screen__title">
              {currentFocusSection ? currentFocusSection.label : 'Constellated archive of remembered sound'}
            </h1>
            <p className="graph-screen__meta">
              {currentFocusSection
                ? `${currentFocusSection.summary}. Follow one voice at a time and let the brighter threads guide the next step.`
                : 'Each card opens a curated memory current. The stage stays readable while the details travel with your thumb.'}
            </p>
          </div>
        </div>

        <div className="graph-screen__atlas graph-screen__atlas--compact">
          <div className="graph-screen__atlas-line">
            <span>constellations</span>
            <strong>{currentFocusSection ? 1 : archiveTotals.sectionCount}</strong>
          </div>
          <div className="graph-screen__atlas-line">
            <span>voices</span>
            <strong>{currentFocusSection ? currentFocusSection.artistCount : archiveTotals.artistCount}</strong>
          </div>
          <div className="graph-screen__atlas-line">
            <span>recordings</span>
            <strong>{currentFocusSection ? currentFocusSection.trackCount : archiveTotals.trackCount}</strong>
          </div>
        </div>
      </div>

      <div className="graph-screen__compact-body">
        <div className="graph-screen__compact-stage-shell">
          <div className="graph-screen__compact-toolbar">
            {currentFocusSection ? (
              <>
                <button type="button" className="graph-screen__mode-action" onClick={onCloseSection}>
                  All constellations
                </button>
                <button type="button" className="graph-screen__mode-action" onClick={onResetFocus}>
                  Reset focus
                </button>
                <button
                  type="button"
                  className="graph-screen__mode-action"
                  onClick={() => onSetCompactZoom((current) => (current > 1 ? 1 : 1.28))}
                >
                  {zoomLevel > 1 ? 'Wider view' : 'Closer view'}
                </button>
              </>
            ) : (
              <>
                <span className="graph-screen__mode-pill">guided mobile lens</span>
                {mobileOverviewFocus && (
                  <button type="button" className="graph-screen__mode-action" onClick={() => onOpenSection(mobileOverviewFocus.key)}>
                    Focus matched current
                  </button>
                )}
              </>
            )}
          </div>

          <div className="graph-screen__compact-stage">
            {loading && (
              <div className="graph-screen__overlay">
                <p>Loading memory field…</p>
              </div>
            )}

            {error && (
              <div className="graph-screen__overlay">
                <p className="graph-screen__overlay-error">{error}</p>
              </div>
            )}

            {!loading && !error && !currentFocusSection && (
              <svg className="graph-screen__compact-svg" viewBox={mobileOverviewViewBox} aria-hidden="true">
                <GraphSvgDefs />
                {THEME_LINKS.map(([sourceKey, targetKey]) => {
                  const source = sections.find((section) => section.key === sourceKey)
                  const target = sections.find((section) => section.key === targetKey)
                  if (!source || !target) return null

                  const relationClass = getOverviewRelationClass(sourceKey, targetKey, overviewSpotlightKey)
                  return (
                    <g key={`compact-section-edge:${sourceKey}:${targetKey}`} className={`graph-screen__section-link ${relationClass}`}>
                      <g className="graph-screen__edge-body">
                        <path d={buildSectionCurve(source, target)} className="graph-screen__section-link-glow" pathLength={1} />
                        <path d={buildSectionCurve(source, target)} className="graph-screen__section-link-line" pathLength={1} />
                      </g>
                    </g>
                  )
                })}

                {sections.map((section) => {
                  const sectionClass = getOverviewSectionClass(section.key, overviewSpotlightKey, matchedSectionKey)
                  return (
                    <g key={section.key} transform={`translate(${section.x}, ${section.y})`} className={`graph-screen__section ${sectionClass}`}>
                      <g className="graph-screen__section-body">
                        <circle className="graph-screen__section-bloom" r={section.radius * section.haloScale} />
                        <circle className="graph-screen__section-ring graph-screen__section-ring--outer" r={section.radius + 58} />
                        <circle className="graph-screen__section-ring graph-screen__section-ring--middle" r={section.radius + 28} />
                        <circle className="graph-screen__section-ring graph-screen__section-ring--inner" r={section.radius + 12} />
                        <circle className="graph-screen__section-core-shadow" r={section.radius + 5} />
                        <circle className="graph-screen__section-core" r={section.radius} />
                        <circle className="graph-screen__section-core-inset" r={section.radius * 0.58} />
                        <circle className="graph-screen__section-dot" r="3" />
                        <text textAnchor="middle" y={section.radius + 22} className="graph-screen__label graph-screen__label--theme">
                          {formatGraphLabel(section.label)}
                        </text>
                      </g>
                    </g>
                  )
                })}
              </svg>
            )}

            {!loading && !error && currentFocusSection && currentFocusGraph && (
              <svg className="graph-screen__compact-svg" viewBox={mobileFocusViewBox} aria-hidden="true">
                <GraphSvgDefs />
                {currentFocusGraph.edges.map((edge) => {
                  const source = focusNodeMap.get(edge.source)
                  const target = focusNodeMap.get(edge.target)
                  if (!source || !target) return null

                  const edgeClass = getEdgeActivityClass(edge.id, compactActivityModel)
                  return (
                    <g key={edge.id} className={`graph-screen__edge-group ${edgeClass}`}>
                      <g className="graph-screen__edge-body">
                        <line
                          x1={source.x}
                          y1={source.y}
                          x2={target.x}
                          y2={target.y}
                          className={`graph-screen__edge-glow graph-screen__edge-glow--${edge.kind}`}
                          pathLength={1}
                        />
                        <line
                          x1={source.x}
                          y1={source.y}
                          x2={target.x}
                          y2={target.y}
                          className={`graph-screen__edge graph-screen__edge--${edge.kind}`}
                          pathLength={1}
                        />
                      </g>
                    </g>
                  )
                })}

                {currentFocusGraph.nodes.map((node) => {
                  const nodeLevel = getNodeActivityLevel(node.key, compactActivityModel)
                  const isSelected = node.key === currentFocusNodeKey
                  const lines = splitLabel(node.label)

                  return (
                    <g
                      key={node.key}
                      transform={`translate(${node.x}, ${node.y})`}
                      className={`graph-screen__node graph-screen__node--${node.kind} is-${nodeLevel}${isSelected ? ' is-selected' : ''}`}
                    >
                      <g className="graph-screen__node-body">
                        {node.kind === 'theme' && <ThemeGlyph node={node} />}
                        {node.kind === 'artist' && <ArtistGlyph node={node} />}
                        {node.kind === 'track' && <TrackGlyph node={node} />}

                        <text
                          textAnchor="middle"
                          y={node.kind === 'theme' ? node.radius + 20 : node.radius + 18}
                          className={`graph-screen__label graph-screen__label--${node.kind}`}
                        >
                          {formatGraphLabel(lines[0])}
                        </text>
                        {lines[1] && (
                          <text
                            textAnchor="middle"
                            y={node.kind === 'theme' ? node.radius + 34 : node.radius + 32}
                            className={`graph-screen__label graph-screen__label--${node.kind}`}
                          >
                            {formatGraphLabel(lines[1])}
                          </text>
                        )}

                        {node.subtitle && (
                          <text
                            textAnchor="middle"
                            y={node.kind === 'theme' ? node.radius + 48 : node.radius + 44}
                            className={`graph-screen__sublabel graph-screen__sublabel--${node.kind}`}
                          >
                            {node.subtitle}
                          </text>
                        )}
                      </g>
                    </g>
                  )
                })}
              </svg>
            )}
          </div>
        </div>

        {!loading && !error && !currentFocusSection && (
          <div className="graph-screen__mobile-card-rail">
            {sections.map((section) => {
              const active = section.key === (overviewSpotlightKey ?? mobileOverviewFocus?.key)
              return (
                <article key={section.key} className={`graph-screen__mobile-card${active ? ' is-active' : ''}`}>
                  <p className="graph-screen__mobile-card-eyebrow">
                    {section.artistCount} voices · {section.trackCount} recordings
                  </p>
                  <h2 className="graph-screen__mobile-card-title">{section.label}</h2>
                  <p className="graph-screen__mobile-card-copy">{section.summary}</p>
                  <button type="button" className="graph-screen__detail-primary" onClick={() => onOpenSection(section.key)}>
                    Enter constellation
                  </button>
                </article>
              )
            })}
          </div>
        )}

        {!loading && !error && currentFocusSection && (
          <>
            <div className="graph-screen__mobile-nav-actions">
              <button
                type="button"
                className="graph-screen__mode-action"
                disabled={!canStepBackward}
                onClick={() => canStepBackward && onSelectKey(mobileFocusNodes[focusIndex - 1]?.key ?? null)}
              >
                Previous
              </button>
              <button
                type="button"
                className="graph-screen__mode-action"
                disabled={!canStepForward}
                onClick={() => canStepForward && onSelectKey(mobileFocusNodes[focusIndex + 1]?.key ?? null)}
              >
                Next
              </button>
            </div>

            <div className="graph-screen__mobile-card-rail graph-screen__mobile-card-rail--focus">
              {mobileFocusNodes.map((node) => (
                <button
                  key={node.key}
                  type="button"
                  className={`graph-screen__mobile-focus-card${node.key === currentFocusNodeKey ? ' is-active' : ''}`}
                  onClick={() => onSelectKey(node.key)}
                >
                  <span className="graph-screen__mobile-focus-kind">{node.kind}</span>
                  <strong className="graph-screen__mobile-focus-title">{node.label}</strong>
                  <span className="graph-screen__mobile-focus-copy">{node.subtitle}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {!loading && !error && (
          <div className="graph-screen__context-panel graph-screen__context-panel--compact">
            {contextCard ? (
              <>
                <p className="graph-screen__context-eyebrow">{contextCard.eyebrow}</p>
                <h2 className="graph-screen__context-title">{contextCard.title}</h2>
                <p className="graph-screen__context-copy">{contextCard.body}</p>
                <div className="graph-screen__context-meta">
                  {contextCard.meta.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="graph-screen__context-eyebrow">Reading the field</p>
                <h2 className="graph-screen__context-title">
                  {currentFocusSection ? currentFocusSection.label : 'Primary constellations'}
                </h2>
                <p className="graph-screen__context-copy">
                  {currentFocusSection
                    ? 'Use the cards to step between people, recordings, and the cluster anchor. The stage recenters itself so no precise drag is required.'
                    : 'Start from a cluster card, then let the stage and dossier move together as you focus the archive.'}
                </p>
              </>
            )}
          </div>
        )}

        {focusSectionKey && selectedNode && (
          <aside className="graph-screen__dossier graph-screen__dossier--compact" aria-labelledby="graph-node-title-mobile">
            <button
              type="button"
              className="graph-screen__dossier-close"
              onClick={() => onSelectKey(null)}
              aria-label="Close details"
            >
              ×
            </button>

            <p className="graph-screen__detail-kind">
              {selectedNode.kind === 'theme' ? 'cluster anchor' : selectedNode.kind}
            </p>
            <h2 id="graph-node-title-mobile" className="graph-screen__detail-title">{selectedNode.label}</h2>
            <p className="graph-screen__detail-subtitle">{selectedNode.subtitle}</p>

            {selectedNode.kind === 'artist' && selectedArtist && (
              <>
                <p className="graph-screen__detail-body">{selectedArtist.artist.bio}</p>
                <div className="graph-screen__detail-meta">
                  <span>{currentFocusSection?.label}</span>
                  <span>{selectedArtist.tracks.length} recordings</span>
                  <span>{selectedArtist.related.length} nearby ties</span>
                </div>
                <div className="graph-screen__detail-actions">
                  <button type="button" className="graph-screen__detail-primary" onClick={onExploreArtist}>
                    Open dossier
                  </button>
                  {selectedArtist.artist.source_url && (
                    <a
                      className="graph-screen__detail-secondary"
                      href={selectedArtist.artist.source_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source
                    </a>
                  )}
                </div>
              </>
            )}

            {selectedNode.kind === 'track' && selectedNode.track && (
              <>
                <p className="graph-screen__detail-body">
                  {selectedNode.track.title} fixes this lineage to an actual recording, turning a conceptual thread into an audible trace.
                </p>
                <div className="graph-screen__detail-meta">
                  <span>{selectedNode.track.year}</span>
                  <span>{selectedNode.track.duration_s}s</span>
                  <span>{selectedArtist?.artist.name ?? 'recorded trace'}</span>
                </div>
              </>
            )}

            {selectedNode.kind === 'theme' && currentFocusSection && (
              <>
                <p className="graph-screen__detail-body">
                  {currentFocusSection.summary}. This anchor keeps the constellation readable while the surrounding voices rotate into focus.
                </p>
                <div className="graph-screen__detail-meta">
                  <span>{currentFocusSection.label}</span>
                  <span>{currentFocusSection.artistCount} voices</span>
                  <span>{currentFocusSection.trackCount} recordings</span>
                </div>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

function buildMobileOverviewViewBox(section: SectionOverview | null) {
  if (!section) {
    return `0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`
  }

  const width = 1500
  const height = 1040
  const x = clamp(section.x - width / 2, 0, WORLD_WIDTH - width)
  const y = clamp(section.y - height / 2, 0, WORLD_HEIGHT - height)
  return `${x} ${y} ${width} ${height}`
}

function buildMobileFocusViewBox(graph: FocusGraph | null, activeKey: string | null, zoomLevel: number) {
  if (!graph || graph.nodes.length === 0) {
    return `${FOCUS_CENTER_X - 520} ${FOCUS_CENTER_Y - 420} 1040 840`
  }

  const activeNode = activeKey
    ? graph.nodes.find((node) => node.key === activeKey) ?? null
    : graph.nodes.find((node) => node.kind === 'theme') ?? graph.nodes[0]
  const width = 1160 / zoomLevel
  const height = 900 / zoomLevel
  const centerX = activeNode?.x ?? FOCUS_CENTER_X
  const centerY = activeNode?.y ?? FOCUS_CENTER_Y
  const x = clamp(centerX - width / 2, 0, WORLD_WIDTH - width)
  const y = clamp(centerY - height / 2, 0, WORLD_HEIGHT - height)
  return `${x} ${y} ${width} ${height}`
}

function buildMobileNodeDeck(graph: FocusGraph | null) {
  if (!graph) return []

  const deck = [...graph.nodes].sort((left, right) => {
    const kindWeight = kindRank(left.kind) - kindRank(right.kind)
    if (kindWeight !== 0) return kindWeight
    return right.importance - left.importance
  })

  return deck
}

function kindRank(kind: DisplayNodeKind) {
  if (kind === 'theme') return 0
  if (kind === 'artist') return 1
  return 2
}

function buildGraphModel(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  detailMap: Record<string, ArtistResponse>,
): GraphModel {
  const sortedArtists = [...rawNodes].sort((a, b) => a.name.localeCompare(b.name))
  const nodeById = new Map(sortedArtists.map((node) => [node.id, node] as const))
  const degreeMap = buildDegreeMap(rawEdges)
  const themeGroups = THEME_SECTIONS.map((theme) => ({
    ...theme,
    artists: theme.artistIds.map((id) => nodeById.get(id)).filter((node): node is GraphNode => Boolean(node)),
  })).filter((theme) => theme.artists.length > 0)
  const assignedIds = new Set(themeGroups.flatMap((theme) => theme.artists.map((artist) => artist.id)))
  const unassignedArtists = sortedArtists.filter((artist) => !assignedIds.has(artist.id))

  if (unassignedArtists.length > 0) {
    themeGroups.push({
      key: 'cross-currents',
      label: 'Cross Currents',
      summary: 'Artists who bridge multiple currents',
      artistIds: unassignedArtists.map((artist) => artist.id),
      artists: unassignedArtists,
    })
  }

  const sections = buildSections(themeGroups, detailMap)
  const focusGraphs = Object.fromEntries(
    themeGroups.map((theme) => [
      theme.key,
      buildFocusGraph(theme.key, theme.label, theme.summary, theme.artists, rawEdges, nodeById, degreeMap, detailMap),
    ]),
  )

  return { sections, focusGraphs }
}

function buildSections(
  themes: Array<ThemeSection & { artists: GraphNode[] }>,
  detailMap: Record<string, ArtistResponse>,
): SectionOverview[] {
  return themes.map((theme, index) => {
    const { key, label, summary, artists } = theme
    const preset = THEME_LAYOUTS[key] ?? fallbackSectionLayout(index, themes.length)
    const trackCount = artists.reduce((sum, artist) => sum + (detailMap[artist.id]?.tracks.length ?? 0), 0)
    const radius = clamp(preset.radius + artists.length * 10 + trackCount * 1.2, 152, 224)

    return {
      key,
      label,
      summary,
      x: preset.x,
      y: preset.y,
      radius,
      artistIds: artists.map((artist) => artist.id),
      artistCount: artists.length,
      trackCount,
      labelX: preset.labelX,
      labelY: preset.labelY,
      labelAlign: preset.labelAlign,
      haloScale: preset.haloScale,
      dust: buildDustPoints(key, radius, clamp(artists.length * 3 + 3, 9, 16)),
    }
  })
}

function buildFocusGraph(
  themeKey: string,
  themeLabel: string,
  themeSummary: string,
  artists: GraphNode[],
  rawEdges: GraphEdge[],
  nodeById: Map<string, GraphNode>,
  degreeMap: Map<string, number>,
  detailMap: Record<string, ArtistResponse>,
): FocusGraph {
  const primaryIds = new Set(artists.map((artist) => artist.id))
  const secondaryIds = new Set<string>()

  rawEdges.forEach((edge) => {
    if (primaryIds.has(edge.source) && !primaryIds.has(edge.target)) secondaryIds.add(edge.target)
    if (primaryIds.has(edge.target) && !primaryIds.has(edge.source)) secondaryIds.add(edge.source)
  })

  const rankedArtists = [...artists].sort((a, b) => {
    const aWeight = (degreeMap.get(a.id) ?? 0) * 3 + (detailMap[a.id]?.tracks.length ?? a.track_count)
    const bWeight = (degreeMap.get(b.id) ?? 0) * 3 + (detailMap[b.id]?.tracks.length ?? b.track_count)
    return bWeight - aWeight
  })

  const nodes: DisplayNode[] = []
  const edges: DisplayEdge[] = []
  const centerX = FOCUS_CENTER_X
  const centerY = FOCUS_CENTER_Y
  const trackTotal = artists.reduce((sum, artist) => sum + (detailMap[artist.id]?.tracks.length ?? 0), 0)

  nodes.push({
    key: `theme:${themeKey}`,
    kind: 'theme',
    label: themeLabel,
    subtitle: `${artists.length} voices · ${trackTotal} recordings · ${themeSummary}`,
    x: centerX,
    y: centerY,
    baseX: centerX,
    baseY: centerY,
    radius: clamp(136 + artists.length * 2 + trackTotal * 0.2, 138, 166),
    color: 'rgba(130, 104, 75, 0.92)',
    stroke: 'rgba(224, 201, 162, 0.72)',
    draggable: false,
    importance: 1,
    themeKey,
  })

  rankedArtists.forEach((artist, index) => {
    const angle = PRIMARY_ARTIST_ANGLES[index % PRIMARY_ARTIST_ANGLES.length] + Math.floor(index / PRIMARY_ARTIST_ANGLES.length) * 0.18
    const orbitBand = index < 4 ? 0 : index < 7 ? 1 : 2
    const orbit = 332 + orbitBand * 118 + (index % 3) * 18
    const eccentricity = 0.66 + ((index + artist.name.length) % 4) * 0.08
    const x = clamp(centerX + Math.cos(angle) * orbit, WORLD_PADDING, WORLD_WIDTH - WORLD_PADDING)
    const y = clamp(centerY + Math.sin(angle) * orbit * eccentricity, WORLD_PADDING, WORLD_HEIGHT - WORLD_PADDING)
    const degree = degreeMap.get(artist.id) ?? 0
    const trackCount = detailMap[artist.id]?.tracks.length ?? artist.track_count
    const artistWeight = degree * 1.5 + trackCount * 2.1

    nodes.push({
      key: `artist:${artist.id}`,
      kind: 'artist',
      label: artist.name,
      subtitle: `${artist.born}-${artist.died}`,
      x,
      y,
      baseX: x,
      baseY: y,
      radius: clamp(22 + artistWeight * 1.35, 24, 54),
      color: 'rgba(129, 105, 73, 0.9)',
      stroke: 'rgba(231, 216, 187, 0.76)',
      draggable: true,
      importance: degree + trackCount,
      artistId: artist.id,
      graphNode: artist,
      themeKey,
    })

    edges.push({
      id: `edge:theme:${themeKey}:${artist.id}`,
      source: `theme:${themeKey}`,
      target: `artist:${artist.id}`,
      kind: 'artist-theme',
    })

    detailMap[artist.id]?.tracks.forEach((track, trackIndex) => {
      const trackAngle =
        angle +
        0.64 +
        (trackIndex / Math.max(detailMap[artist.id]?.tracks.length ?? 1, 1)) * Math.PI * 1.54
      const trackOrbit = 110 + ((trackIndex + degree) % 3) * 14
      const trackX = clamp(x + Math.cos(trackAngle) * trackOrbit, WORLD_PADDING, WORLD_WIDTH - WORLD_PADDING)
      const trackY = clamp(y + Math.sin(trackAngle) * trackOrbit * 0.84, WORLD_PADDING, WORLD_HEIGHT - WORLD_PADDING)

      nodes.push({
        key: `track:${artist.id}:${track.id}`,
        kind: 'track',
        label: track.title,
        subtitle: String(track.year),
        x: trackX,
        y: trackY,
        baseX: trackX,
        baseY: trackY,
        radius: clamp(9 + (track.duration_s / 60) * 0.4, 9, 14),
        color: 'rgba(123, 98, 69, 0.86)',
        stroke: 'rgba(211, 194, 167, 0.66)',
        draggable: false,
        importance: 0,
        artistId: artist.id,
        track,
        themeKey,
      })

      edges.push({
        id: `edge:track:${artist.id}:${track.id}`,
        source: `artist:${artist.id}`,
        target: `track:${artist.id}:${track.id}`,
        kind: 'artist-track',
      })
    })
  })

  const secondaryArray = [...secondaryIds].map((id) => nodeById.get(id)).filter((node): node is GraphNode => Boolean(node))

  secondaryArray.forEach((artist, index) => {
    const angle = SECONDARY_ARTIST_ANGLES[index % SECONDARY_ARTIST_ANGLES.length] + Math.floor(index / SECONDARY_ARTIST_ANGLES.length) * 0.16
    const orbit = 770 + (index % 3) * 58
    const x = clamp(centerX + Math.cos(angle) * orbit, WORLD_PADDING, WORLD_WIDTH - WORLD_PADDING)
    const y = clamp(centerY + Math.sin(angle) * orbit * 0.72, WORLD_PADDING, WORLD_HEIGHT - WORLD_PADDING)
    const degree = degreeMap.get(artist.id) ?? 0

    nodes.push({
      key: `artist:${artist.id}`,
      kind: 'artist',
      label: artist.name,
      subtitle: 'nearby current',
      x,
      y,
      baseX: x,
      baseY: y,
      radius: clamp(16 + degree * 0.9, 16, 26),
      color: 'rgba(98, 80, 57, 0.78)',
      stroke: 'rgba(184, 167, 141, 0.52)',
      draggable: true,
      importance: 0,
      artistId: artist.id,
      graphNode: artist,
      themeKey: themeKeyForArtist(artist.id),
    })
  })

  rawEdges.forEach((edge) => {
    const sourceIncluded = primaryIds.has(edge.source) || secondaryIds.has(edge.source)
    const targetIncluded = primaryIds.has(edge.target) || secondaryIds.has(edge.target)
    if (!sourceIncluded || !targetIncluded) return

    edges.push({
      id: `edge:${edge.source}:${edge.target}:${edge.relation}`,
      source: `artist:${edge.source}`,
      target: `artist:${edge.target}`,
      kind: 'artist-link',
    })
  })

  const laidOutNodes = runLayout(nodes, edges)
  return { nodes: laidOutNodes, edges }
}

function runLayout(initialNodes: DisplayNode[], edges: DisplayEdge[]): DisplayNode[] {
  const nodes = initialNodes.map((node) => ({ ...node, vx: 0, vy: 0 }))
  const nodeIndex = new Map(nodes.map((node, index) => [node.key, index]))

  for (let step = 0; step < 380; step++) {
    const fx = new Float32Array(nodes.length)
    const fy = new Float32Array(nodes.length)

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x
        const dy = nodes[i].y - nodes[j].y
        const distanceSquared = dx * dx + dy * dy + 0.01
        const distance = Math.sqrt(distanceSquared)
        const repulsion = repulsionFor(nodes[i].kind, nodes[j].kind) / distanceSquared
        fx[i] += (repulsion * dx) / distance
        fy[i] += (repulsion * dy) / distance
        fx[j] -= (repulsion * dx) / distance
        fy[j] -= (repulsion * dy) / distance

        const minimumDistance = collisionDistanceFor(nodes[i], nodes[j])
        if (distance < minimumDistance) {
          const overlap = (minimumDistance - distance) / minimumDistance
          const push = overlap * 1.9
          fx[i] += (push * dx) / distance
          fy[i] += (push * dy) / distance
          fx[j] -= (push * dx) / distance
          fy[j] -= (push * dy) / distance
        }
      }
    }

    for (const edge of edges) {
      const sourceIndex = nodeIndex.get(edge.source)
      const targetIndex = nodeIndex.get(edge.target)
      if (sourceIndex == null || targetIndex == null) continue

      const source = nodes[sourceIndex]
      const target = nodes[targetIndex]
      const dx = target.x - source.x
      const dy = target.y - source.y
      const distance = Math.sqrt(dx * dx + dy * dy) + 0.01
      const idealLength = edgeLengthFor(edge.kind)
      const spring = edgeStrengthFor(edge.kind) * (distance - idealLength)
      fx[sourceIndex] += (spring * dx) / distance
      fy[sourceIndex] += (spring * dy) / distance
      fx[targetIndex] -= (spring * dx) / distance
      fy[targetIndex] -= (spring * dy) / distance
    }

    for (let i = 0; i < nodes.length; i++) {
      const anchorStrength = anchorFor(nodes[i].kind)
      fx[i] += (nodes[i].baseX - nodes[i].x) * anchorStrength
      fy[i] += (nodes[i].baseY - nodes[i].y) * anchorStrength

      nodes[i].vx = (nodes[i].vx + fx[i]) * 0.78
      nodes[i].vy = (nodes[i].vy + fy[i]) * 0.78
      nodes[i].x = clamp(nodes[i].x + nodes[i].vx, WORLD_PADDING, WORLD_WIDTH - WORLD_PADDING)
      nodes[i].y = clamp(nodes[i].y + nodes[i].vy, WORLD_PADDING, WORLD_HEIGHT - WORLD_PADDING)
    }
  }

  return nodes.map(({ vx, vy, ...node }) => {
    void vx
    void vy
    return node
  })
}

function repulsionFor(a: DisplayNodeKind, b: DisplayNodeKind): number {
  if (a === 'theme' || b === 'theme') return 210000
  if (a === 'track' && b === 'track') return 18000
  if (a === 'track' || b === 'track') return 26000
  return 62000
}

function edgeLengthFor(kind: DisplayEdgeKind): number {
  if (kind === 'artist-track') return 132
  if (kind === 'artist-theme') return 318
  return 372
}

function edgeStrengthFor(kind: DisplayEdgeKind): number {
  if (kind === 'artist-track') return 0.078
  if (kind === 'artist-theme') return 0.056
  return 0.03
}

function anchorFor(kind: DisplayNodeKind): number {
  if (kind === 'theme') return 0.14
  if (kind === 'track') return 0.14
  return 0.04
}

function collisionDistanceFor(a: DisplayNode, b: DisplayNode) {
  const themePadding = a.kind === 'theme' || b.kind === 'theme' ? 34 : 18
  const trackPadding = a.kind === 'track' || b.kind === 'track' ? 10 : 0
  return a.radius + b.radius + themePadding + trackPadding
}

function themeKeyForArtist(artistId: string): string {
  return THEME_SECTIONS.find((theme) => theme.artistIds.includes(artistId))?.key ?? 'cross-currents'
}

function buildDegreeMap(edges: GraphEdge[]): Map<string, number> {
  const degrees = new Map<string, number>()
  edges.forEach((edge) => {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1)
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1)
  })
  return degrees
}

function buildActivityModel(graph: FocusGraph | null, activeKey: string | null): ActivityModel | null {
  if (!graph || !activeKey) return null
  const adjacency = new Map<string, Array<{ key: string; edgeId: string }>>()

  graph.edges.forEach((edge) => {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, [])
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, [])
    adjacency.get(edge.source)?.push({ key: edge.target, edgeId: edge.id })
    adjacency.get(edge.target)?.push({ key: edge.source, edgeId: edge.id })
  })

  const nodeDepth = new Map<string, number>([[activeKey, 0]])
  const edgeDepth = new Map<string, number>()
  const queue = [activeKey]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    const currentDepth = nodeDepth.get(current) ?? 0
    if (currentDepth >= 2) continue

    adjacency.get(current)?.forEach(({ key, edgeId }) => {
      const nextDepth = currentDepth + 1
      edgeDepth.set(edgeId, Math.min(edgeDepth.get(edgeId) ?? Number.POSITIVE_INFINITY, nextDepth))
      if (!nodeDepth.has(key) || nextDepth < (nodeDepth.get(key) ?? Number.POSITIVE_INFINITY)) {
        nodeDepth.set(key, nextDepth)
        queue.push(key)
      }
    })
  }

  return { activeKey, nodeDepth, edgeDepth }
}

function buildContextCard(
  node: DisplayNode | null,
  focusSection: SectionOverview | null,
  artistDetails: Record<string, ArtistResponse>,
) {
  if (!node) return null

  if (node.kind === 'artist' && node.artistId) {
    const detail = artistDetails[node.artistId]
    return {
      eyebrow: 'Lineage in focus',
      title: node.label,
      body: focusSection
        ? `${node.label} sits inside ${focusSection.label}. The brighter lines show the nearest recordings and neighboring voices first.`
        : `${node.label} anchors a visible thread in the archive.`,
      meta: [
        `${detail?.tracks.length ?? node.graphNode?.track_count ?? 0} recordings`,
        `${detail?.related.length ?? 0} nearby ties`,
      ],
    }
  }

  if (node.kind === 'track' && node.track) {
    return {
      eyebrow: 'Audible trace',
      title: node.track.title,
      body: 'This recording pins the constellation to a specific sound document. Follow it back to the performer, then outward into adjacent lineage.',
      meta: [`${node.track.year}`, `${node.track.duration_s}s`],
    }
  }

  return {
    eyebrow: 'Cluster anchor',
    title: node.label,
    body: 'The central body gathers the current. Surrounding rings show how artists and recordings accumulate around a shared cultural memory.',
    meta: focusSection ? [`${focusSection.artistCount} voices`, `${focusSection.trackCount} recordings`] : [],
  }
}

function centerOnPoint(
  x: number,
  y: number,
  viewport: HTMLDivElement | null,
  behavior: ScrollBehavior,
  zoom: number,
) {
  if (!viewport) return

  viewport.scrollTo({
    left: clamp(x * zoom - viewport.clientWidth / 2, 0, WORLD_WIDTH * zoom - viewport.clientWidth),
    top: clamp(y * zoom - viewport.clientHeight / 2, 0, WORLD_HEIGHT * zoom - viewport.clientHeight),
    behavior,
  })
}

function startInertia(
  viewport: HTMLDivElement,
  frameRef: MutableRefObject<number | null>,
  startVelocityX: number,
  startVelocityY: number,
  onFrame: () => void,
) {
  stopInertia(frameRef)
  let velocityX = startVelocityX
  let velocityY = startVelocityY
  let previous = performance.now()

  const tick = (now: number) => {
    const delta = Math.min(now - previous, 34)
    previous = now
    velocityX *= 0.93
    velocityY *= 0.93
    viewport.scrollLeft += velocityX * delta
    viewport.scrollTop += velocityY * delta
    onFrame()

    if (Math.abs(velocityX) < 0.02 && Math.abs(velocityY) < 0.02) {
      frameRef.current = null
      return
    }

    frameRef.current = window.requestAnimationFrame(tick)
  }

  frameRef.current = window.requestAnimationFrame(tick)
}

function stopInertia(frameRef: MutableRefObject<number | null>) {
  if (frameRef.current != null) {
    window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }
}

function syncCameraDrift(
  viewport: HTMLDivElement | null,
  zoom: number,
  setCameraDrift: Dispatch<SetStateAction<{ x: number; y: number }>>,
) {
  if (!viewport) return
  const maxX = Math.max(WORLD_WIDTH * zoom - viewport.clientWidth, 1)
  const maxY = Math.max(WORLD_HEIGHT * zoom - viewport.clientHeight, 1)
  const driftX = (viewport.scrollLeft / maxX - 0.5) * -48
  const driftY = (viewport.scrollTop / maxY - 0.5) * -42
  setCameraDrift({ x: driftX, y: driftY })
}

function getNodeActivityLevel(key: string, activityModel: ActivityModel | null): ActivityLevel {
  if (!activityModel) return 'idle'
  if (key === activityModel.activeKey) return 'current'
  const depth = activityModel.nodeDepth.get(key)
  if (depth === 1) return 'direct'
  if (depth === 2) return 'echo'
  return 'muted'
}

function getEdgeActivityClass(edgeId: string, activityModel: ActivityModel | null): ActivityLevel {
  if (!activityModel) return 'idle'
  const depth = activityModel.edgeDepth.get(edgeId)
  if (depth === 1) return 'direct'
  if (depth === 2) return 'echo'
  return 'muted'
}

function getOverviewSectionClass(
  key: string,
  spotlightKey: string | null,
  matchedKey: string | null,
) {
  if (!spotlightKey) return key === matchedKey ? 'is-matched' : 'is-idle'
  if (key === spotlightKey) return 'is-active'
  if (isThemeAdjacent(key, spotlightKey)) return 'is-adjacent'
  if (key === matchedKey) return 'is-matched'
  return 'is-muted'
}

function getOverviewRelationClass(
  sourceKey: string,
  targetKey: string,
  spotlightKey: string | null,
) {
  if (!spotlightKey) return 'is-idle'
  if (sourceKey === spotlightKey || targetKey === spotlightKey) return 'is-direct'
  if (isThemeAdjacent(sourceKey, spotlightKey) && isThemeAdjacent(targetKey, spotlightKey)) return 'is-echo'
  return 'is-muted'
}

function buildSectionCurve(source: SectionOverview, target: SectionOverview) {
  const midpointX = (source.x + target.x) / 2
  const midpointY = (source.y + target.y) / 2
  const dx = target.x - source.x
  const dy = target.y - source.y
  const controlX = midpointX - dy * 0.14
  const controlY = midpointY + dx * 0.1
  return `M ${source.x} ${source.y} Q ${controlX} ${controlY} ${target.x} ${target.y}`
}

function splitLabel(label: string): [string, string?] {
  const parts = label.split(' ')
  if (parts.length <= 2) return [label]
  const midpoint = Math.ceil(parts.length / 2)
  return [parts.slice(0, midpoint).join(' '), parts.slice(midpoint).join(' ')]
}

function formatGraphLabel(label: string) {
  return label.toUpperCase()
}

function buildDustPoints(seed: string, radius: number, count: number): DustPoint[] {
  let hash = 0
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 2147483647
  }

  const points: DustPoint[] = []
  for (let index = 0; index < count; index++) {
    hash = (hash * 48271 + 1) % 2147483647
    const angle = ((hash % 360) * Math.PI) / 180
    hash = (hash * 48271 + 1) % 2147483647
    const distance = radius * (1.16 + ((hash % 84) / 100))
    hash = (hash * 48271 + 1) % 2147483647
    const pointRadius = 1.2 + (hash % 18) / 10
    hash = (hash * 48271 + 1) % 2147483647
    const opacity = 0.18 + (hash % 36) / 100

    points.push({
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance * 0.82,
      radius: pointRadius,
      opacity,
    })
  }

  return points
}

function isThemeAdjacent(a: string, b: string) {
  return THEME_LINKS.some(([source, target]) => (source === a && target === b) || (source === b && target === a))
}

function plaqueOffsetX(align: SectionLabelAlign, width: number) {
  if (align === 'center') return -width / 2
  if (align === 'end') return -width
  return 0
}

function buildStaggerDelay(index: number, total: number, offset = 0) {
  if (total <= 1) return offset
  return offset + Math.round((index / (total - 1)) * GRAPH_REVEAL_WINDOW_MS)
}

function fallbackSectionLayout(index: number, total: number): ThemeLayoutPreset {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2
  return {
    x: WORLD_WIDTH / 2 + Math.cos(angle) * 760,
    y: WORLD_HEIGHT / 2 + Math.sin(angle) * 620,
    labelX: WORLD_WIDTH / 2 + Math.cos(angle) * 980,
    labelY: WORLD_HEIGHT / 2 + Math.sin(angle) * 760,
    labelAlign: Math.cos(angle) > 0.25 ? 'end' : Math.cos(angle) < -0.25 ? 'start' : 'center',
    radius: 164,
    haloScale: 1.86,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
