import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  CoinGmgnOfficialLinkTarget,
  CoinGmgnProbeCode,
  CoinGmgnProbeReceipt,
  CoinGmgnSaveReceipt,
  CoinGmgnStatus,
} from '@shared/coin/coinResource.type';
import type { CoinChain } from '@shared/coin/coinAnalysis.type';
import {
  CoinProcessError,
  type CoinProcessRequest,
  type CoinProcessRunner,
} from './coinProcess.runner';
import { parseGmgnOfficialLinkTarget } from './resourceValidation';

const VERSION_ARGS = ['--version'] as const;
export const GMGN_READ_ONLY_PROBE_ARGS = [
  'market',
  'trending',
  '--chain',
  'sol',
  '--interval',
  '1h',
  '--limit',
  '3',
  '--raw',
] as const;
const VERSION_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 20_000;
const VERSION_OUTPUT_LIMIT = 4 * 1024;
const PROBE_OUTPUT_LIMIT = 256 * 1024;
const MAX_CREDENTIAL_FILE_BYTES = 64 * 1024;
const READ_TIMEOUT_MS = 25_000;
const READ_OUTPUT_LIMIT = 512 * 1024;
const READ_START_COOLDOWN_MS = 750;
const RATE_LIMIT_COOLDOWN_MS = 30_000;
const MAX_QUEUED_READS = 12;

const GMGN_OFFICIAL_URLS: Record<CoinGmgnOfficialLinkTarget, string> = {
  repository: 'https://github.com/GMGNAI/gmgn-skills',
  cliDocs: 'https://github.com/GMGNAI/gmgn-skills/blob/main/docs/cli-usage.md',
  apiKey: 'https://gmgn.ai/ai',
};

interface ResolvedGmgnExecutable {
  displayPath: string;
  command: string;
  prefixArgs: string[];
}

interface GmgnCredentialInspection {
  apiKeyConfigured: boolean;
  privateKeyDetected: boolean;
}

export type GmgnReadInput =
  | {
      operation: 'trending' | 'hot-searches';
      chain: CoinChain;
      interval: '1m' | '5m' | '1h' | '6h' | '24h';
      limit: number;
    }
  | {
      operation: 'trenches';
      chain: CoinChain;
      types: Array<'new_creation' | 'near_completion' | 'completed'>;
      limit: number;
    }
  | {
      operation: 'token-info' | 'token-security';
      chain: CoinChain;
      address: string;
    }
  | {
      operation: 'token-holders' | 'token-traders';
      chain: CoinChain;
      address: string;
      limit: number;
    };

export type GmgnReadErrorCode =
  | 'cancelled'
  | 'cli-missing'
  | 'invalid-input'
  | 'invalid-response'
  | 'key-missing'
  | 'output-limit'
  | 'private-key-detected'
  | 'process-failed'
  | 'queue-full'
  | 'rate-limited'
  | 'timeout'
  | 'unauthorized';

export class GmgnReadError extends Error {
  constructor(readonly code: GmgnReadErrorCode) {
    super(code);
    this.name = 'GmgnReadError';
  }
}

export interface GmgnReadResult {
  operation: GmgnReadInput['operation'];
  observedAt: number;
  data: unknown;
}

export interface GmgnCliServiceDependencies {
  homeDir(): string;
  processEnv(): NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  runProcess: CoinProcessRunner;
  openExternal(url: string): Promise<void>;
  now?: () => number;
  nodeExecutable?: string;
}

const ensurePrivateDirectory = (directory: string): void => {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(directory, 0o700);
};

