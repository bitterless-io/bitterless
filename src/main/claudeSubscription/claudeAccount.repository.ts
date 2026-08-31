import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename as renameFile,
  rm,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import {
  buildClaudeSubscriptionCodexModelCatalog,
  CLAUDE_SUBSCRIPTION_DEFAULT_PORT,
  CLAUDE_SUBSCRIPTION_MAX_PORT,
  CLAUDE_SUBSCRIPTION_MIN_PORT
} from '@shared/claudeSubscription/claudeSubscription.contract';
import type {
  ClaudeAccountId,
  ClaudeSubscriptionAccountStatus,
  ClaudeSubscriptionAccountView,
  ClaudeSubscriptionType
} from '@shared/claudeSubscription/claudeSubscription.contract';

export interface StoredClaudeSubscriptionAccount {
  id: ClaudeAccountId;
  /**
   * Selects `~/.claude<slot>`. The whole of the untrusted input is this integer:
   * the directories are still derived from it, never read from the record, so a
   * tampered registry cannot redirect where the CLI writes a credential.
   */
  slot: number;
  label: string;
  email?: string;
  subscriptionType: ClaudeSubscriptionType;
  configDirectory: string;
  secureStorageConfigDirectory: string;
  anthropicConfigDirectory: string;
  partition: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClaudeAccountIdentity {
  id: ClaudeAccountId;
  slot: number;
  configDirectory: string;
  secureStorageConfigDirectory: string;
  anthropicConfigDirectory: string;
  partition: string;
}

export interface ClaudeAccountExecutionContext {
  configDirectory: string;
  secureStorageConfigDirectory: string;
  anthropicConfigDirectory: string;
}

export interface ClaudeAuthenticatedAccountMetadata {
  email?: string;
  subscriptionType: ClaudeSubscriptionType;
}

export interface ClaudeAccountRoutingRecord {
  id: ClaudeAccountId;
  enabled: boolean;
  hasAccountContext: boolean;
  needsLogin: boolean;
  cooldownUntil?: number;
}

export interface ClaudeAccountSource {
  listRoutingAccounts(): Promise<ClaudeAccountRoutingRecord[]>;
  getExecutionContext(accountId: ClaudeAccountId): Promise<ClaudeAccountExecutionContext | null>;
  markNeedsLogin?(accountId: ClaudeAccountId): void;
  markCooldown?(accountId: ClaudeAccountId, cooldownUntil: number): void;
}

interface ClaudeAccountRegistry {
  version: 3;
  accounts: StoredClaudeSubscriptionAccount[];
}

export interface ClaudeAccountRepositoryOptions {
  rootDirectory: string;
  isolatedCredentialStorageAvailable: boolean;
  now?: () => Date;
  createId?: () => string;
  /**
   * Required, never defaulted. Slots resolve to `<homeDirectory>/.claude<N>`, and
   * account removal deletes that directory outright — so a construction site that
   * forgot to pass one would delete real slots. Making it required turns that
   * mistake into a compile error instead of data loss; it cost `~/.claude2` its
   * config once (2026-08-28) when this was optional and defaulted to `homedir()`.
   */
  homeDirectory: string;
}

const REGISTRY_FILE = 'accounts.json';
const SETTINGS_FILE = 'settings.json';
const CODEX_CATALOG_FILE = 'codex-model-catalog.json';
const ANTHROPIC_DIRECTORY = 'anthropic';
const REGISTRY_VERSION = 3;
const SLOT_DIRECTORY_PREFIX = '.claude';
/**
 * Slot 1 would be `~/.claude`, the directory an interactive `claude` session uses.
 * Bitterless serialises its own children per account but cannot serialise against
 * an external CLI process, so that directory can never be made safe to pool.
 */
const MINIMUM_SLOT = 2;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REGISTRY_KEYS = ['accounts', 'version'] as const;

const isValidSlot = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= MINIMUM_SLOT;
const ACCOUNT_KEYS = [
  'anthropicConfigDirectory',
  'configDirectory',
  'createdAt',
  'enabled',
  'slot',
  'id',
  'label',
  'partition',
  'secureStorageConfigDirectory',
  'subscriptionType',
  'updatedAt'
] as const;

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStoredAccount = (value: unknown): value is StoredClaudeSubscriptionAccount => {
  if (
    !isRecord(value) ||
    (!hasExactKeys(value, ACCOUNT_KEYS) && !hasExactKeys(value, [...ACCOUNT_KEYS, 'email']))
  ) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    UUID_PATTERN.test(value.id) &&
    typeof value.label === 'string' &&
    (value.email === undefined || typeof value.email === 'string') &&
    (value.subscriptionType === 'pro' ||
      value.subscriptionType === 'max' ||
      value.subscriptionType === 'team' ||
      value.subscriptionType === 'enterprise') &&
    isValidSlot(value.slot) &&
    typeof value.configDirectory === 'string' &&
    typeof value.secureStorageConfigDirectory === 'string' &&
    typeof value.anthropicConfigDirectory === 'string' &&
    typeof value.partition === 'string' &&
    typeof value.enabled === 'boolean' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
};

const parseRegistry = (value: unknown): ClaudeAccountRegistry => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, REGISTRY_KEYS) ||
    value.version !== REGISTRY_VERSION ||
    !Array.isArray(value.accounts) ||
    !value.accounts.every(isStoredAccount)
  ) {
    throw new Error('Unsupported Claude subscription account registry.');
  }
  return { version: REGISTRY_VERSION, accounts: value.accounts };
};

