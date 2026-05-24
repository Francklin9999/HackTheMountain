import client from './client'
import type { ArtistResponse } from '../types/api'

export async function getArtist(id: string): Promise<ArtistResponse> {
  const { data } = await client.get<ArtistResponse>(`/api/artists/${id}`)
  return data
}
