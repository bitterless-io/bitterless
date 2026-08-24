import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename as renameFile,
  rm,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import type {
  ClaudeAccountId,
  ClaudeSubscriptionAccountStatus,
  ClaudeSubscriptionAccountView,
  ClaudeSubscriptionType
} from '@shared/claudeSubscription/claudeSubscription.contract';

export interface StoredClaudeSubscriptionAccount {
  id: ClaudeAccountId;
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
  version: 2;
  accounts: StoredClaudeSubscriptionAccount[];
}

export interface ClaudeAccountRepositoryOptions {
  rootDirectory: string;
  isolatedCredentialStorageAvailable: boolean;
  now?: () => Date;
  createId?: () => string;
}

const REGISTRY_FILE = 'accounts.json';
const ACCOUNT_DIRECTORY = 'accounts';
const ACCOUNT_PROFILE_DIRECTORY = 'profile';
const ANTHROPIC_DIRECTORY = 'anthropic';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REGISTRY_KEYS = ['accounts', 'version'] as const;
const ACCOUNT_KEYS = [
  'anthropicConfigDirectory',
  'configDirectory',
  'createdAt',
  'enabled',
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
    value.version !== 2 ||
    !Array.isArray(value.accounts) ||
    !value.accounts.every(isStoredAccount)
  ) {
    throw new Error('Unsupported Claude subscription account registry.');
  }
  return { version: 2, accounts: value.accounts };
};

const normalizeAbsolutePath = (value: string): string => path.resolve(value).normalize('NFC');

export class ClaudeAccountRepository implements ClaudeAccountSource {
  readonly #rootDirectory: string;
  readonly #accountsDirectory: string;
  readonly #registryPath: string;
  readonly #isolatedCredentialStorageAvailable: boolean;
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #cooldowns = new Map<ClaudeAccountId, number>();
  readonly #needsLogin = new Set<ClaudeAccountId>();
  #accounts: StoredClaudeSubscriptionAccount[] = [];
  #mutationQueue: Promise<void> = Promise.resolve();
  #initialized = false;

  constructor(options: ClaudeAccountRepositoryOptions) {
    this.#rootDirectory = normalizeAbsolutePath(options.rootDirectory);
    this.#accountsDirectory = path.join(this.#rootDirectory, ACCOUNT_DIRECTORY);
    this.#registryPath = path.join(this.#rootDirectory, REGISTRY_FILE);
    this.#isolatedCredentialStorageAvailable = options.isolatedCredentialStorageAvailable;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    await mkdir(this.#rootDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.#rootDirectory, 0o700);
    await this.#assertPlainDirectory(this.#rootDirectory);
    await mkdir(this.#accountsDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.#accountsDirectory, 0o700);
    await this.#assertPlainDirectory(this.#accountsDirectory);
    try {
      const registry = parseRegistry(JSON.parse(await readFile(this.#registryPath, 'utf8')));
      for (const account of registry.accounts) this.#assertStoredAccountPaths(account);
      this.#accounts = registry.accounts;
      await chmod(this.#registryPath, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.#initialized = true;
  }

  isolatedCredentialStorageAvailable(): boolean {
    return this.#isolatedCredentialStorageAvailable;
  }

  async createIdentity(): Promise<ClaudeAccountIdentity> {
    this.#assertInitialized();
    const id = this.#createId();
    if (!UUID_PATTERN.test(id) || this.#accounts.some((account) => account.id === id)) {
      throw new Error('Could not create a unique Claude account identity.');
    }
    const identity = this.#expectedIdentity(id);
    await mkdir(identity.anthropicConfigDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.#accountDirectory(id), 0o700);
    await chmod(identity.configDirectory, 0o700);
    await chmod(identity.anthropicConfigDirectory, 0o700);
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
    await rm(this.#accountDirectory(identity.id), { recursive: true, force: true });
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
      const next = this.#accounts.filter((account) => account.id !== accountId);
      if (next.length === this.#accounts.length) throw new Error('Claude account was not found.');
      await this.#persist(next);
      this.#accounts = next;
      this.#needsLogin.delete(accountId);
      this.#cooldowns.delete(accountId);
      await rm(this.#accountDirectory(accountId), { recursive: true, force: true });
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
    const registry: ClaudeAccountRegistry = { version: 2, accounts };
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

  #expectedIdentity(accountId: ClaudeAccountId): ClaudeAccountIdentity {
    const configDirectory = path.join(
      this.#accountDirectory(accountId),
      ACCOUNT_PROFILE_DIRECTORY
    ).normalize('NFC');
    return {
      id: accountId,
      configDirectory,
      secureStorageConfigDirectory: configDirectory,
      anthropicConfigDirectory: path.join(configDirectory, ANTHROPIC_DIRECTORY).normalize('NFC'),
      partition: `persist:bitterless-claude-account-${accountId}`
    };
  }

  #identityFromAccount(account: StoredClaudeSubscriptionAccount): ClaudeAccountIdentity {
    return {
      id: account.id,
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

  #accountDirectory(accountId: ClaudeAccountId): string {
    return path.join(this.#accountsDirectory, accountId).normalize('NFC');
  }

  async #assertIdentity(identity: ClaudeAccountIdentity): Promise<void> {
    const expected = this.#expectedIdentity(identity.id);
    if (
      identity.configDirectory !== expected.configDirectory ||
      identity.secureStorageConfigDirectory !== expected.secureStorageConfigDirectory ||
      identity.anthropicConfigDirectory !== expected.anthropicConfigDirectory ||
      identity.partition !== expected.partition
    ) {
      throw new Error('Claude account paths must remain inside the managed account root.');
    }
    await this.#assertPlainDirectory(this.#accountDirectory(identity.id));
    await this.#assertPlainDirectory(identity.configDirectory);
    await this.#assertPlainDirectory(identity.anthropicConfigDirectory);
  }

  #assertStoredAccountPaths(account: StoredClaudeSubscriptionAccount): void {
    const expected = this.#expectedIdentity(account.id);
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
    await this.#assertPlainDirectory(this.#accountDirectory(account.id));
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
