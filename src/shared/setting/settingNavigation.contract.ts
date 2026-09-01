export const SETTING_OPEN_EVENT = 'setting/open' as const;

export const SETTING_TABS = [
  'proxy',
  'general',
  'account',
  'llm',
  'systemPrompt',
  'notification',
  'log',
  'about'
] as const;

export type SettingTab = (typeof SETTING_TABS)[number];

export interface SettingOpenNotice {
  tab: SettingTab;
}

export interface SettingNavigationApi {
  // Raises or creates Home, then requests the named Setting tab.
  openSettings(params: SettingOpenNotice): Promise<void>;
  // Home consumes the navigation Main held while the window was still loading.
  consumePendingSetting(): Promise<SettingOpenNotice | null>;
}

export type NotificationTestError = 'unsupported' | 'show-failed' | 'show-timeout';

export type NotificationTestResult = { ok: true } | { ok: false; error: NotificationTestError };

export class NotificationSettingsContractError extends Error {
  readonly code = 'INVALID_NOTIFICATION_TEST_RESULT';

  constructor() {
    super('Invalid notification test result.');
    this.name = 'NotificationSettingsContractError';
  }
}

export interface NotificationSettingsApi {
  sendTestNotification(): Promise<NotificationTestResult>;
}

const hasExactKeys = (value: Record<string, unknown>, keys: string[]): boolean => {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
};

export const parseNotificationTestResult = (value: unknown): NotificationTestResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NotificationSettingsContractError();
  }

  const record = value as Record<string, unknown>;
  if (record.ok === true && hasExactKeys(record, ['ok'])) return { ok: true };
  if (
    record.ok === false &&
    hasExactKeys(record, ['ok', 'error']) &&
    (record.error === 'unsupported' ||
      record.error === 'show-failed' ||
      record.error === 'show-timeout')
  ) {
    return { ok: false, error: record.error };
  }
  throw new NotificationSettingsContractError();
};

export const parseSettingTab = (value: unknown): SettingTab | null =>
  typeof value === 'string' && (SETTING_TABS as readonly string[]).includes(value)
    ? (value as SettingTab)
    : null;

export const parseSettingOpenNotice = (value: unknown): SettingOpenNotice | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const tab = parseSettingTab((value as Record<string, unknown>).tab);
  return tab ? { tab } : null;
};
