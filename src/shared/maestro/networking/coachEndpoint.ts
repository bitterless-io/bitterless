import { DEFAULT_COACH_REGION, normalizeCoachRegion, type CoachRegionCode } from './coachRegion'

declare const __COACH_BUILD_REGION__: string | undefined
declare const __COACH_AI_CRMS_RELAY_BASE_URL__: string | undefined
declare const __COACH_AI_CRMS_RELAY_BASE_URL_SG__: string | undefined
declare const __COACH_AI_CRMS_RELAY_BASE_URL_HK__: string | undefined
declare const __COACH_AI_CRMS_RELAY_BASE_URL_ID__: string | undefined

const DEFAULT_AI_CRMS_RELAY_BASE_URLS: Record<CoachRegionCode, string> = {
  SG: 'https://llm.micromeet.ai/v1/bailian',
  HK: 'https://relay-prod-hk-oxhyewvkbw.cn-hongkong.fcapp.run/v1/bailian',
  ID: 'https://relay-prod-id-oxhyexskbw.ap-southeast-5.fcapp.run/v1/bailian'
}

const readBuildString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const trimUrl = (url: string): string => url.trim().replace(/\/+$/, '')

const sharedRelayBaseUrl = readBuildString(typeof __COACH_AI_CRMS_RELAY_BASE_URL__ === 'string' ? __COACH_AI_CRMS_RELAY_BASE_URL__ : '')

export const coachBuildRegion: CoachRegionCode = normalizeCoachRegion(
  readBuildString(typeof __COACH_BUILD_REGION__ === 'string' ? __COACH_BUILD_REGION__ : '')
)

export const coachAiCrmsRelayBaseUrls: Record<CoachRegionCode, string> = {
  SG: trimUrl(
    readBuildString(typeof __COACH_AI_CRMS_RELAY_BASE_URL_SG__ === 'string' ? __COACH_AI_CRMS_RELAY_BASE_URL_SG__ : '') ||
      sharedRelayBaseUrl ||
      DEFAULT_AI_CRMS_RELAY_BASE_URLS.SG
  ),
  HK: trimUrl(
    readBuildString(typeof __COACH_AI_CRMS_RELAY_BASE_URL_HK__ === 'string' ? __COACH_AI_CRMS_RELAY_BASE_URL_HK__ : '') ||
      sharedRelayBaseUrl ||
      DEFAULT_AI_CRMS_RELAY_BASE_URLS.HK
  ),
  ID: trimUrl(
    readBuildString(typeof __COACH_AI_CRMS_RELAY_BASE_URL_ID__ === 'string' ? __COACH_AI_CRMS_RELAY_BASE_URL_ID__ : '') ||
      sharedRelayBaseUrl ||
      DEFAULT_AI_CRMS_RELAY_BASE_URLS.ID
  )
}

export interface CoachEndpointSnapshot {
  buildRegion: CoachRegionCode
  aiCrmsRelayBaseUrls: Record<CoachRegionCode, string>
}

export const resolveCoachAiCrmsRelayBaseUrl = (region?: string | null): string => {
  const normalized = normalizeCoachRegion(region || coachBuildRegion || DEFAULT_COACH_REGION)
  return coachAiCrmsRelayBaseUrls[normalized] || coachAiCrmsRelayBaseUrls[DEFAULT_COACH_REGION]
}

export const getCoachEndpointSnapshot = (): CoachEndpointSnapshot => ({
  buildRegion: coachBuildRegion,
  aiCrmsRelayBaseUrls: { ...coachAiCrmsRelayBaseUrls }
})
