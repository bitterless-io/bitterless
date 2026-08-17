import type { SettingDao } from '@preload/sqlite/dao/setting.dao';

export const CLAUDE_PROVIDER_SETTING_KEY = 'eyes_on_agents';
export const CLAUDE_PROVIDER_SETTING_SUB_KEY = 'claude_provider_v1';
export const CLAUDE_PROVIDER_PENDING_ADMISSION = Number.MAX_SAFE_INTEGER;
const MAX_STORED_PREFERENCE_BYTES = 1_024;
const MAX_PREFERENCE_ERROR_LENGTH = 300;

export interface ClaudeProviderPreference {
  schemaVersion: 1;
  enabled: boolean;
  hookAdmissionAfter: number | null;
}

export type ClaudeProviderPreferenceHydration =
  | { state: 'valid'; preference: ClaudeProviderPreference }
  | { state: 'invalid'; error: string };

const DEFAULT_PREFERENCE: ClaudeProviderPreference = {
  schemaVersion: 1,
  enabled: true,
  hookAdmissionAfter: null
};

const boundedError = (value: string): string => (
  value.replace(/[\r\n]+/g, ' ').slice(0, MAX_PREFERENCE_ERROR_LENGTH)
);

const parsePreference = (value: unknown): ClaudeProviderPreference | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !==
    'enabled,hookAdmissionAfter,schemaVersion') return null;
  if (record.schemaVersion !== 1 || typeof record.enabled !== 'boolean') return null;
  const hookAdmissionAfter = record.hookAdmissionAfter;
  if (hookAdmissionAfter !== null &&
    (!Number.isSafeInteger(hookAdmissionAfter) || (hookAdmissionAfter as number) < 0)) return null;
  return {
    schemaVersion: 1,
    enabled: record.enabled,
    hookAdmissionAfter: hookAdmissionAfter as number | null
  };
};

export class ClaudeProviderPreferenceService {
  private preference: ClaudeProviderPreference = { ...DEFAULT_PREFERENCE };
  private error: string | null = null;

  constructor(private readonly settings: Pick<SettingDao, 'getStored' | 'upsert'>) {}

  async hydrate(): Promise<ClaudeProviderPreferenceHydration> {
    const stored = await this.settings.getStored({
      key: CLAUDE_PROVIDER_SETTING_KEY,
      sub_key: CLAUDE_PROVIDER_SETTING_SUB_KEY
    });
    if (!stored.exists) {
      this.preference = { ...DEFAULT_PREFERENCE };
      this.error = null;
      return { state: 'valid', preference: { ...this.preference } };
    }
    if (!stored.valid || stored.serializedValue === null ||
      Buffer.byteLength(stored.serializedValue, 'utf8') > MAX_STORED_PREFERENCE_BYTES) {
      return this.invalidate();
    }
    const parsed = parsePreference(stored.value);
    if (parsed === null) return this.invalidate();
    this.preference = parsed;
    this.error = null;
    return { state: 'valid', preference: { ...parsed } };
  }

  getStatus(): { enabled: boolean; hookAdmissionAfter: number | null; error: string | null } {
    return {
      enabled: this.preference.enabled,
      hookAdmissionAfter: this.preference.hookAdmissionAfter,
      error: this.error
    };
  }

  async setEnabled(
    enabled: boolean,
    hookAdmissionAfter: number | null
  ): Promise<ClaudeProviderPreference> {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean');
    if (hookAdmissionAfter !== null &&
      (!Number.isSafeInteger(hookAdmissionAfter) || hookAdmissionAfter < 0)) {
      throw new Error('hookAdmissionAfter is invalid');
    }
    const next: ClaudeProviderPreference = {
      schemaVersion: 1,
      enabled,
      hookAdmissionAfter
    };
    await this.settings.upsert({
      key: CLAUDE_PROVIDER_SETTING_KEY,
      sub_key: CLAUDE_PROVIDER_SETTING_SUB_KEY,
      value: next
    });
    this.preference = next;
    this.error = null;
    return { ...next };
  }

  private invalidate(): ClaudeProviderPreferenceHydration {
    this.preference = { schemaVersion: 1, enabled: false, hookAdmissionAfter: null };
    this.error = boundedError('Saved Claude provider preference is invalid');
    return { state: 'invalid', error: this.error };
  }
}