const isExecutable = (path: string, platform: NodeJS.Platform): boolean => {
  if (!existsSync(path)) return false;
  if (platform === 'win32') return true;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const isPathInside = (parent: string, candidate: string): boolean => {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
};

const readPackageBin = (packageRoot: string): string | null => {
  const packagePath = join(packageRoot, 'package.json');
  if (!existsSync(packagePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const bin =
      typeof parsed.bin === 'string'
        ? parsed.bin
        : parsed.bin && typeof parsed.bin.gmgn === 'string'
          ? parsed.bin.gmgn
          : parsed.bin && typeof parsed.bin['gmgn-cli'] === 'string'
            ? parsed.bin['gmgn-cli']
            : null;
    if (!bin) return null;
    const entry = resolve(packageRoot, bin);
    return isPathInside(packageRoot, entry) && existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
};

export const buildSanitizedGmgnEnv = (
  source: NodeJS.ProcessEnv,
  homeDir: string,
  pathValue: string,
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    PATH: pathValue,
    HOME: homeDir,
    USERPROFILE: homeDir,
    XDG_CONFIG_HOME: join(homeDir, '.config'),
    NO_COLOR: '1',
  };
  const allowed = new Set([
    'APPDATA',
    'LOCALAPPDATA',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATHEXT',
  ]);
  for (const [key, value] of Object.entries(source)) {
    if (value != null && (allowed.has(key) || key.startsWith('LC_'))) env[key] = value;
  }
  return env;
};

export const resolveGmgnOfficialUrl = (value: unknown): string => {
  const target = parseGmgnOfficialLinkTarget(value);
  const url = new URL(GMGN_OFFICIAL_URLS[target]);
  const allowed =
    (url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith('/GMGNAI/gmgn-skills')) ||
    (url.protocol === 'https:' && url.hostname === 'gmgn.ai' && url.pathname === '/ai');
  if (!allowed || url.username || url.password || url.search || url.hash) {
    throw new Error('GMGN official link is not allowlisted.');
  }
  return url.href;
};

const displayPath = (path: string, homeDir: string): string => {
  const home = resolve(homeDir);
  const absolute = resolve(path);
  const shown = isPathInside(home, absolute) ? `~${sep}${relative(home, absolute)}` : absolute;
  return shown.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 500);
};

const inspectCredentialText = (text: string): GmgnCredentialInspection => {
  let apiKeyConfigured = false;
  let privateKeyDetected = false;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=([\s\S]*)$/);
    if (!match) continue;
    if (match[1] === 'GMGN_API_KEY' && match[2]?.trim()) apiKeyConfigured = true;
    if (match[1] === 'GMGN_PRIVATE_KEY') privateKeyDetected = true;
  }
  return { apiKeyConfigured, privateKeyDetected };
};

const parseRecordCount = (stdout: string): number | null => {
  const text = stdout.trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) return parsed.length;
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.data)) return record.data.length;
    if (Array.isArray(record.items)) return record.items.length;
    return 1;
  }
  return null;
};

const classifyProcessFailure = (error: CoinProcessError): CoinGmgnProbeCode => {
  if (error.code === 'aborted') return 'cancelled';
  if (error.code === 'timeout') return 'timeout';
  if (error.code === 'output-limit') return 'output-limit';
  const stderr = error.stderr.toLowerCase();
  if (/unauthori[sz]ed|invalid api key|status\s*401/.test(stderr)) return 'unauthorized';
  if (/rate.?limit|too many requests|status\s*429/.test(stderr)) return 'rate-limited';
  return 'process-failed';
};

const chainArgument = (chain: CoinChain): 'robinhood' | 'bsc' | 'sol' =>
  chain === 'solana' ? 'sol' : chain;

const validateAddress = (chain: CoinChain, address: string): string => {
  const normalized = address.trim();
  const valid = chain === 'solana'
    ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(normalized)
    : /^0x[0-9a-fA-F]{40}$/.test(normalized);
  if (!valid) throw new GmgnReadError('invalid-input');
  return normalized;
};

const validateLimit = (value: number): string => {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new GmgnReadError('invalid-input');
  }
  return String(value);
};

export const buildGmgnReadArgs = (input: GmgnReadInput): string[] => {
  const chain = chainArgument(input.chain);
  if (input.operation === 'trending' || input.operation === 'hot-searches') {
    return [
      'market',
      input.operation,
      '--chain',
      chain,
      '--interval',
      input.interval,
      '--limit',
      validateLimit(input.limit),
      '--raw',
    ];
  }
  if (input.operation === 'trenches') {
    if (
      input.types.length < 1 ||
      input.types.length > 3 ||
      new Set(input.types).size !== input.types.length
    ) {
      throw new GmgnReadError('invalid-input');
    }
    return [
      'market',
      'trenches',
      '--chain',
      chain,
      ...input.types.flatMap((type) => ['--type', type]),
      '--limit',
      validateLimit(input.limit),
      '--raw',
    ];
  }
  if (!('address' in input)) throw new GmgnReadError('invalid-input');
  const action = input.operation.replace('token-', '');
  return [
    'token',
    action,
    '--chain',
    chain,
    '--address',
    validateAddress(input.chain, input.address),
    ...('limit' in input ? ['--limit', validateLimit(input.limit)] : []),
    '--raw',
  ];
};

