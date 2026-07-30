import { app, webContents } from 'electron';
import type { WebContents, WebContentsConsoleMessageEventParams } from 'electron';
import { dirname } from 'node:path';
import log from 'electron-log/main';
import type { ApplicationRuntimeProfile } from '@shared/diagnostics/applicationDiagnostics.contract';
import {
  APPLICATION_LOG_FILE_MAX_SIZE,
  resolveFirstPartyRendererProcess,
  resolveApplicationLogFile
} from '@main/logging/logPolicy.service';
import {
  formatApplicationLogMessage,
  sanitizeApplicationLogMessage
} from '@main/logging/logSanitizer.service';

const SPY_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const SPY_NAMED_LEVELS: Record<
  WebContentsConsoleMessageEventParams['level'],
  (typeof SPY_LEVELS)[number]
> = {
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  error: 'error'
};

let initializedProfile: ApplicationRuntimeProfile | null = null;

const normalizeConsoleMessage = (
  event: Electron.Event<WebContentsConsoleMessageEventParams>,
  legacyLevel?: number,
  legacyMessage?: string
): { level: (typeof SPY_LEVELS)[number]; message: string } => {
  if (typeof event.message === 'string' && event.message) {
    return {
      level: SPY_NAMED_LEVELS[event.level] ?? 'info',
      message: event.message
    };
  }
  return {
    level: typeof legacyLevel === 'number' ? (SPY_LEVELS[legacyLevel] ?? 'info') : 'info',
    message: typeof legacyMessage === 'string' ? legacyMessage : ''
  };
};

const spyFirstPartyRenderer = (contents: WebContents): void => {
  contents.on('console-message', (event, ...legacy) => {
    const proc = resolveFirstPartyRendererProcess(
      contents.getURL(),
      process.env.ELECTRON_RENDERER_URL
    );
    if (!proc) return;
    const { level, message } = normalizeConsoleMessage(event, legacy[0], legacy[1]);
    if (!message) return;
    log.processMessage({
      data: [message],
      date: new Date(),
      level,
      variables: { proc, world: 'page' }
    });
  });
};

export const initializeApplicationLogging = (profile: ApplicationRuntimeProfile): void => {
  if (initializedProfile) return;
  initializedProfile = profile;

  log.variables.profile = profile.id;
  log.variables.proc = 'main';
  log.variables.world = 'main';
  log.transports.file.format = ({ message }) => formatApplicationLogMessage(message);
  log.transports.file.level = profile.viteMode === 'debug' ? 'debug' : 'info';
  log.transports.file.maxSize = APPLICATION_LOG_FILE_MAX_SIZE;
  log.transports.file.resolvePathFn = (paths) => resolveApplicationLogFile(profile, paths);

  log.hooks.push(sanitizeApplicationLogMessage);
  Object.assign(console, log.functions);
  log.errorHandler.startCatching();
  log.initialize({ preload: true, spyRendererConsole: false });

  for (const contents of webContents.getAllWebContents()) {
    spyFirstPartyRenderer(contents);
  }
  app.on('web-contents-created', (_event, contents) => {
    spyFirstPartyRenderer(contents);
  });

  console.info(`[diagnostics] logging initialized profile=${profile.id} mode=${profile.viteMode}`);
};

export const getApplicationLogPaths = (): {
  file: string;
  directory: string;
} => {
  if (!initializedProfile) {
    throw new Error('Application logging has not been initialized.');
  }
  const file = log.transports.file.getFile().path;
  return {
    file,
    directory: dirname(file)
  };
};
