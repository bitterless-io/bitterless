export type CoachRegionCode = 'SG' | 'HK' | 'ID'

export interface CoachRegionOption {
  code: CoachRegionCode
  label: string
}

export const DEFAULT_COACH_REGION: CoachRegionCode = 'SG'

export const COACH_REGION_OPTIONS: CoachRegionOption[] = [
  { code: 'ID', label: 'Indonesia' },
  { code: 'HK', label: 'Hong Kong' },
  { code: 'SG', label: 'Singapore' }
]

export const isCoachRegionCode = (value: unknown): value is CoachRegionCode =>
  typeof value === 'string' && COACH_REGION_OPTIONS.some((item) => item.code === value)

export const normalizeCoachRegion = (value?: string | null): CoachRegionCode => {
  const code = String(value || '').trim().toUpperCase()
  return isCoachRegionCode(code) ? code : DEFAULT_COACH_REGION
}
