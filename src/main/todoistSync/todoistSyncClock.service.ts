import dgram from 'dgram';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import type {
  TodoistSyncClockCheckResult,
  TodoistSyncClockState,
} from '@shared/todoistSync/todoistSync.type';
import { TODOIST_SYNC_MAX_FUTURE_MS } from '@shared/todoistSync/todoistSync.contract';

const NTP_UNIX_EPOCH_SECONDS = 2_208_988_800;
const NTP_PORT = 123;
const NTP_TIMEOUT_MS = 3_000;
export const TODOIST_SYNC_NTP_SOURCES = ['ntp.aliyun.com', 'time.cloudflare.com'] as const;

export interface TodoistSyncTimeSample {
  source: string;
  local_time_ms: number;
  trusted_time_ms: number;
  offset_ms: number;
  round_trip_ms: number;
}

export type TodoistSyncTimeQuery = (source: string) => Promise<TodoistSyncTimeSample>;

const readNtpTimestamp = (message: Buffer, offset: number): number => {
  const seconds = message.readUInt32BE(offset) - NTP_UNIX_EPOCH_SECONDS;
  const fraction = message.readUInt32BE(offset + 4) / 2 ** 32;
  return Math.round((seconds + fraction) * 1000);
};

const writeNtpTimestamp = (message: Buffer, offset: number, unixMs: number): void => {
  const seconds = Math.floor(unixMs / 1000) + NTP_UNIX_EPOCH_SECONDS;
  const fraction = Math.floor(((unixMs % 1000) / 1000) * 2 ** 32);
  message.writeUInt32BE(seconds >>> 0, offset);
  message.writeUInt32BE(fraction >>> 0, offset + 4);
};

export const querySntpSource: TodoistSyncTimeQuery = async (source) => {
  return await new Promise<TodoistSyncTimeSample>((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const request = Buffer.alloc(48);
    request[0] = 0x23;
    const sentAt = Date.now();
    writeNtpTimestamp(request, 40, sentAt);
    let settled = false;
    const settle = (runner: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      runner();
    };
    const timer = setTimeout(() => settle(() => reject(new Error(`NTP timeout: ${source}`))), NTP_TIMEOUT_MS);
    socket.once('error', (error) => settle(() => reject(error)));
    socket.once('message', (message) => {
      const receivedAt = Date.now();
      settle(() => {
        if (message.length < 48) return reject(new Error(`NTP response is too short: ${source}`));
        const serverReceivedAt = readNtpTimestamp(message, 32);
        const serverSentAt = readNtpTimestamp(message, 40);
        const offset = Math.round(((serverReceivedAt - sentAt) + (serverSentAt - receivedAt)) / 2);
        const local = Math.round((sentAt + receivedAt) / 2);
        resolve({ source, local_time_ms: local, trusted_time_ms: local + offset, offset_ms: offset, round_trip_ms: receivedAt - sentAt });
      });
    });
    socket.send(request, NTP_PORT, source, (error) => {
      if (error) settle(() => reject(error));
    });
  });
};

export class TodoistSyncClockStateStore {
  readonly path: string;

  constructor(userDataPath: string) {
    this.path = join(userDataPath, 'todoist-sync', 'clock-state.json');
  }

  read(): TodoistSyncClockState | null {
    if (!existsSync(this.path)) return null;
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8')) as TodoistSyncClockState;
      if (
        (value.status !== 'healthy' && value.status !== 'clock_wrong') ||
        !Number.isSafeInteger(value.local_time_ms) ||
        !Number.isSafeInteger(value.trusted_time_ms) ||
        !Number.isSafeInteger(value.offset_ms) ||
        !Number.isSafeInteger(value.last_success_at) ||
        !Number.isSafeInteger(value.check_generation)
      ) return null;
      return value;
    } catch {
      return null;
    }
  }

  write(state: TodoistSyncClockState): void {
    const directory = dirname(this.path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.clock-state-${process.pid}-${state.check_generation}.tmp`);
    writeFileSync(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
    const file = openSync(temporary, 'r');
    try {
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    renameSync(temporary, this.path);
    const folder = openSync(directory, 'r');
    try {
      fsyncSync(folder);
    } finally {
      closeSync(folder);
    }
  }
}

export class TodoistSyncClockService {
  private state: TodoistSyncClockState | null;
  private checkGeneration: number;

  constructor(
    private readonly store: TodoistSyncClockStateStore,
    private readonly query: TodoistSyncTimeQuery = querySntpSource,
  ) {
    this.state = store.read();
    this.checkGeneration = this.state?.check_generation ?? 0;
  }

  getState(): TodoistSyncClockState | null {
    return this.state ? { ...this.state } : null;
  }

  isWrong(): boolean {
    return this.state?.status === 'clock_wrong';
  }

  async check(acceptResult: (checkGeneration: number) => boolean): Promise<TodoistSyncClockCheckResult> {
    const generation = ++this.checkGeneration;
    const results = await Promise.allSettled(TODOIST_SYNC_NTP_SOURCES.map((source) => this.query(source)));
    const samples = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    if (generation !== this.checkGeneration || !acceptResult(generation)) return { status: 'stale', clock_state: this.getState() };
    if (samples.length === 0) {
      return { status: 'unreachable', clock_state: this.getState() };
    }
    samples.sort((left, right) => left.source.localeCompare(right.source));
    const local = Math.round(samples.reduce((total, sample) => total + sample.local_time_ms, 0) / samples.length);
    const offset = Math.round(samples.reduce((total, sample) => total + sample.offset_ms, 0) / samples.length);
    const status = Math.abs(offset) > TODOIST_SYNC_MAX_FUTURE_MS ? 'clock_wrong' as const : 'healthy' as const;
    const state: TodoistSyncClockState = {
      status,
      local_time_ms: local,
      trusted_time_ms: local + offset,
      offset_ms: offset,
      last_success_at: Date.now(),
      check_generation: generation,
    };
    if (generation !== this.checkGeneration || !acceptResult(generation)) return { status: 'stale', clock_state: this.getState() };
    this.store.write(state);
    this.state = state;
    return { status, clock_state: { ...state } };
  }
}
