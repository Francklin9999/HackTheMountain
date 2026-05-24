import client from './client'
import type { HealthResponse } from '../types/api'

export async function getHealth(): Promise<HealthResponse> {
  const { data } = await client.get<HealthResponse>('/api/health')
  return data
}
