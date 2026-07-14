import { getCoachEndpointSnapshot, resolveCoachAiCrmsRelayBaseUrl, type CoachEndpointSnapshot } from '@cowork-shared/networking/coachEndpoint'

export interface RendererEndpointClient {
  getSnapshot(): CoachEndpointSnapshot
  resolveAiCrmsRelayBaseUrl(region?: string | null): string
}

export const rendererEndpointClient: RendererEndpointClient = {
  getSnapshot: getCoachEndpointSnapshot,
  resolveAiCrmsRelayBaseUrl: resolveCoachAiCrmsRelayBaseUrl
}
