import {
  APPLICATION_DIAGNOSTIC_ENVIRONMENT_KEYS,
  type ApplicationDiagnosticEnvironmentEntry,
  type ApplicationDiagnosticEnvironmentKey
} from '@shared/diagnostics/applicationDiagnostics.contract';

const VALUE_SAFE_KEYS = new Set<ApplicationDiagnosticEnvironmentKey>([
  'VITE_ENV',
  'VITE_MODE',
  'VITE_RELEASE_CHANNEL'
]);

const isSafeRuntimeValue = (key: ApplicationDiagnosticEnvironmentKey, value: string): boolean =>
  (key === 'VITE_ENV' && (value === 'dev' || value === 'prod')) ||
  (key === 'VITE_MODE' && (value === 'debug' || value === 'release')) ||
  (key === 'VITE_RELEASE_CHANNEL' && ['dev', 'preview', 'prod'].includes(value));

const ENDPOINT_ORIGIN_KEYS = new Set<ApplicationDiagnosticEnvironmentKey>([
  'VITE_BITTERLESS_CORE_URL',
  'CDN_API_ENDPOINT',
  'COACH_AI_CRMS_CORE_BASE_URL',
  'COACH_AI_CRMS_MEDIA_UPLOAD_URL',
  'COACH_AI_CRMS_RELAY_BASE_URL',
  'COACH_MEDIA_UPLOAD_URL'
]);

const safeEndpointOrigin = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    if (url.username || url.password) return undefined;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
};

export const buildDiagnosticEnvironmentStatus = (
  source: Readonly<Record<string, string | undefined>>
): ApplicationDiagnosticEnvironmentEntry[] =>
  APPLICATION_DIAGNOSTIC_ENVIRONMENT_KEYS.map((key) => {
    const raw = source[key]?.trim() ?? '';
    const entry: ApplicationDiagnosticEnvironmentEntry = {
      key,
      configured: Boolean(raw)
    };
    if (!raw) return entry;
    if (VALUE_SAFE_KEYS.has(key) && isSafeRuntimeValue(key, raw)) {
      entry.safeValue = raw;
    } else if (ENDPOINT_ORIGIN_KEYS.has(key)) {
      const origin = safeEndpointOrigin(raw);
      if (origin) entry.safeValue = origin;
    }
    return entry;
  });
