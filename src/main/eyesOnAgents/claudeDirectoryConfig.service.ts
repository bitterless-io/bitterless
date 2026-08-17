import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type {
  EyesOnAgentsClaudeDirectoryConfig
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { requireCanonicalClaudeConfigDirectory } from './claudePath.resolver';

export const CLAUDE_DIRECTORY_SETTING_KEY = 'eyes_on_agents';
export const CLAUDE_DIRECTORY_SETTING_SUB_KEY = 'claude_directory_v1';
const MAX_STORED_CONFIG_BYTES = 8_192;

export type ClaudeDirectoryHydration =
  | { state: 'valid'; config: EyesOnAgentsClaudeDirectoryConfig }
  | { state: 'invalid'; error: string };

const AUTOMATIC_CONFIG: EyesOnAgentsClaudeDirectoryConfig = {
  schemaVersion: 1,
  mode: 'automatic',
  configDirectory: null
};

const parseConfig = (value: unknown): EyesOnAgentsClaudeDirectoryConfig | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'configDirectory,mode,schemaVersion') return null;
  if (record.schemaVersion !== 1) return null;
  if (record.mode === 'automatic' && record.configDirectory === null) {
    return { ...AUTOMATIC_CONFIG };
  }
  if (record.mode !== 'custom' || typeof record.configDirectory !== 'string') return null;
  if (record.configDirectory.length === 0 || record.configDirectory.includes('\0') ||
    !isAbsolute(record.configDirectory) ||
    Buffer.byteLength(record.configDirectory, 'utf8') > 4_096) return null;
  if (existsSync(record.configDirectory)) {
    try {
      if (requireCanonicalClaudeConfigDirectory(record.configDirectory) !== record.configDirectory) {
        return null;
      }
    } catch {
      return null;
    }
  }
  return {
    schemaVersion: 1,
    mode: 'custom',
    configDirectory: record.configDirectory
  };
};

const sameConfig = (
  left: EyesOnAgentsClaudeDirectoryConfig,
  right: EyesOnAgentsClaudeDirectoryConfig
): boolean => left.mode === right.mode && left.configDirectory === right.configDirectory;

export class ClaudeDirectoryConfigService {
  private config: EyesOnAgentsClaudeDirectoryConfig | null = null;

  constructor(private readonly dependencies: {
    settings: Pick<SettingDao, 'getStored' | 'upsert'>;
    pickDirectory: () => Promise<string | null>;
  }) {}

  async hydrate(): Promise<ClaudeDirectoryHydration> {
    const stored = await this.dependencies.settings.getStored({
      key: CLAUDE_DIRECTORY_SETTING_KEY,
      sub_key: CLAUDE_DIRECTORY_SETTING_SUB_KEY
    });
    if (!stored.exists) {
      this.config = { ...AUTOMATIC_CONFIG };
      return { state: 'valid', config: { ...this.config } };
    }
    if (!stored.valid || stored.serializedValue === null ||
      Buffer.byteLength(stored.serializedValue, 'utf8') > MAX_STORED_CONFIG_BYTES) {
      this.config = null;
      return { state: 'invalid', error: 'Saved Claude directory configuration is invalid' };
    }
    const parsed = parseConfig(stored.value);
    if (parsed === null) {
      this.config = null;
      return { state: 'invalid', error: 'Saved Claude directory configuration is invalid' };
    }
    this.config = parsed;
    return { state: 'valid', config: { ...parsed } };
  }

  getCurrent(): EyesOnAgentsClaudeDirectoryConfig | null {
    return this.config === null ? null : { ...this.config };
  }

  async chooseCustom(): Promise<EyesOnAgentsClaudeDirectoryConfig | null> {
    const selected = await this.dependencies.pickDirectory();
    if (selected === null) return null;
    const canonical = requireCanonicalClaudeConfigDirectory(selected);
    const next: EyesOnAgentsClaudeDirectoryConfig = {
      schemaVersion: 1,
      mode: 'custom',
      configDirectory: canonical
    };
    if (this.config !== null && sameConfig(this.config, next)) return { ...this.config };
    await this.persist(next);
    return { ...next };
  }

  async useAutomatic(): Promise<EyesOnAgentsClaudeDirectoryConfig> {
    const next = { ...AUTOMATIC_CONFIG };
    if (this.config !== null && sameConfig(this.config, next)) return next;
    await this.persist(next);
    return next;
  }

  private async persist(config: EyesOnAgentsClaudeDirectoryConfig): Promise<void> {
    await this.dependencies.settings.upsert({
      key: CLAUDE_DIRECTORY_SETTING_KEY,
      sub_key: CLAUDE_DIRECTORY_SETTING_SUB_KEY,
      value: config
    });
    this.config = { ...config };
  }
}
