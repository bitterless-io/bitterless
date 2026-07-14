import type { AuthSession } from '@cowork-shared/session.api'
import { normalizeCoachRegion, type CoachRegionCode } from '@cowork-shared/networking/coachRegion'
import { resolveCoachAiCrmsRelayBaseUrl } from '@cowork-shared/networking/coachEndpoint'

export interface AiCrmsRelayEndpoint {
  region: CoachRegionCode
  baseUrl: string
}

const trimUrl = (url: string): string => url.trim().replace(/\/+$/, '')

export const resolveAiCrmsRelayEndpoint = (session?: Pick<AuthSession, 'region'> | null): AiCrmsRelayEndpoint => {
  const region = normalizeCoachRegion(session?.region)
  const runtimeOverride = trimUrl(process.env.COACH_AI_CRMS_RELAY_BASE_URL || '')
  return {
    region,
    baseUrl: runtimeOverride || resolveCoachAiCrmsRelayBaseUrl(region)
  }
}
