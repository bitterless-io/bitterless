import log from 'electron-log/main';
import type { ApplicationRuntimeProfile } from '@shared/diagnostics/applicationDiagnostics.contract';
import { sanitizeDiagnostic } from '@shared/diagnostics/diagnostic.service';
import type {
  CodexRuntimeDiagnosticEvidence,
  CodexRuntimeDiagnosticSummary
} from '@main/codex/codexRuntime.service';
import {
  APPLICATION_LOG_FILE_MAX_SIZE,
  resolveTranslatorLogFile
} from '@main/logging/logPolicy.service';
import {
  formatApplicationLogMessage,
  sanitizeApplicationLogMessage
} from '@main/logging/logSanitizer.service';

export type TranslatorLogLevel = 'info' | 'warn' | 'error';
export type TranslatorLogPhase = 'completed' | 'started';
export type TranslatorLogStage =
  | 'accepted'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'output-validation'
  | 'pi-load'
  | 'prompt'
  | 'provider-auth-observe'
  | 'provider-context'
  | 'provider-observation'
  | 'runtime'
  | 'session-create'
  | 'target-context'
  | 'timeout'
  | 'unknown';

export interface TranslatorLogPosition {
  stage: TranslatorLogStage;
  phase?: TranslatorLogPhase;
}

export interface TranslatorLogEntry {
  level: TranslatorLogLevel;
  attempt: number;
  stage: TranslatorLogStage;
  phase?: TranslatorLogPhase;
  lastStage?: TranslatorLogStage;
  lastPhase?: TranslatorLogPhase;
  elapsedMs: number;
  sourceCodePoints?: number;
  errorCode?: string;
  cause?: string;
  diagnostic?: CodexRuntimeDiagnosticSummary;
}

export interface TranslatorLogger {
  write(entry: TranslatorLogEntry): void;
}

export interface TranslatorLogServiceDependencies {
  getProfile(): ApplicationRuntimeProfile;
}

const safeToken = (value: string, maxLength = 96): string =>
  value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, maxLength);

const diagnosticLogData = (
  role: 'terminal' | 'transport',
  diagnostic: CodexRuntimeDiagnosticEvidence
): string[] => {
  const fields = [`category=${safeToken(diagnostic.category, 23)}`];
  if (diagnostic.configuredTransport) {
    fields.push(`transport=${safeToken(diagnostic.configuredTransport, 23)}`);
  }
  if (diagnostic.fallbackTransport) {
    fields.push(`fallback=${safeToken(diagnostic.fallbackTransport, 23)}`);
  }
  if (diagnostic.providerPhase) {
    fields.push(`providerPhase=${safeToken(diagnostic.providerPhase, 23)}`);
  }
  if (diagnostic.httpStatus) fields.push(`httpStatus=${Math.trunc(diagnostic.httpStatus)}`);
  if (diagnostic.errorName) fields.push(`errorName=${safeToken(diagnostic.errorName, 23)}`);
  if (diagnostic.errorCode) fields.push(`errorCode=${safeToken(diagnostic.errorCode, 23)}`);
  const detail = diagnostic.detail ? sanitizeDiagnostic(diagnostic.detail, 160) : '';
  return [
    `[provider-${role}] ${fields.join(' ')}`,
    ...(detail ? [`[provider-${role}-detail] ${detail}`] : [])
  ];
};

const STAGE_NAMES = new Set<TranslatorLogStage>([
  'accepted',
  'cancelled',
  'completed',
  'failed',
  'output-validation',
  'pi-load',
  'prompt',
  'provider-auth-observe',
  'provider-context',
  'provider-observation',
  'runtime',
  'session-create',
  'target-context',
  'timeout',
  'unknown'
]);

export const resolveTranslatorLogPosition = (value: string): TranslatorLogPosition => {
  const phase = value.endsWith('-started')
    ? 'started'
    : value.endsWith('-completed')
      ? 'completed'
      : undefined;
  const base = phase ? value.slice(0, -(`-${phase}`.length)) : value;
  const stage = base === 'provider-auth-observation' ? 'provider-auth-observe' : base;
  return {
    stage: STAGE_NAMES.has(stage as TranslatorLogStage)
      ? (stage as TranslatorLogStage)
      : 'unknown',
    ...(phase ? { phase } : {})
  };
};

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
      if (entry.phase) fields.push(`phase=${safeToken(entry.phase)}`);
      if (entry.lastStage) fields.push(`lastStage=${safeToken(entry.lastStage)}`);
      if (entry.lastPhase) fields.push(`lastPhase=${safeToken(entry.lastPhase)}`);
      if (entry.sourceCodePoints !== undefined) {
        fields.push(`sourceCodePoints=${Math.max(0, Math.trunc(entry.sourceCodePoints))}`);
      }
      if (entry.errorCode) fields.push(`errorCode=${safeToken(entry.errorCode)}`);
      if (entry.cause) fields.push(`cause=${safeToken(entry.cause, 23)}`);
      const diagnosticData = [
        ...(entry.diagnostic?.transportDiagnostic
          ? diagnosticLogData('transport', entry.diagnostic.transportDiagnostic)
          : []),
        ...(entry.diagnostic?.terminalDiagnostic
          ? diagnosticLogData('terminal', entry.diagnostic.terminalDiagnostic)
          : [])
      ];
      this.getLogger().processMessage({
        data: [`[translator] ${fields.join(' ')}`, ...diagnosticData],
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
