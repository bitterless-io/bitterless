import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type {
  EyesOnAgentsClaudeDirectoryConfig,
  EyesOnAgentsClaudeDirectoryMode,
  EyesOnAgentsClaudeEnvironment
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { requireCanonicalClaudeConfigDirectory } from './claudePath.resolver';

export const CLAUDE_DIRECTORY_SETTING_KEY = 'eyes_on_agents';
export const CLAUDE_DIRECTORY_SETTING_SUB_KEY = 'claude_directory_v1';
// A schemaVersion 2 value stores a small, user-managed list of named environments rather than
// one scalar, so the previous single-value byte budget is widened accordingly.
const MAX_STORED_CONFIG_BYTES = 65_536;
const MAX_ENVIRONMENTS = 20;
const MAX_LABEL_LENGTH = 80;
const DEFAULT_ENVIRONMENT_LABEL = 'Default';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENVIRONMENT_KEYS = ['configDirectory', 'enabled', 'id', 'label', 'mode'] as const;
const INVALID_ERROR = 'Saved Claude directory configuration is invalid';

export type ClaudeDirectoryHydration =
  | { state: 'valid'; config: EyesOnAgentsClaudeDirectoryConfig }
  | { state: 'invalid'; error: string };

// The pre-task-084 persisted shape. Read-only: hydrate() converts it once into schemaVersion 2
// and never writes it again.
interface LegacyClaudeDirectoryConfigV1 {
  schemaVersion: 1;
  mode: EyesOnAgentsClaudeDirectoryMode;
  configDirectory: string | null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseLabel = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LABEL_LENGTH || /[\0\r\n]/.test(trimmed)) return null;
  return trimmed;
};

// Returns the accepted path, null when the field is legitimately absent (automatic mode), or
// undefined when the value is malformed. A directory that does not currently exist is still
// accepted here (matching the pre-084 rule): a later Claude session may create it.
const parseConfigDirectoryField = (value: unknown): string | null | undefined => {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    !isAbsolute(value) ||
    Buffer.byteLength(value, 'utf8') > 4_096
  ) {
    return undefined;
  }
  if (existsSync(value)) {
    try {
      if (requireCanonicalClaudeConfigDirectory(value) !== value) return undefined;
    } catch {
      return undefined;
    }
  }
  return value;
};

const parseEnvironment = (value: unknown): EyesOnAgentsClaudeEnvironment | null => {
  if (!isPlainObject(value)) return null;
  if (Object.keys(value).sort().join(',') !== ENVIRONMENT_KEYS.join(',')) return null;
  if (typeof value.id !== 'string' || !UUID_PATTERN.test(value.id)) return null;
  const label = parseLabel(value.label);
  if (label === null) return null;
  if (typeof value.enabled !== 'boolean') return null;
  const id = value.id.toLowerCase();
  if (value.mode === 'automatic') {
    if (value.configDirectory !== null) return null;
    return { id, label, mode: 'automatic', configDirectory: null, enabled: value.enabled };
  }
  if (value.mode !== 'custom') return null;
  const configDirectory = parseConfigDirectoryField(value.configDirectory);
  if (configDirectory === undefined || configDirectory === null) return null;
  return { id, label, mode: 'custom', configDirectory, enabled: value.enabled };
};

const parseV2Config = (value: Record<string, unknown>): EyesOnAgentsClaudeDirectoryConfig | null => {
  if (Object.keys(value).sort().join(',') !== 'environments,schemaVersion') return null;
  if (
    !Array.isArray(value.environments) ||
    value.environments.length === 0 ||
    value.environments.length > MAX_ENVIRONMENTS
  ) {
    return null;
  }
  const environments: EyesOnAgentsClaudeEnvironment[] = [];
  for (const candidate of value.environments) {
    const parsed = parseEnvironment(candidate);
    if (parsed === null) return null;
    environments.push(parsed);
  }
  const automaticCount = environments.filter((environment) => environment.mode === 'automatic').length;
  if (automaticCount > 1) return null;
  if (automaticCount === 1 && environments[0].mode !== 'automatic') return null;
  if (new Set(environments.map((environment) => environment.id)).size !== environments.length) {
    return null;
  }
  return { schemaVersion: 2, environments };
};

const parseV1Config = (value: Record<string, unknown>): LegacyClaudeDirectoryConfigV1 | null => {
  if (Object.keys(value).sort().join(',') !== 'configDirectory,mode,schemaVersion') return null;
  if (value.mode === 'automatic' && value.configDirectory === null) {
    return { schemaVersion: 1, mode: 'automatic', configDirectory: null };
  }
  if (value.mode !== 'custom') return null;
  const configDirectory = parseConfigDirectoryField(value.configDirectory);
  if (configDirectory === undefined || configDirectory === null) return null;
  return { schemaVersion: 1, mode: 'custom', configDirectory };
};

