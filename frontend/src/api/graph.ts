import client from './client'
import type { GraphResponse } from '../types/api'

export async function getGraph(): Promise<GraphResponse> {
  const { data } = await client.get<GraphResponse>('/api/graph')
  return data
}
