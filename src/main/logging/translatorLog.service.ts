import log from 'electron-log/main';
import type { ApplicationRuntimeProfile } from '@shared/diagnostics/applicationDiagnostics.contract';
import {
  APPLICATION_LOG_FILE_MAX_SIZE,
  resolveTranslatorLogFile
} from '@main/logging/logPolicy.service';
import {
  formatApplicationLogMessage,
  sanitizeApplicationLogMessage
} from '@main/logging/logSanitizer.service';

export type TranslatorLogLevel = 'info' | 'warn' | 'error';

export interface TranslatorLogEntry {
  level: TranslatorLogLevel;
  attempt: number;
  stage: string;
  elapsedMs: number;
  sourceCodePoints?: number;
  errorCode?: string;
  cause?: string;
}

export interface TranslatorLogger {
  write(entry: TranslatorLogEntry): void;
}

export interface TranslatorLogServiceDependencies {
  getProfile(): ApplicationRuntimeProfile;
}

const safeToken = (value: string, maxLength = 96): string =>
  value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, maxLength);

export class TranslatorLogService implements TranslatorLogger {
  private translatorLog: ReturnType<typeof log.create> | null = null;

  constructor(private readonly dependencies: TranslatorLogServiceDependencies) {}

  write(entry: TranslatorLogEntry): void {
    try {
      const fields = [
        `attempt=${Math.max(0, Math.trunc(entry.attempt))}`,
        `stage=${safeToken(entry.stage)}`,
        `elapsedMs=${Math.max(0, Math.trunc(entry.elapsedMs))}`
      ];
      if (entry.sourceCodePoints !== undefined) {
        fields.push(`sourceCodePoints=${Math.max(0, Math.trunc(entry.sourceCodePoints))}`);
      }
      if (entry.errorCode) fields.push(`errorCode=${safeToken(entry.errorCode)}`);
      if (entry.cause) fields.push(`cause=${safeToken(entry.cause, 180)}`);
      this.getLogger().processMessage({
        data: [`[translator] ${fields.join(' ')}`],
        date: new Date(),
        level: entry.level,
        variables: {
          profile: this.dependencies.getProfile().id,
          proc: 'translator',
          world: 'main'
        }
      });
    } catch {
      // Diagnostics are best effort and must never change translation behavior.
    }
  }

  private getLogger(): ReturnType<typeof log.create> {
    if (this.translatorLog) return this.translatorLog;
    const profile = this.dependencies.getProfile();
    const translatorLog = log.create({ logId: 'translator' });
    translatorLog.variables.profile = profile.id;
    translatorLog.variables.proc = 'translator';
    translatorLog.variables.world = 'main';
    translatorLog.transports.console.level = false;
    if (translatorLog.transports.ipc) translatorLog.transports.ipc.level = false;
    translatorLog.transports.remote.level = false;
    translatorLog.transports.file.format = ({ message }) => formatApplicationLogMessage(message);
    translatorLog.transports.file.level = profile.viteMode === 'debug' ? 'debug' : 'info';
    translatorLog.transports.file.maxSize = APPLICATION_LOG_FILE_MAX_SIZE;
    translatorLog.transports.file.resolvePathFn = (paths) =>
      resolveTranslatorLogFile(profile, paths);
    translatorLog.hooks.push(sanitizeApplicationLogMessage);
    this.translatorLog = translatorLog;
    return translatorLog;
  }
}