const freshAutomaticEnvironment = (): EyesOnAgentsClaudeEnvironment => ({
  id: randomUUID(),
  label: DEFAULT_ENVIRONMENT_LABEL,
  mode: 'automatic',
  configDirectory: null,
  enabled: true
});

export class ClaudeDirectoryConfigService {
  private environments: EyesOnAgentsClaudeEnvironment[] | null = null;
  private readonly logger: Pick<Console, 'info'>;

  constructor(private readonly dependencies: {
    settings: Pick<SettingDao, 'getStored' | 'upsert'>;
    pickDirectory: () => Promise<string | null>;
    logger?: Pick<Console, 'info'>;
  }) {
    this.logger = dependencies.logger ?? console;
  }

  async hydrate(): Promise<ClaudeDirectoryHydration> {
    const stored = await this.dependencies.settings.getStored({
      key: CLAUDE_DIRECTORY_SETTING_KEY,
      sub_key: CLAUDE_DIRECTORY_SETTING_SUB_KEY
    });
    if (!stored.exists) {
      // A fresh install never writes to SQLite until the user explicitly changes something —
      // matching the pre-084 automatic-mode default exactly.
      this.environments = [freshAutomaticEnvironment()];
      return { state: 'valid', config: this.currentConfig() };
    }
    if (
      !stored.valid ||
      stored.serializedValue === null ||
      Buffer.byteLength(stored.serializedValue, 'utf8') > MAX_STORED_CONFIG_BYTES ||
      !isPlainObject(stored.value)
    ) {
      this.environments = null;
      return { state: 'invalid', error: INVALID_ERROR };
    }
    if (stored.value.schemaVersion === 2) {
      const parsed = parseV2Config(stored.value);
      if (parsed === null) {
        this.environments = null;
        return { state: 'invalid', error: INVALID_ERROR };
      }
      this.environments = parsed.environments;
      return { state: 'valid', config: this.currentConfig() };
    }
    if (stored.value.schemaVersion === 1) {
      const legacy = parseV1Config(stored.value);
      if (legacy === null) {
        this.environments = null;
        return { state: 'invalid', error: INVALID_ERROR };
      }
      // Migrate once: persist the converted schemaVersion 2 value at the same setting key so a
      // later hydrate reads the new shape directly.
      await this.persist([{
        id: randomUUID(),
        label: DEFAULT_ENVIRONMENT_LABEL,
        mode: legacy.mode,
        configDirectory: legacy.configDirectory,
        enabled: true
      }]);
      return { state: 'valid', config: this.currentConfig() };
    }
    this.environments = null;
    return { state: 'invalid', error: INVALID_ERROR };
  }

  getCurrent(): EyesOnAgentsClaudeDirectoryConfig | null {
    return this.environments === null ? null : this.currentConfig();
  }

  listEnvironments(): EyesOnAgentsClaudeEnvironment[] {
    return (this.environments ?? []).map((environment) => ({ ...environment }));
  }

  async addEnvironment(params: {
    label: string;
    configDirectory: string;
  }): Promise<EyesOnAgentsClaudeEnvironment> {
    const environments = this.requireEnvironments();
    if (environments.length >= MAX_ENVIRONMENTS) {
      throw new Error('Maximum number of Claude environments reached');
    }
    const label = parseLabel(params.label);
    if (label === null) throw new Error('Claude environment label is invalid');
    const configDirectory = requireCanonicalClaudeConfigDirectory(params.configDirectory);
    const environment: EyesOnAgentsClaudeEnvironment = {
      id: randomUUID(),
      label,
      mode: 'custom',
      configDirectory,
      enabled: true
    };
    await this.persist([...environments, environment]);
    this.logLifecycle('add', environment);
    return { ...environment };
  }

  async renameEnvironment(params: { id: string; label: string }): Promise<void> {
    const environments = this.requireEnvironments();
    const index = environments.findIndex((environment) => environment.id === params.id);
    if (index < 0) throw new Error('Claude environment was not found');
    const label = parseLabel(params.label);
    if (label === null) throw new Error('Claude environment label is invalid');
    if (environments[index].label === label) return;
    const next = [...environments];
    next[index] = { ...next[index], label };
    await this.persist(next);
    this.logLifecycle('rename', next[index]);
  }

  async removeEnvironment(params: { id: string }): Promise<void> {
    const environments = this.requireEnvironments();
    const removed = environments.find((environment) => environment.id === params.id);
    if (!removed) throw new Error('Claude environment was not found');
    if (environments.length <= 1) {
      throw new Error('The last remaining Claude environment cannot be removed');
    }
    await this.persist(environments.filter((environment) => environment.id !== params.id));
    this.logLifecycle('remove', removed);
  }

  async setEnvironmentEnabled(params: { id: string; enabled: boolean }): Promise<void> {
    const environments = this.requireEnvironments();
    const index = environments.findIndex((environment) => environment.id === params.id);
    if (index < 0) throw new Error('Claude environment was not found');
    if (environments[index].enabled === params.enabled) return;
    const next = [...environments];
    next[index] = { ...next[index], enabled: params.enabled };
    await this.persist(next);
    this.logLifecycle(params.enabled ? 'enable' : 'disable', next[index]);
  }

