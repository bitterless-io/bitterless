export const SETTING_OPEN_EVENT = 'setting/open' as const;

export const SETTING_TABS = ['proxy', 'general', 'llm', 'systemPrompt', 'log', 'about'] as const;

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

export const parseSettingTab = (value: unknown): SettingTab | null =>
  typeof value === 'string' && (SETTING_TABS as readonly string[]).includes(value)
    ? (value as SettingTab)
    : null;

export const parseSettingOpenNotice = (value: unknown): SettingOpenNotice | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const tab = parseSettingTab((value as Record<string, unknown>).tab);
  return tab ? { tab } : null;
};
