import type { SkillRecipe } from '@maestro-main/skills/skillRecipe.types'
import { extractJsonObject } from '@maestro-main/agent/jsonExtract'

type FactKey =
  | 'patient_name'
  | 'patient_phone'
  | 'appointment_time'
  | 'department_or_doctor'
  | 'gender'
  | 'nik'
  | 'ihs_number'
  | 'address'

const DEPARTMENT_ALIASES: Array<{ value: string; aliases: string[] }> = [
  { value: 'cardiology', aliases: ['cardiology', 'heart', 'cardiac', 'jantung', '心脏科', '心内科'] },
  { value: 'radiology', aliases: ['radiology', 'radiologi', 'imaging', 'x-ray', 'xray', 'rontgen', '放射科', '影像科'] },
  { value: 'orthopedics', aliases: ['orthopedics', 'orthopedic', 'ortopedi', 'bone', '骨科'] },
  { value: 'general-medicine', aliases: ['general medicine', 'family medicine', 'general practice', 'dokter umum', 'umum', '全科', '普通内科', '家庭医学'] },
  { value: 'pediatrics', aliases: ['pediatrics', 'pediatric', 'children', 'anak', '儿科'] }
]

export function extractVariablesFromMessage(
  message: string,
  recipe: SkillRecipe,
  now = new Date()
): Record<string, string> {
  const parsed = parseJsonObject(message)
  const facts = extractFacts(message, now)
  const variables: Record<string, string> = { ...parsed }

  for (const input of recipe.inputs) {
    if (variables[input.name]) continue
    const key = classifyInput(input.name, input.label)
    if (key && facts[key]) variables[input.name] = facts[key]
  }

  return variables
}

function extractFacts(message: string, now: Date): Partial<Record<FactKey, string>> {
  return {
    patient_name: extractName(message),
    patient_phone: extractPhone(message),
    appointment_time: extractAppointmentTime(message, now),
    department_or_doctor: extractDepartment(message),
    gender: extractGender(message),
    nik: extractNik(message),
    ihs_number: extractIhsNumber(message),
    address: extractAddress(message)
  }
}

function classifyInput(name: string, label: string): FactKey | null {
  const text = `${name} ${label}`.toLowerCase()
  if (/department|doctor|dokter|departemen|special|科|department_or_doctor/.test(text)) return 'department_or_doctor'
  if (/appointment.*time|tanggal|tgl|date|time|waktu|预约时间/.test(text)) return 'appointment_time'
  if (/phone|telepon|tel|mobile|whatsapp|手机号|电话/.test(text)) return 'patient_phone'
  if (/ihs|bpjs|jaminan|insurance|社保|p001|p\d+/.test(text)) return 'ihs_number'
  if (/\bnik\b|identity|ktp|身份证|3201234567890001/.test(text)) return 'nik'
  if (/gender|jenis kelamin|sex|性别/.test(text)) return 'gender'
  if (/alamat|address|地址|jl\.?/.test(text)) return 'address'
  if (/patient.*name|full.*name|nama|cth.*budi|姓名|name/.test(text)) return 'patient_name'
  return null
}

function parseJsonObject(message: string): Record<string, string> {
  const parsed = extractJsonObject(message)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Record<string, string> = {}
  flattenJsonVars(parsed as Record<string, unknown>, '', out)
  return out
}

function flattenJsonVars(value: unknown, prefix: string, out: Record<string, string>): void {
  if (value === undefined || value === null) return
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (prefix) out[prefix] = String(value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenJsonVars(item, prefix ? `${prefix}.${index}` : String(index), out))
    return
  }
  if (typeof value !== 'object') return
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    flattenJsonVars(item, path, out)
  }
}

function extractName(message: string): string | undefined {
  const explicit = message.match(/(?:nama(?:\s+lengkap)?|姓名|name)\s*[:：]?\s*([A-Za-z\u4e00-\u9fff][^,，\n]*)/i)
  if (explicit?.[1]) return cleanName(explicit[1])

  const chineseAfterIntent = message.match(/(?:booking|book|预约|挂号)(?:\s+for|\s+给)?\s+([\p{Script=Han}]{2,6})/iu)
  if (chineseAfterIntent?.[1]) return chineseAfterIntent[1]

  const latinAfterIntent = message.match(
    /(?:booking|book|预约|挂号)(?:\s+for|\s+for\s+patient|\s+patient|\s+untuk)?\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})/i
  )
  if (latinAfterIntent?.[1]) return cleanName(latinAfterIntent[1])

  return undefined
}

