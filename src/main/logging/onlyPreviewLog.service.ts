import log from 'electron-log/main';
import type { ApplicationRuntimeProfile } from '@shared/diagnostics/applicationDiagnostics.contract';
import {
  APPLICATION_LOG_FILE_MAX_SIZE,
  resolveOnlyPreviewLogFile
} from '@main/logging/logPolicy.service';
import {
  formatApplicationLogMessage,
  sanitizeApplicationLogMessage
} from '@main/logging/logSanitizer.service';
import {
  formatOnlyPreviewFailureLine,
  type OnlyPreviewLogFailure
} from '@main/logging/onlyPreviewLogRecord.service';

export interface OnlyPreviewLogServiceDependencies {
  getProfile(): ApplicationRuntimeProfile;
  mirror?(line: string): void;
}

export class OnlyPreviewLogService {
  private onlyPreviewLog: ReturnType<typeof log.create> | null = null;

  constructor(private readonly dependencies: OnlyPreviewLogServiceDependencies) {}

  writeOperationFailure(failure: OnlyPreviewLogFailure): void {
    try {
      const line = formatOnlyPreviewFailureLine(failure);
      const profile = this.dependencies.getProfile();
      this.getLogger().processMessage({
        data: [line],
        date: new Date(),
        level: 'error',
        variables: {
          profile: profile.id,
          channel: profile.releaseChannel,
          proc: 'onlypreview',
          world: 'main'
        }
      });
      this.mirror(line);
    } catch {
      // Diagnostics are best effort and must never change an OnlyPreview result.
    }
  }

  writeDiagnosticLine(line: string): void {
    try {
      if (!line.startsWith('[onlypreview-open] ')) return;
      const profile = this.dependencies.getProfile();
      this.getLogger().processMessage({
        data: [line],
        date: new Date(),
        level: 'info',
        variables: {
          profile: profile.id,
          channel: profile.releaseChannel,
          proc: 'onlypreview',
          world: 'main'
        }
      });
    } catch {
      // Open diagnostics are best effort and never participate in the operation result.
    }
  }

  // The dedicated file carries the detail; one mirrored line keeps the failure visible in main.log,
  // where triage starts.
  private mirror(line: string): void {
    try {
      (this.dependencies.mirror ?? ((value: string) => console.error(value)))(line);
    } catch {
      // The dedicated file already holds the record.
    }
  }

  private getLogger(): ReturnType<typeof log.create> {
    if (this.onlyPreviewLog) return this.onlyPreviewLog;
    const profile = this.dependencies.getProfile();
    const onlyPreviewLog = log.create({ logId: 'onlypreview' });
    onlyPreviewLog.variables.profile = profile.id;
    onlyPreviewLog.variables.channel = profile.releaseChannel;
    onlyPreviewLog.variables.proc = 'onlypreview';
    onlyPreviewLog.variables.world = 'main';
    onlyPreviewLog.transports.console.level = false;
    if (onlyPreviewLog.transports.ipc) onlyPreviewLog.transports.ipc.level = false;
    onlyPreviewLog.transports.remote.level = false;
    onlyPreviewLog.transports.file.format = ({ message }) => formatApplicationLogMessage(message);
    onlyPreviewLog.transports.file.level = profile.viteMode === 'debug' ? 'debug' : 'info';
    onlyPreviewLog.transports.file.maxSize = APPLICATION_LOG_FILE_MAX_SIZE;
    onlyPreviewLog.transports.file.resolvePathFn = (paths) =>
      resolveOnlyPreviewLogFile(profile, paths);
    onlyPreviewLog.hooks.push(sanitizeApplicationLogMessage);
    this.onlyPreviewLog = onlyPreviewLog;
    return onlyPreviewLog;
  }
}