const normalizeAbsolutePath = (value: string): string => path.resolve(value).normalize('NFC');

export class ClaudeAccountRepository implements ClaudeAccountSource {
  readonly #rootDirectory: string;
  readonly #registryPath: string;
  readonly #isolatedCredentialStorageAvailable: boolean;
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #homeDirectory: string;
  readonly #cooldowns = new Map<ClaudeAccountId, number>();
  readonly #needsLogin = new Set<ClaudeAccountId>();
  #accounts: StoredClaudeSubscriptionAccount[] = [];
  #mutationQueue: Promise<void> = Promise.resolve();
  #serverPort = CLAUDE_SUBSCRIPTION_DEFAULT_PORT;
  #initialized = false;

  constructor(options: ClaudeAccountRepositoryOptions) {
    this.#rootDirectory = normalizeAbsolutePath(options.rootDirectory);
    this.#registryPath = path.join(this.#rootDirectory, REGISTRY_FILE);
    this.#homeDirectory = normalizeAbsolutePath(options.homeDirectory);
    this.#isolatedCredentialStorageAvailable = options.isolatedCredentialStorageAvailable;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    await mkdir(this.#rootDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.#rootDirectory, 0o700);
    await this.#assertPlainDirectory(this.#rootDirectory);
    try {
      const registry = parseRegistry(JSON.parse(await readFile(this.#registryPath, 'utf8')));
      for (const account of registry.accounts) this.#assertStoredAccountPaths(account);
      this.#accounts = registry.accounts;
      await chmod(this.#registryPath, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.#serverPort = await this.#loadServerPort();
    this.#initialized = true;
  }

  isolatedCredentialStorageAvailable(): boolean {
    return this.#isolatedCredentialStorageAvailable;
  }

  /**
   * The configured loopback port, or the default when none has been chosen.
   * Kept beside the registry rather than in the registry: it is not account state,
   * and a malformed settings file must not make the accounts unreadable.
   */
  serverPort(): number {
    return this.#serverPort;
  }

  async setServerPort(port: number): Promise<void> {
    this.#assertInitialized();
    if (
      !Number.isSafeInteger(port) ||
      port < CLAUDE_SUBSCRIPTION_MIN_PORT ||
      port > CLAUDE_SUBSCRIPTION_MAX_PORT
    ) {
      throw new Error('Claude subscription port is out of range.');
    }
    await this.#serializeMutation(async () => {
      const settingsPath = path.join(this.#rootDirectory, SETTINGS_FILE);
      const temporaryPath = path.join(
        this.#rootDirectory,
        `${SETTINGS_FILE}.tmp-${process.pid}-${randomUUID()}`
      );
      await writeFile(temporaryPath, JSON.stringify({ version: 1, port }, null, 2), {
        mode: 0o600
      });
      await renameFile(temporaryPath, settingsPath);
      this.#serverPort = port;
    });
  }

  /**
   * Writes the Codex model catalog beside the registry and returns its path, so a
   * copied profile can point at a file that actually exists. Rewritten on every
   * copy: the catalog is derived, never edited by hand.
   */
  async writeCodexModelCatalog(): Promise<string> {
    this.#assertInitialized();
    const catalogPath = path.join(this.#rootDirectory, CODEX_CATALOG_FILE);
    const temporaryPath = path.join(
      this.#rootDirectory,
      `${CODEX_CATALOG_FILE}.tmp-${process.pid}-${randomUUID()}`
    );
    await writeFile(
      temporaryPath,
      JSON.stringify(buildClaudeSubscriptionCodexModelCatalog(), null, 2),
      { mode: 0o600 }
    );
    await renameFile(temporaryPath, catalogPath);
    return catalogPath;
  }

  async #loadServerPort(): Promise<number> {
    try {
      const value: unknown = JSON.parse(
        await readFile(path.join(this.#rootDirectory, SETTINGS_FILE), 'utf8')
      );
      if (
        isRecord(value) &&
        typeof value.port === 'number' &&
        Number.isSafeInteger(value.port) &&
        value.port >= CLAUDE_SUBSCRIPTION_MIN_PORT &&
        value.port <= CLAUDE_SUBSCRIPTION_MAX_PORT
      ) {
        return value.port;
      }
    } catch {
      // Absent or unreadable settings fall back to the default rather than failing
      // startup: a bad port must not make the pool unusable.
    }
    return CLAUDE_SUBSCRIPTION_DEFAULT_PORT;
  }

  async createIdentity(): Promise<ClaudeAccountIdentity> {
    this.#assertInitialized();
    const id = this.#createId();
    if (!UUID_PATTERN.test(id) || this.#accounts.some((account) => account.id === id)) {
      throw new Error('Could not create a unique Claude account identity.');
    }
    const identity = this.#expectedIdentity(id, await this.#nextFreeSlot());
    await mkdir(identity.anthropicConfigDirectory, { recursive: true, mode: 0o700 });
    await chmod(identity.configDirectory, 0o700);
    await chmod(identity.anthropicConfigDirectory, 0o700);
    await this.#assertIdentity(identity);
    return identity;
  }

  /**
   * Slots that exist on disk but are not registered — a directory the owner logged
   * in from a terminal is exactly this. Reported so the UI can offer adoption
   * instead of asking for a login that already happened.
   */
  async listAdoptableSlots(): Promise<Array<{ slot: number; initialized: boolean }>> {
    this.#assertInitialized();
    const registered = new Set(this.#accounts.map((account) => account.slot));
    const found: Array<{ slot: number; initialized: boolean }> = [];
    let entries: string[];
    try {
      entries = await readdir(this.#homeDirectory);
    } catch {
      return found;
    }
    for (const entry of entries) {
      const match = new RegExp(`^\\${SLOT_DIRECTORY_PREFIX}(\\d+)$`, 'u').exec(entry);
      if (!match) continue;
      const slot = Number(match[1]);
      if (!isValidSlot(slot) || registered.has(slot)) continue;
      try {
        const directory = this.#slotDirectory(slot);
        if (!(await lstat(directory)).isDirectory()) continue;
        // `.claude.json` is the CLI's own marker that this directory has been used;
        // its absence means the slot was created but never logged in.
        const initialized = await lstat(path.join(directory, '.claude.json'))
          .then(() => true)
          .catch(() => false);
        found.push({ slot, initialized });
      } catch {
        continue;
      }
    }
    return found.sort((a, b) => a.slot - b.slot);
  }

  /**
   * Builds the identity for a slot that already exists, without creating or
   * touching a credential. The caller must verify the slot is authenticated before
   * persisting it — adoption never assumes a directory's contents are valid.
   */
  async adoptIdentity(slot: number): Promise<ClaudeAccountIdentity> {
    this.#assertInitialized();
    if (!isValidSlot(slot)) {
      throw new Error('Claude account slot must be an integer of at least 2.');
    }
    if (this.#accounts.some((account) => account.slot === slot)) {
      throw new Error('That Claude account slot is already registered.');
    }
    if (!(await this.#slotDirectoryExists(slot))) {
      throw new Error('That Claude account slot directory does not exist.');
    }
    const id = this.#createId();
    if (!UUID_PATTERN.test(id) || this.#accounts.some((account) => account.id === id)) {
      throw new Error('Could not create a unique Claude account identity.');
    }
    const identity = this.#expectedIdentity(id, slot);
    // The CLI does not require its Anthropic subdirectory to pre-exist, but the
    // isolated environment names it, so create it rather than failing adoption.
    await mkdir(identity.anthropicConfigDirectory, { recursive: true, mode: 0o700 });
    await this.#assertIdentity(identity);
    return identity;
  }

  getIdentity(accountId: ClaudeAccountId): ClaudeAccountIdentity | null {
    this.#assertInitialized();
    const account = this.#accounts.find((candidate) => candidate.id === accountId);
    return account ? this.#identityFromAccount(account) : null;
  }

  async discardIdentity(identity: ClaudeAccountIdentity): Promise<void> {
    this.#assertInitialized();
    await this.#assertIdentity(identity);
    if (this.#accounts.some((account) => account.id === identity.id)) {
      throw new Error('A persisted Claude account identity cannot be discarded directly.');
    }
    await rm(identity.configDirectory, { recursive: true, force: true });
  }

  async saveAccount(
    identity: ClaudeAccountIdentity,
    label: string,
    metadata: ClaudeAuthenticatedAccountMetadata
  ): Promise<ClaudeSubscriptionAccountView> {
    return await this.#serializeMutation(async () => {
      this.#assertInitialized();
      if (!this.#isolatedCredentialStorageAvailable) {
        throw new Error('Isolated Claude CLI credential storage is unavailable.');
      }
      await this.#assertIdentity(identity);
      const now = this.#now().toISOString();
      const existingIndex = this.#accounts.findIndex((account) => account.id === identity.id);
      const existing = existingIndex >= 0 ? this.#accounts[existingIndex] : undefined;
      const stored: StoredClaudeSubscriptionAccount = {
        ...identity,
        label,
        ...(metadata.email ? { email: metadata.email } : {}),
        subscriptionType: metadata.subscriptionType,
        enabled: existing?.enabled ?? true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };
      const next = [...this.#accounts];
      if (existingIndex >= 0) next[existingIndex] = stored;
      else next.push(stored);
      await this.#persist(next);
      this.#accounts = next;
      this.#needsLogin.delete(identity.id);
      this.#cooldowns.delete(identity.id);
      return this.#toView(stored);
    });
  }

  async rename(accountId: ClaudeAccountId, label: string): Promise<void> {
    await this.#mutateAccount(accountId, (account) => ({
      ...account,
      label,
      updatedAt: this.#now().toISOString()
    }));
  }

  async setEnabled(accountId: ClaudeAccountId, enabled: boolean): Promise<void> {
    await this.#mutateAccount(accountId, (account) => ({
      ...account,
      enabled,
      updatedAt: this.#now().toISOString()
    }));
  }

  async remove(accountId: ClaudeAccountId): Promise<void> {
    await this.#serializeMutation(async () => {
      this.#assertInitialized();
      const removed = this.#accounts.find((account) => account.id === accountId);
      const next = this.#accounts.filter((account) => account.id !== accountId);
      if (!removed) throw new Error('Claude account was not found.');
      await this.#persist(next);
      this.#accounts = next;
      this.#needsLogin.delete(accountId);
      this.#cooldowns.delete(accountId);
      await rm(this.#slotDirectory(removed.slot), { recursive: true, force: true });
    });
  }

  async listAccounts(): Promise<ClaudeSubscriptionAccountView[]> {
    this.#assertInitialized();
    await Promise.all(
      this.#accounts.map(async (account) => await this.#hasAccountContext(account))
    );
    return this.#accounts.map((account) => this.#toView(account));
  }

  async listRoutingAccounts(): Promise<ClaudeAccountRoutingRecord[]> {
    this.#assertInitialized();
    return await Promise.all(
      this.#accounts.map(async (account) => {
        const cooldownUntil = this.#cooldowns.get(account.id);
        return {
          id: account.id,
          enabled: account.enabled,
          hasAccountContext: await this.#hasAccountContext(account),
          needsLogin: this.#needsLogin.has(account.id),
          ...(cooldownUntil === undefined ? {} : { cooldownUntil })
        };
      })
    );
  }

  async getAccountContext(
    accountId: ClaudeAccountId
  ): Promise<ClaudeAccountExecutionContext | null> {
    this.#assertInitialized();
    const account = this.#accounts.find((candidate) => candidate.id === accountId);
    if (!account || !this.#isolatedCredentialStorageAvailable) return null;
    await this.#assertStoredAccountDirectories(account);
    return this.#contextFromAccount(account);
  }

  async getExecutionContext(
    accountId: ClaudeAccountId
  ): Promise<ClaudeAccountExecutionContext | null> {
    this.#assertInitialized();
    const account = this.#accounts.find((candidate) => candidate.id === accountId);
    if (
      !account ||
      !account.enabled ||
      this.#needsLogin.has(accountId) ||
      !this.#isolatedCredentialStorageAvailable
    ) {
      return null;
    }
    if (!(await this.#hasAccountContext(account))) return null;
    return this.#contextFromAccount(account);
  }

  markNeedsLogin(accountId: ClaudeAccountId): void {
    if (this.#accounts.some((account) => account.id === accountId)) this.#needsLogin.add(accountId);
  }

  markCooldown(accountId: ClaudeAccountId, cooldownUntil: number): void {
    if (this.#accounts.some((account) => account.id === accountId)) {
      this.#cooldowns.set(accountId, cooldownUntil);
    }
  }

  markReady(accountId: ClaudeAccountId): void {
    this.#needsLogin.delete(accountId);
    this.#cooldowns.delete(accountId);
  }

  async #mutateAccount(
    accountId: ClaudeAccountId,
    mutate: (account: StoredClaudeSubscriptionAccount) => StoredClaudeSubscriptionAccount
  ): Promise<void> {
    await this.#serializeMutation(async () => {
      this.#assertInitialized();
      const index = this.#accounts.findIndex((account) => account.id === accountId);
      if (index < 0) throw new Error('Claude account was not found.');
      const next = [...this.#accounts];
      next[index] = mutate(next[index]);
      await this.#persist(next);
      this.#accounts = next;
    });
  }

  async #serializeMutation<T>(mutate: () => Promise<T>): Promise<T> {
    const operation = this.#mutationQueue.then(mutate);
    this.#mutationQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return await operation;
  }

  #toView(account: StoredClaudeSubscriptionAccount): ClaudeSubscriptionAccountView {
    const cooldownUntil = this.#cooldowns.get(account.id);
    let status: ClaudeSubscriptionAccountStatus = 'usable';
    if (!account.enabled) status = 'disabled';
    else if (!this.#isolatedCredentialStorageAvailable || this.#needsLogin.has(account.id)) {
      status = 'reconnect';
    } else if (cooldownUntil !== undefined && cooldownUntil > Date.now()) status = 'limited';
    return {
      id: account.id,
      label: account.label,
      ...(account.email ? { email: account.email } : {}),
      subscriptionType: account.subscriptionType,
      enabled: account.enabled,
      status,
      activeRequests: 0,
      ...(cooldownUntil === undefined ? {} : { cooldownUntil }),
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    };
  }

  async #persist(accounts: StoredClaudeSubscriptionAccount[]): Promise<void> {
    const temporaryPath = path.join(
      this.#rootDirectory,
      `${REGISTRY_FILE}.tmp-${process.pid}-${randomUUID()}`
    );
    const registry: ClaudeAccountRegistry = { version: REGISTRY_VERSION, accounts };
    try {
      await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx'
      });
      await renameFile(temporaryPath, this.#registryPath);
      await chmod(this.#registryPath, 0o600);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  #expectedIdentity(accountId: ClaudeAccountId, slot: number): ClaudeAccountIdentity {
    if (!isValidSlot(slot)) {
      throw new Error('Claude account slot must be an integer of at least 2.');
    }
    const configDirectory = this.#slotDirectory(slot);
    return {
      id: accountId,
      slot,
      configDirectory,
      secureStorageConfigDirectory: configDirectory,
      anthropicConfigDirectory: path.join(configDirectory, ANTHROPIC_DIRECTORY).normalize('NFC'),
      partition: `persist:bitterless-claude-account-${accountId}`
    };
  }

  #identityFromAccount(account: StoredClaudeSubscriptionAccount): ClaudeAccountIdentity {
    return {
      id: account.id,
      slot: account.slot,
      configDirectory: account.configDirectory,
      secureStorageConfigDirectory: account.secureStorageConfigDirectory,
      anthropicConfigDirectory: account.anthropicConfigDirectory,
      partition: account.partition
    };
  }

  #contextFromAccount(account: StoredClaudeSubscriptionAccount): ClaudeAccountExecutionContext {
    return {
      configDirectory: account.configDirectory,
      secureStorageConfigDirectory: account.secureStorageConfigDirectory,
      anthropicConfigDirectory: account.anthropicConfigDirectory
    };
  }

  #slotDirectory(slot: number): string {
    return path.join(this.#homeDirectory, `${SLOT_DIRECTORY_PREFIX}${slot}`).normalize('NFC');
  }

  /**
   * Lowest slot that is neither registered nor already present on disk.
   *
   * The on-disk check is not redundant with the registry: the owner creates and
   * logs into `~/.claude<N>` directories by hand, and those are invisible here.
   * Allocating one of them would point a fresh login at an existing account —
   * overwriting its credential, and deleting the whole directory if verification
   * then failed. Adoption is the path for an existing directory; creation must
   * never land on one.
   */
  async #nextFreeSlot(): Promise<number> {
    const registered = new Set(this.#accounts.map((account) => account.slot));
    let slot = MINIMUM_SLOT;
    for (;;) {
      if (!registered.has(slot) && !(await this.#slotDirectoryExists(slot))) return slot;
      slot += 1;
    }
  }

  async #slotDirectoryExists(slot: number): Promise<boolean> {
    try {
      await lstat(this.#slotDirectory(slot));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      // An unreadable entry is still an entry: refuse to claim it.
      return true;
    }
  }

  async #assertIdentity(identity: ClaudeAccountIdentity): Promise<void> {
    const expected = this.#expectedIdentity(identity.id, identity.slot);
    if (
      identity.configDirectory !== expected.configDirectory ||
      identity.secureStorageConfigDirectory !== expected.secureStorageConfigDirectory ||
      identity.anthropicConfigDirectory !== expected.anthropicConfigDirectory ||
      identity.partition !== expected.partition
    ) {
      throw new Error('Claude account paths must remain inside the managed account root.');
    }
    await this.#assertPlainDirectory(identity.configDirectory);
    await this.#assertPlainDirectory(identity.anthropicConfigDirectory);
  }

  #assertStoredAccountPaths(account: StoredClaudeSubscriptionAccount): void {
    const expected = this.#expectedIdentity(account.id, account.slot);
    if (
      account.configDirectory !== expected.configDirectory ||
      account.secureStorageConfigDirectory !== expected.secureStorageConfigDirectory ||
      account.anthropicConfigDirectory !== expected.anthropicConfigDirectory ||
      account.partition !== expected.partition
    ) {
      throw new Error('Persisted Claude account paths escape the managed account root.');
    }
  }

  async #assertStoredAccountDirectories(account: StoredClaudeSubscriptionAccount): Promise<void> {
    this.#assertStoredAccountPaths(account);
    await this.#assertPlainDirectory(account.configDirectory);
    await this.#assertPlainDirectory(account.anthropicConfigDirectory);
  }

  async #hasAccountContext(account: StoredClaudeSubscriptionAccount): Promise<boolean> {
    if (!this.#isolatedCredentialStorageAvailable) return false;
    try {
      await this.#assertStoredAccountDirectories(account);
      return true;
    } catch {
      this.#needsLogin.add(account.id);
      return false;
    }
  }

  async #assertPlainDirectory(directory: string): Promise<void> {
    const value = await lstat(directory);
    if (!value.isDirectory() || value.isSymbolicLink()) {
      throw new Error('Managed Claude account path must be a plain directory.');
    }
  }

  #assertInitialized(): void {
    if (!this.#initialized) throw new Error('Claude account repository is not initialized.');
  }
}