  async chooseCustomDirectory(params: { id: string }): Promise<EyesOnAgentsClaudeEnvironment | null> {
    const selected = await this.dependencies.pickDirectory();
    if (selected === null) return null;
    const configDirectory = requireCanonicalClaudeConfigDirectory(selected);
    if (this.environments === null) {
      // Recovery: nothing has been successfully hydrated (fresh install never persisted, or the
      // saved value was malformed). Picking a directory here resets to one known-good custom
      // environment instead of requiring an id nothing can supply yet — mirrors the pre-084
      // single-directory "a new directory selection replaces it" recovery contract.
      return await this.resetTo({ mode: 'custom', configDirectory }, 'directory-change');
    }
    const environments = this.environments;
    const index = environments.findIndex((environment) => environment.id === params.id);
    if (index < 0) throw new Error('Claude environment was not found');
    const current = environments[index];
    if (current.mode === 'custom' && current.configDirectory === configDirectory) {
      return { ...current };
    }
    const next = [...environments];
    next[index] = { ...current, mode: 'custom', configDirectory };
    await this.persist(next);
    this.logLifecycle('directory-change', next[index]);
    return { ...next[index] };
  }

  // Only environments[0] is ever eligible for automatic mode — see the data-model contract.
  async useAutomatic(params: { id: string }): Promise<EyesOnAgentsClaudeEnvironment> {
    if (this.environments === null) {
      // Recovery: same rationale as chooseCustomDirectory above — mirrors the pre-084
      // "Use automatic" recovery contract, which worked from a malformed saved value.
      return await this.resetTo({ mode: 'automatic', configDirectory: null }, 'mode-change');
    }
    const environments = this.environments;
    const index = environments.findIndex((environment) => environment.id === params.id);
    if (index < 0) throw new Error('Claude environment was not found');
    if (index !== 0) {
      throw new Error('Only the default Claude environment can use automatic mode');
    }
    const current = environments[index];
    if (current.mode === 'automatic') return { ...current };
    const next = [...environments];
    next[index] = { ...current, mode: 'automatic', configDirectory: null };
    await this.persist(next);
    this.logLifecycle('mode-change', next[index], 'automatic');
    return { ...next[index] };
  }

  // Discards whatever (nonexistent or malformed) state preceded it and persists one fresh
  // default environment carrying the given mode/configDirectory. Used only by the
  // chooseCustomDirectory/useAutomatic recovery branch above.
  private async resetTo(
    fields: { mode: EyesOnAgentsClaudeDirectoryMode; configDirectory: string | null },
    action: 'directory-change' | 'mode-change'
  ): Promise<EyesOnAgentsClaudeEnvironment> {
    const fresh: EyesOnAgentsClaudeEnvironment = {
      id: randomUUID(),
      label: DEFAULT_ENVIRONMENT_LABEL,
      mode: fields.mode,
      configDirectory: fields.configDirectory,
      enabled: true
    };
    await this.persist([fresh]);
    this.logLifecycle(action, fresh, action === 'mode-change' ? fresh.mode : undefined);
    return { ...fresh };
  }

  private requireEnvironments(): EyesOnAgentsClaudeEnvironment[] {
    if (this.environments === null) {
      throw new Error('Claude environment configuration has not been loaded');
    }
    return this.environments;
  }

  private currentConfig(): EyesOnAgentsClaudeDirectoryConfig {
    return {
      schemaVersion: 2,
      environments: (this.environments ?? []).map((environment) => ({ ...environment }))
    };
  }

  // Persists first and only applies the new in-memory state once the write has succeeded, so a
  // failed upsert (e.g. SQLite unavailable) leaves the previously applied environments intact.
  private async persist(environments: EyesOnAgentsClaudeEnvironment[]): Promise<void> {
    await this.dependencies.settings.upsert({
      key: CLAUDE_DIRECTORY_SETTING_KEY,
      sub_key: CLAUDE_DIRECTORY_SETTING_SUB_KEY,
      value: { schemaVersion: 2, environments: environments.map((environment) => ({ ...environment })) }
    });
    this.environments = environments;
  }

  // Never logs configDirectory — id/label only, matching the setting DAO's own no-values rule.
  private logLifecycle(
    action: 'add' | 'rename' | 'remove' | 'enable' | 'disable' | 'directory-change' | 'mode-change',
    environment: EyesOnAgentsClaudeEnvironment,
    mode?: EyesOnAgentsClaudeDirectoryMode
  ): void {
    const modeSuffix = mode === undefined ? '' : ` mode=${mode}`;
    this.logger.info(
      `[claude-environment] action=${action} id=${environment.id} label="${environment.label}"${modeSuffix}`
    );
  }
}