const waitFor = async (delayMs: number, signal?: AbortSignal): Promise<void> => {
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GmgnReadError('cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new GmgnReadError('cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

const readFailureCode = (error: CoinProcessError): GmgnReadErrorCode => {
  const code = classifyProcessFailure(error);
  return code === 'verified' ? 'process-failed' : code;
};

export class GmgnCliService {
  private readonly now: () => number;
  private resolvedExecutable: ResolvedGmgnExecutable | null = null;
  private lastProbe: CoinGmgnProbeReceipt | null = null;
  private detectPromise: Promise<CoinGmgnStatus> | null = null;
  private verifyPromise: Promise<CoinGmgnProbeReceipt> | null = null;
  private verifyController: AbortController | null = null;
  private readQueue: Promise<void> = Promise.resolve();
  private queuedReads = 0;
  private nextReadAllowedAt = 0;
  private cooldownUntil = 0;

  constructor(private readonly dependencies: GmgnCliServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  get credentialPath(): string {
    return join(this.dependencies.homeDir(), '.config', 'gmgn', '.env');
  }

  get readCooldownUntil(): number {
    return Math.max(this.cooldownUntil, this.nextReadAllowedAt);
  }

  detect(): Promise<CoinGmgnStatus> {
    if (!this.detectPromise) {
      const detection = this.performDetection();
      const tracked = detection.finally(() => {
        if (this.detectPromise === tracked) this.detectPromise = null;
      });
      this.detectPromise = tracked;
    }
    return this.detectPromise;
  }

  async saveApiKey(value: unknown): Promise<CoinGmgnSaveReceipt> {
    const savedAt = this.now();
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('invalid');
      }
      const record = value as Record<string, unknown>;
      if (Object.keys(record).length !== 1 || typeof record.apiKey !== 'string') {
        throw new Error('invalid');
      }
      const apiKey = record.apiKey.trim();
      if (
        apiKey.length < 8 ||
        apiKey.length > 4096 ||
        !/^[A-Za-z0-9._~+/:=-]+$/.test(apiKey)
      ) {
        return { ok: false, configured: false, savedAt, errorCode: 'invalid-api-key' };
      }
      const directory = dirname(this.credentialPath);
      const temporaryPath = `${this.credentialPath}.tmp`;
      ensurePrivateDirectory(directory);
      try {
        writeFileSync(temporaryPath, `GMGN_API_KEY=${apiKey}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
        if (process.platform !== 'win32') chmodSync(temporaryPath, 0o600);
        renameSync(temporaryPath, this.credentialPath);
        if (process.platform !== 'win32') chmodSync(this.credentialPath, 0o600);
      } catch {
        rmSync(temporaryPath, { force: true });
        return { ok: false, configured: false, savedAt, errorCode: 'write-failed' };
      }
      return { ok: true, configured: true, savedAt };
    } catch {
      return { ok: false, configured: false, savedAt, errorCode: 'invalid-api-key' };
    }
  }

  verify(): Promise<CoinGmgnProbeReceipt> {
    if (!this.verifyPromise) {
      const controller = new AbortController();
      this.verifyController = controller;
      const verification = this.performVerification(controller.signal);
      const tracked = verification.finally(() => {
        if (this.verifyPromise === tracked) this.verifyPromise = null;
        if (this.verifyController === controller) this.verifyController = null;
      });
      this.verifyPromise = tracked;
    }
    return this.verifyPromise;
  }

  cancelVerify(): boolean {
    if (!this.verifyController || this.verifyController.signal.aborted) return false;
    this.verifyController.abort();
    return true;
  }

  read(input: GmgnReadInput, signal?: AbortSignal): Promise<GmgnReadResult> {
    if (this.queuedReads >= MAX_QUEUED_READS) {
      return Promise.reject(new GmgnReadError('queue-full'));
    }
    let args: string[];
    try {
      args = buildGmgnReadArgs(input);
    } catch (error) {
      return Promise.reject(
        error instanceof GmgnReadError ? error : new GmgnReadError('invalid-input'),
      );
    }
    this.queuedReads += 1;
    const operation = this.readQueue.then(async () => {
      await waitFor(Math.max(0, this.cooldownUntil - this.now()), signal);
      await waitFor(Math.max(0, this.nextReadAllowedAt - this.now()), signal);
      return await this.performRead(input, args, signal);
    });
    this.readQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation.finally(() => {
      this.queuedReads -= 1;
    });
  }

  async openOfficialLink(value: unknown): Promise<boolean> {
    try {
      await this.dependencies.openExternal(resolveGmgnOfficialUrl(value));
      return true;
    } catch {
      return false;
    }
  }

  private inspectCredential(): GmgnCredentialInspection {
    if (!existsSync(this.credentialPath)) {
      return { apiKeyConfigured: false, privateKeyDetected: false };
    }
    if (statSync(this.credentialPath).size > MAX_CREDENTIAL_FILE_BYTES) {
      throw new Error('GMGN credential file is too large.');
    }
    return inspectCredentialText(readFileSync(this.credentialPath, 'utf8'));
  }

  private resolveExecutable(): ResolvedGmgnExecutable | null {
    const env = this.dependencies.processEnv();
    const pathValue = env.PATH || '';
    const pathDelimiter = this.dependencies.platform === 'win32' ? ';' : delimiter;
    const names = this.dependencies.platform === 'win32'
      ? ['gmgn-cli.exe', 'gmgn-cli.cmd']
      : ['gmgn-cli'];
    for (const directory of pathValue.split(pathDelimiter)) {
      if (!directory.trim()) continue;
      for (const name of names) {
        const candidate = resolve(directory, name);
        if (!isExecutable(candidate, this.dependencies.platform)) continue;
        if (this.dependencies.platform !== 'win32' || name.endsWith('.exe')) {
          return {
            displayPath: displayPath(candidate, this.dependencies.homeDir()),
            command: candidate,
            prefixArgs: [],
          };
        }
        const packageRoots = [
          env.LOCALAPPDATA
            ? join(env.LOCALAPPDATA, 'Yarn', 'Data', 'global', 'node_modules', 'gmgn-cli')
            : '',
          env.APPDATA ? join(env.APPDATA, 'npm', 'node_modules', 'gmgn-cli') : '',
        ].filter(Boolean);
        for (const packageRoot of packageRoots) {
          const entry = readPackageBin(packageRoot);
          if (!entry) continue;
          return {
            displayPath: displayPath(candidate, this.dependencies.homeDir()),
            command: this.dependencies.nodeExecutable || process.execPath,
            prefixArgs: [entry],
          };
        }
      }
    }
    return null;
  }

  private processRequest(
    executable: ResolvedGmgnExecutable,
    args: readonly string[],
    options: { timeoutMs: number; maxOutputBytes: number; signal?: AbortSignal },
  ): CoinProcessRequest {
    const source = this.dependencies.processEnv();
    return {
      command: executable.command,
      args: [...executable.prefixArgs, ...args],
      env: buildSanitizedGmgnEnv(
        source,
        this.dependencies.homeDir(),
        source.PATH || '',
      ),
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      signal: options.signal,
    };
  }

  private async performDetection(): Promise<CoinGmgnStatus> {
    const checkedAt = this.now();
    let credential: GmgnCredentialInspection;
    try {
      credential = this.inspectCredential();
    } catch {
      credential = { apiKeyConfigured: false, privateKeyDetected: false };
    }
    const executable = this.resolveExecutable();
    this.resolvedExecutable = executable;
    if (!executable) {
      return {
        installed: false,
        version: null,
        displayPath: null,
        ...credential,
        checkedAt,
        lastProbe: this.lastProbe,
      };
    }
    try {
      const result = await this.dependencies.runProcess(
        this.processRequest(executable, VERSION_ARGS, {
          timeoutMs: VERSION_TIMEOUT_MS,
          maxOutputBytes: VERSION_OUTPUT_LIMIT,
        }),
      );
      const version = result.stdout.match(/\b\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?\b/)?.[0] || null;
      return {
        installed: true,
        version,
        displayPath: executable.displayPath,
        ...credential,
        checkedAt,
        lastProbe: this.lastProbe,
        ...(version ? {} : { errorCode: 'detect-failed' as const }),
      };
    } catch {
      return {
        installed: true,
        version: null,
        displayPath: executable.displayPath,
        ...credential,
        checkedAt,
        lastProbe: this.lastProbe,
        errorCode: 'detect-failed',
      };
    }
  }

  private receipt(
    startedAt: number,
    code: CoinGmgnProbeCode,
    recordCount: number | null = null,
  ): CoinGmgnProbeReceipt {
    const receipt: CoinGmgnProbeReceipt = {
      ok: code === 'verified',
      code,
      startedAt,
      completedAt: this.now(),
      summary: code === 'verified' ? 'read-only-response' : 'unavailable',
      recordCount,
    };
    this.lastProbe = receipt;
    return receipt;
  }

  private async performVerification(signal: AbortSignal): Promise<CoinGmgnProbeReceipt> {
    const startedAt = this.now();
    const status = await this.detect();
    if (!status.installed || !this.resolvedExecutable) return this.receipt(startedAt, 'cli-missing');
    if (status.privateKeyDetected) return this.receipt(startedAt, 'private-key-detected');
    if (!status.apiKeyConfigured) return this.receipt(startedAt, 'key-missing');
    try {
      const result = await this.dependencies.runProcess(
        this.processRequest(this.resolvedExecutable, GMGN_READ_ONLY_PROBE_ARGS, {
          timeoutMs: PROBE_TIMEOUT_MS,
          maxOutputBytes: PROBE_OUTPUT_LIMIT,
          signal,
        }),
      );
      const recordCount = parseRecordCount(result.stdout);
      return recordCount === null
        ? this.receipt(startedAt, 'invalid-response')
        : this.receipt(startedAt, 'verified', recordCount);
    } catch (error) {
      const processError =
        error instanceof CoinProcessError
          ? error
          : new CoinProcessError('process-failed', 'GMGN probe failed.');
      return this.receipt(startedAt, classifyProcessFailure(processError));
    }
  }

  private async performRead(
    input: GmgnReadInput,
    args: string[],
    signal?: AbortSignal,
  ): Promise<GmgnReadResult> {
    if (signal?.aborted) throw new GmgnReadError('cancelled');
    if (!this.resolvedExecutable) await this.detect();
    if (!this.resolvedExecutable) throw new GmgnReadError('cli-missing');
    let credential: GmgnCredentialInspection;
    try {
      credential = this.inspectCredential();
    } catch {
      throw new GmgnReadError('key-missing');
    }
    if (credential.privateKeyDetected) throw new GmgnReadError('private-key-detected');
    if (!credential.apiKeyConfigured) throw new GmgnReadError('key-missing');

    const observedAt = this.now();
    this.nextReadAllowedAt = observedAt + READ_START_COOLDOWN_MS;
    try {
      const result = await this.dependencies.runProcess(
        this.processRequest(this.resolvedExecutable, args, {
          timeoutMs: READ_TIMEOUT_MS,
          maxOutputBytes: READ_OUTPUT_LIMIT,
          signal,
        }),
      );
      let data: unknown;
      try {
        data = JSON.parse(result.stdout) as unknown;
      } catch {
        throw new GmgnReadError('invalid-response');
      }
      if (!data || (typeof data !== 'object' && !Array.isArray(data))) {
        throw new GmgnReadError('invalid-response');
      }
      return { operation: input.operation, observedAt, data };
    } catch (error) {
      if (error instanceof GmgnReadError) throw error;
      const processError = error instanceof CoinProcessError
        ? error
        : new CoinProcessError('process-failed', 'GMGN read failed.');
      const code = readFailureCode(processError);
      if (code === 'rate-limited') this.cooldownUntil = this.now() + RATE_LIMIT_COOLDOWN_MS;
      throw new GmgnReadError(code);
    }
  }
}