function cleanName(value: string): string {
  return value
    .replace(/\s+(?:laki-laki|perempuan|male|female|nik|telepon|phone|ihs|bpjs|alamat|tanggal).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractPhone(message: string): string | undefined {
  const labelled = message.match(/(?:telepon|phone|mobile|whatsapp|手机号|电话)\s*[:：]?\s*(\+?\d[\d\s-]{6,}\d)/i)
  if (labelled?.[1]) return labelled[1].trim()
  const generic = message.match(/(^|[^\d])(\+?\d{1,4}[\s-]?\d[\d\s-]{6,}\d)(?!\d)/)
  return generic?.[2]?.trim()
}

function extractAppointmentTime(message: string, now: Date): string | undefined {
  const date = resolveDate(message, now)
  const time = resolveTime(message)
  if (!time) return undefined
  date.setHours(time.hour, time.minute, 0, 0)
  return formatLocalDateTime(date)
}

function resolveDate(message: string, now: Date): Date {
  const explicit = message.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/)
  if (explicit) return new Date(Number(explicit[1]), Number(explicit[2]) - 1, Number(explicit[3]))

  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (/后天|lusa/i.test(message)) date.setDate(date.getDate() + 2)
  else if (/明天|besok|tomorrow/i.test(message)) date.setDate(date.getDate() + 1)
  return date
}

function resolveTime(message: string): { hour: number; minute: number } | undefined {
  const zhWithMarker = message.match(/(上午|早上|下午|晚上|中午)\s*(\d{1,2})\s*(?:[:：点.]\s*(\d{1,2}|半)?)?/)
  const zhClock = message.match(/(?:^|[^\d])(\d{1,2})\s*点\s*(半|\d{1,2})?/)
  const id = message.match(/jam\s*(\d{1,2})(?:[:.](\d{1,2}))?\s*(pagi|siang|sore|malam)?/i)
  const en = message.match(/(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)/i)

  if (id) return normalizeHour(Number(id[1]), id[2] ? Number(id[2]) : 0, id[3])
  if (en) return normalizeHour(Number(en[1]), en[2] ? Number(en[2]) : 0, en[3])
  if (zhWithMarker) {
    const minute = zhWithMarker[3] === '半' ? 30 : zhWithMarker[3] ? Number(zhWithMarker[3]) : 0
    return normalizeHour(Number(zhWithMarker[2]), minute, zhWithMarker[1])
  }
  if (zhClock) {
    const minute = zhClock[2] === '半' ? 30 : zhClock[2] ? Number(zhClock[2]) : 0
    return normalizeHour(Number(zhClock[1]), minute)
  }
  return undefined
}

function normalizeHour(hour: number, minute: number, marker?: string): { hour: number; minute: number } {
  const m = (marker || '').toLowerCase()
  if ((/下午|晚上|pm|sore|malam/.test(m) || m === 'siang') && hour < 12) hour += 12
  if ((/上午|早上|am|pagi/.test(m)) && hour === 12) hour = 0
  return { hour: Math.max(0, Math.min(23, hour)), minute: Math.max(0, Math.min(59, minute)) }
}

function extractDepartment(message: string): string | undefined {
  const lower = message.toLowerCase()
  for (const item of DEPARTMENT_ALIASES) {
    if (item.aliases.some((alias) => lower.includes(alias.toLowerCase()))) return item.value
  }
  return undefined
}

function extractGender(message: string): string | undefined {
  if (/perempuan|female|woman|女/.test(message.toLowerCase())) return 'Perempuan'
  if (/laki-laki|male|man|男/.test(message.toLowerCase())) return 'Laki-laki'
  return undefined
}

function extractNik(message: string): string | undefined {
  return message.match(/(?:nik|ktp|身份证)\s*[:：]?\s*(\d{16})/i)?.[1] || message.match(/\b(\d{16})\b/)?.[1]
}

function extractIhsNumber(message: string): string | undefined {
  return message.match(/(?:ihs|bpjs|jaminan|社保)\s*[:：]?\s*(P\d{6,})/i)?.[1] || message.match(/\b(P\d{6,})\b/i)?.[1]
}

function extractAddress(message: string): string | undefined {
  return message.match(/(?:alamat|address|地址)\s*[:：]?\s*([^。;\n]+)/i)?.[1]?.trim()
}

function formatLocalDateTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
