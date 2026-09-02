import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Named ChatGPT credentials for the GPT half of the endpoint.
 *
 * Codex sign-in is browser OAuth and writes a single `auth.json`, shared with
 * Translator — one account at a time, which is why the panel could only report a
 * connection rather than offer a pool. The login flow cannot be made to produce two
 * credentials at once, but the credential it produces can be **captured**: sign in,
 * save it under a name, sign in as someone else, save that too.
 *
 * The captured copies are what the endpoint reads. Translator keeps using the live
 * file, so switching the endpoint's account never disturbs it.
 */
export interface StoredCodexAccount {
  id: string;
  label: string;
  /** `accountId` from the captured credential, when it carries one. */
  chatgptAccountId?: string;
  createdAt: string;
}

interface CodexAccountRegistry {
  version: 1;
  activeId: string | null;
  accounts: StoredCodexAccount[];
}

const EMPTY: CodexAccountRegistry = { version: 1, activeId: null, accounts: [] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRegistry = (value: unknown): CodexAccountRegistry => {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.accounts)) return EMPTY;
  const accounts: StoredCodexAccount[] = [];
  for (const entry of value.accounts) {
    if (!isRecord(entry)) continue;
    const { id, label, createdAt, chatgptAccountId } = entry;
    if (typeof id !== 'string' || typeof label !== 'string' || typeof createdAt !== 'string') {
      continue;
    }
    accounts.push({
      id,
      label,
      createdAt,
      ...(typeof chatgptAccountId === 'string' ? { chatgptAccountId } : {})
    });
  }
  const activeId = typeof value.activeId === 'string' ? value.activeId : null;
  return {
    version: 1,
    accounts,
    activeId: accounts.some((account) => account.id === activeId) ? activeId : null
  };
};

export interface CodexAccountRepositoryOptions {
  rootDirectory: string;
  /** The live credential the Codex login flow writes, shared with Translator. */
  liveAuthPath: () => string;
  createId?: () => string;
  now?: () => Date;
}

export class CodexAccountRepository {
  readonly #options: CodexAccountRepositoryOptions;
  #registry: CodexAccountRegistry = EMPTY;
  #loaded = false;

  constructor(options: CodexAccountRepositoryOptions) {
    this.#options = options;
  }

  #registryPath(): string {
    return path.join(this.#options.rootDirectory, 'codex-accounts.json');
  }

  /** Derived from the id, never read back from the registry file. */
  authPathFor(accountId: string): string {
    if (!/^[0-9a-f-]{36}$/u.test(accountId)) {
      throw new Error('A Codex account id is malformed.');
    }
    return path.join(this.#options.rootDirectory, 'codex', accountId, 'auth.json');
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    try {
      this.#registry = parseRegistry(JSON.parse(await readFile(this.#registryPath(), 'utf8')));
    } catch {
      // Absent or unreadable reads as empty. A corrupt registry must not stop the
      // endpoint from starting; the Claude half is unaffected either way.
      this.#registry = EMPTY;
    }
    this.#loaded = true;
  }

  async list(): Promise<StoredCodexAccount[]> {
    await this.load();
    return this.#registry.accounts.map((account) => ({ ...account }));
  }

  async activeId(): Promise<string | null> {
    await this.load();
    return this.#registry.activeId;
  }

  /**
   * The credential the endpoint should read: the active capture, or the live file when
   * nothing has been captured. Falling back rather than failing keeps a fresh install
   * working exactly as it did before captures existed.
   */
  async activeAuthPath(): Promise<string> {
    await this.load();
    return this.activeAuthPathSync();
  }

  /**
   * Same answer without awaiting, for the upstream's `authPath()` hook — it is called
   * per request and must reflect the current selection immediately, not a value
   * captured once at startup.
   */
  activeAuthPathSync(): string {
    const { activeId } = this.#registry;
    return activeId ? this.authPathFor(activeId) : this.#options.liveAuthPath();
  }

  /** Copies the live credential into a new named slot and activates it. */
  async capture(label: string): Promise<StoredCodexAccount> {
    await this.load();
    const trimmed = label.trim();
    if (!trimmed || trimmed.length > 64) throw new Error('A Codex account label is required.');
    const live = this.#options.liveAuthPath();
    const raw = await readFile(live, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const chatgptAccountId =
      isRecord(parsed) && typeof parsed.accountId === 'string' ? parsed.accountId : undefined;
    if (
      chatgptAccountId &&
      this.#registry.accounts.some((account) => account.chatgptAccountId === chatgptAccountId)
    ) {
      throw new Error('That ChatGPT account is already saved.');
    }
    const id = (this.#options.createId ?? randomUUID)();
    const target = this.authPathFor(id);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(live, target);
    const account: StoredCodexAccount = {
      id,
      label: trimmed,
      ...(chatgptAccountId ? { chatgptAccountId } : {}),
      createdAt: (this.#options.now ?? (() => new Date()))().toISOString()
    };
    this.#registry = {
      version: 1,
      activeId: id,
      accounts: [...this.#registry.accounts, account]
    };
    await this.#persist();
    return { ...account };
  }

  async activate(accountId: string): Promise<void> {
    await this.load();
    if (!this.#registry.accounts.some((account) => account.id === accountId)) {
      throw new Error('That Codex account is not registered.');
    }
    this.#registry = { ...this.#registry, activeId: accountId };
    await this.#persist();
  }

  async remove(accountId: string): Promise<void> {
    await this.load();
    const accounts = this.#registry.accounts.filter((account) => account.id !== accountId);
    if (accounts.length === this.#registry.accounts.length) return;
    // The credential goes with the record: leaving it behind would keep a usable
    // ChatGPT token on disk for an account the owner believes they removed.
    await rm(path.dirname(this.authPathFor(accountId)), { recursive: true, force: true });
    this.#registry = {
      version: 1,
      accounts,
      activeId:
        this.#registry.activeId === accountId ? (accounts[0]?.id ?? null) : this.#registry.activeId
    };
    await this.#persist();
  }

  async #persist(): Promise<void> {
    await mkdir(this.#options.rootDirectory, { recursive: true, mode: 0o700 });
    await writeFile(this.#registryPath(), `${JSON.stringify(this.#registry, null, 2)}\n`, {
      mode: 0o600
    });
  }
}
