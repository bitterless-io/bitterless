import { app, shell } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  APPLICATION_DIAGNOSTICS_SCHEMA,
  parseApplicationDiagnosticDirectoryKey,
  type ApplicationDiagnosticDirectoryEntry,
  type ApplicationDiagnosticDirectoryKey,
  type ApplicationDiagnosticsOpenDirectoryResult,
  type ApplicationDiagnosticsSnapshot
} from '@shared/diagnostics/applicationDiagnostics.contract';
import { sanitizeDiagnostic } from '@shared/diagnostics/diagnostic.service';
import { codexAuthPath } from '@main/codex/codexPaths';
import { getRuntimeProfile } from '@main/environment/runtimeProfile.runtime';
import { getApplicationLogPaths } from '@main/logging/log.setup';
import { startupDiagnosticsService } from '@main/startup/startupDiagnostics.service';
import { packageMainHelper } from '@shared/packageHelper/main/package.helper';
import { buildDiagnosticEnvironmentStatus } from './diagnosticEnvironment.service';

const directoryEntry = (
  key: ApplicationDiagnosticDirectoryKey,
  path: string
): ApplicationDiagnosticDirectoryEntry => ({
  key,
  path,
  exists: existsSync(path)
});

const environmentSource = (): Record<string, string | undefined> => ({
  ...process.env,
  VITE_ENV: import.meta.env.VITE_ENV,
  VITE_MODE: import.meta.env.VITE_MODE,
  VITE_BITTERLESS_CORE_URL: import.meta.env.VITE_BITTERLESS_CORE_URL
});

const getDirectoryCatalog = (): ApplicationDiagnosticDirectoryEntry[] => {
  const userData = app.getPath('userData');
  const log = getApplicationLogPaths();
  return [
    directoryEntry('app', app.getAppPath()),
    directoryEntry('userData', userData),
    directoryEntry('sessionData', app.getPath('sessionData')),
    directoryEntry('logs', log.directory),
    directoryEntry('cache', app.getPath('cache')),
    directoryEntry('crashDumps', app.getPath('crashDumps')),
    directoryEntry('temp', app.getPath('temp')),
    directoryEntry('home', app.getPath('home')),
    directoryEntry('documents', app.getPath('documents')),
    directoryEntry('downloads', app.getPath('downloads')),
    directoryEntry('db', join(userData, 'db')),
    directoryEntry('skills', join(userData, 'skills')),
    directoryEntry('plugins', join(userData, 'plugins')),
    directoryEntry('rigchat', join(userData, 'rigchat')),
    directoryEntry('cowork', join(userData, 'cowork')),
    directoryEntry('codexAuth', dirname(codexAuthPath(userData))),
    directoryEntry('coin', join(userData, 'coin')),
    directoryEntry('todoistSync', join(userData, 'todoist-sync')),
    directoryEntry('eyesOnAgents', join(userData, 'eyes-on-agents')),
    directoryEntry('mcp', join(userData, 'mcp')),
    directoryEntry('bin', join(userData, 'bin')),
    directoryEntry('artifacts', join(userData, 'artifacts'))
  ];
};

class ApplicationDiagnosticsService {
  async getSnapshot(): Promise<ApplicationDiagnosticsSnapshot> {
    const profile = getRuntimeProfile();
    const log = getApplicationLogPaths();
    const packageInfo = await packageMainHelper.getPackageInfo();
    const startup = startupDiagnosticsService.getSnapshot();
    return {
      schema: APPLICATION_DIAGNOSTICS_SCHEMA,
      observedAt: Date.now(),
      runtime: {
        profile: profile.id,
        appName: profile.appName,
        viteEnv: profile.viteEnv,
        viteMode: profile.viteMode,
        packaged: app.isPackaged,
        platform: process.platform,
        architecture: process.arch,
        version: packageInfo.version,
        versionCode: packageInfo.versionCode
      },
      log: {
        ...log,
        exists: existsSync(log.file)
      },
      startup: {
        revision: startup.revision,
        issues: startup.issues.map((issue) => ({
          stage: issue.stage,
          message: sanitizeDiagnostic(issue.message)
        }))
      },
      directories: getDirectoryCatalog(),
      environment: buildDiagnosticEnvironmentStatus(environmentSource())
    };
  }

  async openDirectory(params: {
    key?: unknown;
  }): Promise<ApplicationDiagnosticsOpenDirectoryResult> {
    const key = parseApplicationDiagnosticDirectoryKey(params?.key);
    if (!key) return { ok: false, error: 'unknown-directory' };
    const entry = getDirectoryCatalog().find((candidate) => candidate.key === key);
    if (!entry) return { ok: false, error: 'unknown-directory' };
    if (!entry.exists) return { ok: false, error: 'directory-not-created' };

    const error = await shell.openPath(entry.path);
    if (!error) return { ok: true };
    console.error(
      `[diagnostics] open directory failed key=${key} error=${sanitizeDiagnostic(error)}`
    );
    return { ok: false, error: 'open-failed' };
  }

  async revealLogFile(): Promise<ApplicationDiagnosticsOpenDirectoryResult> {
    const log = getApplicationLogPaths();
    if (!existsSync(log.file)) {
      return { ok: false, error: 'directory-not-created' };
    }
    shell.showItemInFolder(log.file);
    return { ok: true };
  }
}

export const applicationDiagnosticsService = new ApplicationDiagnosticsService();
