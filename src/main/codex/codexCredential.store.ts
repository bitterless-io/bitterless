import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';

export interface CodexCredentialStore {
  read(provider: string): Promise<unknown | undefined>;
  list(): Promise<readonly { providerId: string; type: string }[]>;
  modify(
    provider: string,
    update: (current: unknown | undefined) => Promise<unknown | undefined>
  ): Promise<unknown | undefined>;
  delete(provider: string): Promise<void>;
}

const FILE_MODE = 0o600;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 10;

const parseCredentials = (content: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Codex credential store must contain a JSON object.');
  }
  return value as Record<string, unknown>;
};

const credentialType = (credential: unknown): string => {
  if (!credential || typeof credential !== 'object' || Array.isArray(credential)) {
    return 'unknown';
  }
  const type = (credential as { type?: unknown }).type;
  return typeof type === 'string' ? type : 'unknown';
};

const waitSynchronously = (durationMs: number): void => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    // Credential operations are rare and match Pi's bounded synchronous lock retry.
  }
};

export class CodexFileCredentialStore implements CodexCredentialStore {
  private readonly lockPath: string;

  constructor(private readonly authPath: string) {
    this.lockPath = `${authPath}.lock`;
  }

  async read(provider: string): Promise<unknown | undefined> {
    return this.withLock((credentials) => credentials[provider]);
  }

  async list(): Promise<readonly { providerId: string; type: string }[]> {
    return this.withLock((credentials) =>
      Object.entries(credentials).map(([providerId, credential]) => ({
        providerId,
        type: credentialType(credential)
      }))
    );
  }

  async modify(
    provider: string,
    update: (current: unknown | undefined) => Promise<unknown | undefined>
  ): Promise<unknown | undefined> {
    return this.withLock(async (credentials) => {
      const next = await update(credentials[provider]);
      if (next === undefined) return credentials[provider];
      credentials[provider] = next;
      this.write(credentials);
      return next;
    });
  }

  async delete(provider: string): Promise<void> {
    await this.withLock((credentials) => {
      delete credentials[provider];
      this.write(credentials);
    });
  }

  private ensureFile(): void {
    mkdirSync(dirname(this.authPath), { recursive: true, mode: 0o700 });
    if (!existsSync(this.authPath)) {
      writeFileSync(this.authPath, '{}', { encoding: 'utf8', mode: FILE_MODE });
    }
    if (process.platform !== 'win32') chmodSync(this.authPath, FILE_MODE);
  }

  private readAll(): Record<string, unknown> {
    return parseCredentials(readFileSync(this.authPath, 'utf8'));
  }

  private write(credentials: Record<string, unknown>): void {
    writeFileSync(this.authPath, JSON.stringify(credentials, null, 2), {
      encoding: 'utf8',
      mode: FILE_MODE
    });
    if (process.platform !== 'win32') chmodSync(this.authPath, FILE_MODE);
  }

  private acquireLock(): void {
    for (let attempt = 1; attempt <= LOCK_MAX_ATTEMPTS; attempt += 1) {
      try {
        mkdirSync(this.lockPath, { mode: 0o700 });
        return;
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code)
            : '';
        if (code !== 'EEXIST') throw error;
        try {
          if (Date.now() - statSync(this.lockPath).mtimeMs > LOCK_STALE_MS) {
            rmSync(this.lockPath, { recursive: true, force: true });
            continue;
          }
        } catch {
          continue;
        }
        if (attempt === LOCK_MAX_ATTEMPTS) {
          throw new Error('Codex credential store is locked.');
        }
        waitSynchronously(LOCK_RETRY_MS);
      }
    }
  }

  private async withLock<T>(
    operation: (credentials: Record<string, unknown>) => T | Promise<T>
  ): Promise<T> {
    this.ensureFile();
    this.acquireLock();
    try {
      return await operation(this.readAll());
    } finally {
      rmSync(this.lockPath, { recursive: true, force: true });
    }
  }
}

export class CodexMemoryCredentialStore implements CodexCredentialStore {
  private readonly credentials = new Map<string, unknown>();
  private readonly writeTails = new Map<string, Promise<void>>();

  async read(provider: string): Promise<unknown | undefined> {
    return this.credentials.get(provider);
  }

  async list(): Promise<readonly { providerId: string; type: string }[]> {
    return Array.from(this.credentials, ([providerId, credential]) => ({
      providerId,
      type: credentialType(credential)
    }));
  }

  async modify(
    provider: string,
    update: (current: unknown | undefined) => Promise<unknown | undefined>
  ): Promise<unknown | undefined> {
    let result: unknown | undefined;
    const previous = this.writeTails.get(provider) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const next = await update(this.credentials.get(provider));
        if (next !== undefined) this.credentials.set(provider, next);
        result = this.credentials.get(provider);
      });
    this.writeTails.set(provider, current);
    try {
      await current;
      return result;
    } finally {
      if (this.writeTails.get(provider) === current) this.writeTails.delete(provider);
    }
  }

  async delete(provider: string): Promise<void> {
    await this.modify(provider, async () => {
      this.credentials.delete(provider);
      return undefined;
    });
  }
}
