import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main';
import type { SettingDao, SettingStoredValue } from '@preload/sqlite/dao/setting.dao';
import {
  OnlyPreviewContractError,
  cloneDefaultOnlyPreviewSettings,
  parseOnlyPreviewSettings
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_SETTINGS_CHANGED_EVENT,
  type OnlyPreviewSettings
} from '@shared/onlypreview/onlyPreview.types';

const SETTINGS_KEY = 'onlypreview_settings';
const SETTINGS_SUB_KEY = 'preferences';
const SETTINGS_STORAGE_RETRY_ATTEMPTS = 26;
const SETTINGS_STORAGE_RETRY_INTERVAL_MS = 200;
const settingEmitter = createXpcMainEmitter<SettingDao>('SettingDao');

const waitForSettingsStorage = async <T>(
  operation: () => Promise<T>,
  isReady: (value: T) => boolean
): Promise<T> => {
  let value = await operation();
  for (
    let attempt = 1;
    attempt < SETTINGS_STORAGE_RETRY_ATTEMPTS && !isReady(value);
    attempt += 1
  ) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, SETTINGS_STORAGE_RETRY_INTERVAL_MS);
    });
    value = await operation();
  }
  return value;
};

export class OnlyPreviewSettingsService {
  private cachedSettings: OnlyPreviewSettings | null = null;
  private settingsReadPromise: Promise<OnlyPreviewSettings> | null = null;
  private cacheGeneration = 0;

  async get(): Promise<OnlyPreviewSettings> {
    if (this.cachedSettings) return { ...this.cachedSettings };
    if (this.settingsReadPromise) return { ...(await this.settingsReadPromise) };
    const request = this.readFromStorage();
    this.settingsReadPromise = request;
    try {
      return { ...(await request) };
    } finally {
      if (this.settingsReadPromise === request) this.settingsReadPromise = null;
    }
  }

  async hydrateFromStorage(): Promise<void> {
    await this.get();
    const settings = this.cachedSettings;
    if (!settings) return;
    xpcMain.broadcast(ONLY_PREVIEW_SETTINGS_CHANGED_EVENT, { settings: { ...settings } });
  }

  async save(value: unknown): Promise<OnlyPreviewSettings> {
    const settings = parseOnlyPreviewSettings(value);
    const result = await waitForSettingsStorage<string | null>(
      async () =>
        (await settingEmitter.upsert({
          key: SETTINGS_KEY,
          sub_key: SETTINGS_SUB_KEY,
          value: settings
        })) ?? null,
      (stored) => stored !== null
    );
    if (result !== 'ok') {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'OnlyPreview settings could not be persisted.'
      );
    }
    this.cacheGeneration += 1;
    this.cachedSettings = settings;
    xpcMain.broadcast(ONLY_PREVIEW_SETTINGS_CHANGED_EVENT, { settings });
    return { ...settings };
  }

  clearCache(): void {
    this.cacheGeneration += 1;
    this.cachedSettings = null;
    this.settingsReadPromise = null;
  }

  private async readFromStorage(): Promise<OnlyPreviewSettings> {
    const generation = this.cacheGeneration;
    try {
      const stored = await waitForSettingsStorage<SettingStoredValue | null>(
        async () =>
          (await settingEmitter.getStored({
            key: SETTINGS_KEY,
            sub_key: SETTINGS_SUB_KEY
          })) ?? null,
        (value) => value !== null
      );
      if (!stored) {
        console.warn('[OnlyPreview] Settings storage is unavailable; using defaults.');
        return this.currentOrDefault(generation);
      } else if (!stored.exists) {
        this.commitRead(generation, cloneDefaultOnlyPreviewSettings());
      } else if (!stored.valid) {
        console.warn('[OnlyPreview] Ignoring malformed persisted settings.');
        this.commitRead(generation, cloneDefaultOnlyPreviewSettings());
      } else {
        try {
          this.commitRead(generation, parseOnlyPreviewSettings(stored.value));
        } catch {
          console.warn('[OnlyPreview] Ignoring invalid persisted settings.');
          this.commitRead(generation, cloneDefaultOnlyPreviewSettings());
        }
      }
    } catch {
      console.warn('[OnlyPreview] Settings storage is unavailable; using defaults.');
      return this.currentOrDefault(generation);
    }
    return this.currentOrDefault(generation);
  }

  private commitRead(generation: number, settings: OnlyPreviewSettings): void {
    if (generation === this.cacheGeneration) this.cachedSettings = settings;
  }

  private currentOrDefault(generation: number): OnlyPreviewSettings {
    if (generation !== this.cacheGeneration && this.cachedSettings) {
      return { ...this.cachedSettings };
    }
    return this.cachedSettings ? { ...this.cachedSettings } : cloneDefaultOnlyPreviewSettings();
  }
}

export const onlyPreviewSettingsService = new OnlyPreviewSettingsService();
