export interface Artist {
  id: string
  name: string
  born: number
  died: number
  region: string
  bio: string
  photo_url: string
  era: string
  source_url?: string
  source_label?: string
}

export interface Track {
  id: string
  title: string
  year: number
  audio_url: string
  duration_s: number
}

export interface MatchBreakdown {
  vibe: number
  key: number
  tempo: number
  contour: number
}

export interface Connection {
  score: number
  explanation: string
  shared_features: string[]
  breakdown?: MatchBreakdown
  key_label?: string
  tempo_bpm?: number
  contour_label?: string
  mode_label?: string
}

export interface MatchResponse {
  artist: Artist
  track: Track
  connection: Connection
}

export interface ArtistResponse {
  artist: Artist
  related: { id: string; name: string; relation: string }[]
  tracks: Track[]
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  corpus_size: number
}

export interface GraphNode {
  id: string
  name: string
  born: number
  died: number
  era: string
  photo_url: string
  track_count: number
}

export interface GraphEdge {
  source: string
  target: string
  relation: string
}

export interface GraphResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
}
