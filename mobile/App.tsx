import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import Constants from 'expo-constants'
import { StatusBar } from 'expo-status-bar'
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio'
import type { ArtistResponse, GraphResponse, HealthResponse, MatchResponse } from './src/types/api'

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function detectApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim()
  if (explicit) return trimTrailingSlash(explicit)

  const hostUri = Constants.expoConfig?.hostUri?.trim()
  const host = hostUri?.split(':')[0]

  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return `http://${host}:8000`
  }

  return 'http://localhost:8000'
}

function resolveAssetUrl(apiBaseUrl: string, assetUrl: string): string {
  if (/^https?:\/\//i.test(assetUrl)) return assetUrl
  const normalizedPath = assetUrl.startsWith('/') ? assetUrl : `/${assetUrl}`
  return `${trimTrailingSlash(apiBaseUrl)}${normalizedPath}`
}

async function getJson<T>(apiBaseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${trimTrailingSlash(apiBaseUrl)}${path}`)
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }
  return response.json() as Promise<T>
}

async function postAssistedMatch(
  apiBaseUrl: string,
  mode: 'description' | 'link',
  value: string,
): Promise<MatchResponse> {
  const response = await fetch(`${trimTrailingSlash(apiBaseUrl)}/api/match/assisted`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, value }),
  })

  if (!response.ok) {
    throw new Error(`Assisted match failed with ${response.status}`)
  }

  return response.json() as Promise<MatchResponse>
}

async function postRecordedMatch(apiBaseUrl: string, uri: string): Promise<MatchResponse> {
  const form = new FormData()
  form.append('audio', {
    uri,
    name: 'recording.m4a',
    type: 'audio/m4a',
  } as never)

  const response = await fetch(`${trimTrailingSlash(apiBaseUrl)}/api/match`, {
    method: 'POST',
    body: form,
  })

  if (!response.ok) {
    throw new Error(`Audio match failed with ${response.status}`)
  }

  return response.json() as Promise<MatchResponse>
}

function scoreLabel(score: number): string {
  return `${Math.round(score * 100)}% resonance`
}

function yearRange(born: number, died: number): string {
  return `${born}-${died}`
}

function secondsLabel(value: number): string {
  const mins = Math.floor(value / 60)
  const secs = Math.round(value % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function audioDurationLabel(seconds: number): string {
  if (!seconds) return '0:00'
  return secondsLabel(seconds)
}

function TrackPlayer({
  apiBaseUrl,
  audioUrl,
}: {
  apiBaseUrl: string
  audioUrl: string
}) {
  const source = useMemo(() => resolveAssetUrl(apiBaseUrl, audioUrl), [apiBaseUrl, audioUrl])
  const player = useAudioPlayer(source, { updateInterval: 500, downloadFirst: true })
  const status = useAudioPlayerStatus(player)

  return (
    <View style={styles.inlineGroup}>
      <Pressable
        style={[styles.inlineButton, styles.inlineButtonPrimary]}
        onPress={() => {
          if (status.currentTime > 0 && status.didJustFinish) {
            player.seekTo(0)
          }
          player.play()
        }}
      >
        <Text style={[styles.inlineButtonText, styles.inlineButtonTextAccent]}>
          {status.playing ? 'Playing...' : 'Play Track'}
        </Text>
      </Pressable>
      <Pressable
        style={styles.inlineButton}
        onPress={() => {
          player.pause()
        }}
      >
        <Text style={styles.inlineButtonText}>Pause</Text>
      </Pressable>
      <Text style={styles.metaText}>
        {secondsLabel(status.currentTime)} / {secondsLabel(status.duration)}
      </Text>
    </View>
  )
}

export default function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(() => detectApiBaseUrl())
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [graph, setGraph] = useState<GraphResponse | null>(null)
  const [match, setMatch] = useState<MatchResponse | null>(null)
  const [artistDetails, setArtistDetails] = useState<ArtistResponse | null>(null)
  const [assistantInput, setAssistantInput] = useState('')
  const [assistantMode, setAssistantMode] = useState<'description' | 'link'>('description')
  const [loadingHealth, setLoadingHealth] = useState(false)
  const [matching, setMatching] = useState(false)
  const [loadingArtist, setLoadingArtist] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const recorderState = useAudioRecorderState(recorder, 250)

  useEffect(() => {
    void refreshOverview()
  }, [apiBaseUrl])

  async function refreshOverview() {
    setLoadingHealth(true)
    setError(null)

    try {
      const [healthData, graphData] = await Promise.all([
        getJson<HealthResponse>(apiBaseUrl, '/api/health'),
        getJson<GraphResponse>(apiBaseUrl, '/api/graph'),
      ])
      setHealth(healthData)
      setGraph(graphData)
    } catch (err) {
      setHealth(null)
      setGraph(null)
      setError(err instanceof Error ? err.message : 'Unable to reach the API.')
    } finally {
      setLoadingHealth(false)
    }
  }

  async function startRecording() {
    setError(null)

    const permission = await AudioModule.requestRecordingPermissionsAsync()
    if (!permission.granted) {
      setError('Microphone access is required to record a humming sample.')
      return
    }

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    })

    await recorder.prepareToRecordAsync()
    recorder.record()
  }

  async function stopAndMatch() {
    setMatching(true)
    setError(null)

    try {
      await recorder.stop()
      const uri = recorder.uri
      if (!uri) {
        throw new Error('No recording file was produced.')
      }

      const nextMatch = await postRecordedMatch(apiBaseUrl, uri)
      setMatch(nextMatch)
      setArtistDetails(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create a match from the recording.')
    } finally {
      setMatching(false)
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      })
    }
  }

  async function runAssistedMatch() {
    if (!assistantInput.trim()) {
      setError('Add a short melody description or a song link first.')
      return
    }

    setMatching(true)
    setError(null)

    try {
      const nextMatch = await postAssistedMatch(apiBaseUrl, assistantMode, assistantInput.trim())
      setMatch(nextMatch)
      setArtistDetails(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create an assisted match.')
    } finally {
      setMatching(false)
    }
  }

  async function loadArtistDetails() {
    if (!match) return

    setLoadingArtist(true)
    setError(null)

    try {
      const artist = await getJson<ArtistResponse>(apiBaseUrl, `/api/artists/${match.artist.id}`)
      setArtistDetails(artist)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the artist dossier.')
    } finally {
      setLoadingArtist(false)
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>Mobile Archive Client</Text>
          <Text style={styles.title}>Sillon on phone</Text>
          <Text style={styles.subtitle}>
            Scan the Expo QR code, hum into your phone, and query the same FastAPI archive your web app uses.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Connection</Text>
          <Text style={styles.cardBody}>
            The app tries to infer your computer&apos;s LAN address from the Expo QR session. You can override it here if needed.
          </Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setApiBaseUrl}
            placeholder="http://192.168.x.x:8000"
            placeholderTextColor="#6f7a8d"
            style={styles.input}
            value={apiBaseUrl}
          />
          <View style={styles.inlineGroup}>
            <Pressable style={[styles.inlineButton, styles.inlineButtonPrimary]} onPress={() => void refreshOverview()}>
              <Text style={[styles.inlineButtonText, styles.inlineButtonTextAccent]}>Refresh API</Text>
            </Pressable>
            {loadingHealth && <ActivityIndicator color="#e7d2a5" />}
          </View>
          <View style={styles.statRow}>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>Status</Text>
              <Text style={styles.statValue}>{health?.status ?? 'offline'}</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>Corpus</Text>
              <Text style={styles.statValue}>{health?.corpus_size ?? 0}</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>Graph</Text>
              <Text style={styles.statValue}>
                {graph ? `${graph.nodes.length} nodes` : 'n/a'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Hum Match</Text>
          <Text style={styles.cardBody}>
            Record a short vocal phrase and send it to `/api/match`.
          </Text>
          <View style={styles.inlineGroup}>
            {!recorderState.isRecording ? (
              <Pressable style={[styles.inlineButton, styles.inlineButtonPrimary]} onPress={() => void startRecording()}>
                <Text style={[styles.inlineButtonText, styles.inlineButtonTextAccent]}>Start Recording</Text>
              </Pressable>
            ) : (
              <Pressable style={[styles.inlineButton, styles.inlineButtonDanger]} onPress={() => void stopAndMatch()}>
                <Text style={styles.inlineButtonText}>Stop + Match</Text>
              </Pressable>
            )}
            {matching && <ActivityIndicator color="#e7d2a5" />}
          </View>
          <Text style={styles.metaText}>
            {recorderState.isRecording
              ? `Recording ${Math.round((recorderState.durationMillis ?? 0) / 1000)}s`
              : 'Ready for a fresh humming sample'}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Assisted Match</Text>
          <Text style={styles.cardBody}>
            Use a text description or a reference link and send it to `/api/match/assisted`.
          </Text>
          <View style={styles.inlineGroup}>
            <Pressable
              style={[
                styles.modeButton,
                assistantMode === 'description' ? styles.modeButtonActive : null,
              ]}
              onPress={() => setAssistantMode('description')}
            >
              <Text style={styles.modeButtonText}>Description</Text>
            </Pressable>
            <Pressable
              style={[
                styles.modeButton,
                assistantMode === 'link' ? styles.modeButtonActive : null,
              ]}
              onPress={() => setAssistantMode('link')}
            >
              <Text style={styles.modeButtonText}>Link</Text>
            </Pressable>
          </View>
          <TextInput
            multiline
            onChangeText={setAssistantInput}
            placeholder={
              assistantMode === 'description'
                ? 'A melody that feels wistful, rising, and circular...'
                : 'https://open.spotify.com/track/...'
            }
            placeholderTextColor="#6f7a8d"
            style={[styles.input, styles.textarea]}
            value={assistantInput}
          />
          <Pressable style={[styles.inlineButton, styles.inlineButtonPrimary]} onPress={() => void runAssistedMatch()}>
            <Text style={[styles.inlineButtonText, styles.inlineButtonTextAccent]}>Find a Match</Text>
          </Pressable>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {match ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Current Match</Text>
            <Image
              source={{ uri: resolveAssetUrl(apiBaseUrl, match.artist.photo_url) }}
              style={styles.artistImage}
            />
            <Text style={styles.artistName}>{match.artist.name}</Text>
            <Text style={styles.artistMeta}>
              {yearRange(match.artist.born, match.artist.died)} · {match.artist.region}
            </Text>
            <View style={styles.statRow}>
              <View style={styles.statPill}>
                <Text style={styles.statLabel}>Resonance</Text>
                <Text style={styles.statValue}>{scoreLabel(match.connection.score)}</Text>
              </View>
              <View style={styles.statPill}>
                <Text style={styles.statLabel}>Track</Text>
                <Text style={styles.statValue}>{match.track.year}</Text>
              </View>
              <View style={styles.statPill}>
                <Text style={styles.statLabel}>Length</Text>
                <Text style={styles.statValue}>{audioDurationLabel(match.track.duration_s)}</Text>
              </View>
            </View>
            <Text style={styles.trackTitle}>{match.track.title}</Text>
            <Text style={styles.cardBody}>{match.connection.explanation}</Text>
            <Text style={styles.sectionLabel}>Shared features</Text>
            <View style={styles.tagRow}>
              {match.connection.shared_features.map((feature) => (
                <View key={feature} style={styles.tag}>
                  <Text style={styles.tagText}>{feature}</Text>
                </View>
              ))}
            </View>
            <TrackPlayer apiBaseUrl={apiBaseUrl} audioUrl={match.track.audio_url} />
            <View style={styles.inlineGroup}>
              <Pressable style={[styles.inlineButton, styles.inlineButtonPrimary]} onPress={() => void loadArtistDetails()}>
                <Text style={[styles.inlineButtonText, styles.inlineButtonTextAccent]}>
                  {loadingArtist ? 'Loading...' : 'Open Dossier'}
                </Text>
              </Pressable>
              {match.artist.source_url ? (
                <Pressable
                  style={styles.inlineButton}
                  onPress={() => {
                    void Linking.openURL(match.artist.source_url!)
                  }}
                >
                  <Text style={styles.inlineButtonText}>
                    {match.artist.source_label ?? 'Source'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {artistDetails ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Artist Dossier</Text>
            <Text style={styles.cardBody}>{artistDetails.artist.bio}</Text>
            <Text style={styles.sectionLabel}>Related artists</Text>
            {artistDetails.related.length === 0 ? (
              <Text style={styles.metaText}>No related artists were returned.</Text>
            ) : (
              artistDetails.related.slice(0, 5).map((artist) => (
                <Text key={`${artist.id}-${artist.relation}`} style={styles.listItem}>
                  {artist.name} · {artist.relation}
                </Text>
              ))
            )}
            <Text style={styles.sectionLabel}>Tracks</Text>
            {artistDetails.tracks.slice(0, 5).map((track) => (
              <Text key={track.id} style={styles.listItem}>
                {track.title} · {track.year}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#07111a',
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 36,
    gap: 16,
  },
  heroCard: {
    padding: 22,
    borderRadius: 26,
    backgroundColor: '#102031',
    borderWidth: 1,
    borderColor: '#274057',
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  eyebrow: {
    color: '#d3b273',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  title: {
    color: '#f4f0e7',
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 10,
  },
  subtitle: {
    color: '#bfd0dd',
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#0e1a25',
    borderWidth: 1,
    borderColor: '#1f3141',
    gap: 12,
  },
  cardTitle: {
    color: '#f4f0e7',
    fontSize: 20,
    fontWeight: '700',
  },
  cardBody: {
    color: '#c7d4de',
    fontSize: 14,
    lineHeight: 21,
  },
  input: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2b4156',
    backgroundColor: '#09131c',
    color: '#f4f0e7',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  textarea: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  inlineGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  inlineButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#30485e',
    backgroundColor: '#122232',
  },
  inlineButtonPrimary: {
    backgroundColor: '#cda35c',
    borderColor: '#cda35c',
  },
  inlineButtonDanger: {
    backgroundColor: '#b25345',
    borderColor: '#b25345',
  },
  inlineButtonText: {
    color: '#eef4f8',
    fontSize: 14,
    fontWeight: '700',
  },
  inlineButtonTextAccent: {
    color: '#08121c',
  },
  modeButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#122232',
    borderWidth: 1,
    borderColor: '#30485e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeButtonActive: {
    backgroundColor: '#23405a',
    borderColor: '#d3b273',
  },
  modeButtonText: {
    color: '#e8eef4',
    fontWeight: '600',
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statPill: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: '#09131c',
    borderWidth: 1,
    borderColor: '#213244',
    minWidth: 92,
  },
  statLabel: {
    color: '#89a1b5',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  statValue: {
    color: '#f4f0e7',
    fontSize: 14,
    fontWeight: '700',
  },
  metaText: {
    color: '#8ea5b8',
    fontSize: 13,
  },
  errorCard: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#3a1818',
    borderWidth: 1,
    borderColor: '#7f3131',
  },
  errorText: {
    color: '#ffd0d0',
    fontSize: 14,
    lineHeight: 20,
  },
  artistImage: {
    width: '100%',
    height: 260,
    borderRadius: 18,
    backgroundColor: '#142838',
  },
  artistName: {
    color: '#f6f0e7',
    fontSize: 28,
    fontWeight: '700',
  },
  artistMeta: {
    color: '#d0b98c',
    fontSize: 14,
  },
  trackTitle: {
    color: '#f6f0e7',
    fontSize: 18,
    fontWeight: '700',
  },
  sectionLabel: {
    color: '#d9c18e',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#1a3144',
  },
  tagText: {
    color: '#e8eef4',
    fontSize: 12,
  },
  listItem: {
    color: '#d7e2ea',
    fontSize: 14,
    lineHeight: 21,
  },
})
