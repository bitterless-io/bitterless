import { rendererEndpointClient } from '../clients/endpoint.client'

export const coachEndpointApi = {
  getSnapshot: () => rendererEndpointClient.getSnapshot(),
  resolveAiCrmsRelayBaseUrl: (region?: string | null) => rendererEndpointClient.resolveAiCrmsRelayBaseUrl(region)
}
