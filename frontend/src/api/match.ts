import client from './client'
import type { MatchResponse } from '../types/api'

export async function postMatch(audioBlob: Blob): Promise<MatchResponse> {
  const form = new FormData()
  form.append('audio', audioBlob, 'recording.wav')
  const { data } = await client.post<MatchResponse>('/api/match', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

type AssistedInputMode = 'description' | 'link'

export async function createAssistedMatch(mode: AssistedInputMode, value: string): Promise<MatchResponse> {
  const { data } = await client.post<MatchResponse>(
    '/api/match/assisted',
    { mode, value },
    { timeout: 90000 },
  )
  return data
}
