import type { StartupDiagnosticsSnapshot } from '@shared/startup/startupDiagnostics';

export const APPLICATION_DIAGNOSTICS_SCHEMA = 'application-diagnostics-v1' as const;

export const APPLICATION_RUNTIME_PROFILE_IDS = [
  'production',
  'production-preview',
  'production-debug',
  'test-debug',
  'test-release'
] as const;

export type ApplicationRuntimeProfileId = (typeof APPLICATION_RUNTIME_PROFILE_IDS)[number];
export type ApplicationViteEnvironment = 'dev' | 'prod';
export type ApplicationViteMode = 'debug' | 'release';
export type ApplicationReleaseChannel = 'dev' | 'prod' | 'preview';

export interface ApplicationRuntimeProfile {
  id: ApplicationRuntimeProfileId;
  appId: 'io.bitterless.desktop' | 'io.bitterless.desktop.preview' | 'io.bitterless.desktop_dev';
  appName:
    | 'Bitterless'
    | 'Bitterless_PREVIEW'
    | 'Bitterless_DEBUG_PROD'
    | 'Bitterless_DEBUG_DEV'
    | 'Bitterless_DEV';
  releaseChannel: ApplicationReleaseChannel;
  viteEnv: ApplicationViteEnvironment;
  viteMode: ApplicationViteMode;
}

export const APPLICATION_DIAGNOSTIC_DIRECTORY_KEYS = [
  'app',
  'userData',
  'sessionData',
  'logs',
  'cache',
  'crashDumps',
  'temp',
  'home',
  'documents',
  'downloads',
  'db',
  'skills',
  'plugins',
  'rigchat',
  'cowork',
  'codexAuth',
  'coin',
  'todoistSync',
  'eyesOnAgents',
  'mcp',
  'bin',
  'artifacts'
] as const;

export type ApplicationDiagnosticDirectoryKey =
  (typeof APPLICATION_DIAGNOSTIC_DIRECTORY_KEYS)[number];

export const APPLICATION_DIAGNOSTIC_ENVIRONMENT_KEYS = [
  'VITE_ENV',
  'VITE_MODE',
  'VITE_RELEASE_CHANNEL',
  'VITE_BITTERLESS_CORE_URL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'BITTERLESS_E2E',
  'BITTERLESS_E2E_HOME_DIR',
  'BITTERLESS_E2E_MOCK_ORIGIN',
  'BITTERLESS_E2E_USER_DATA_DIR',
  'BITTERLESS_KEYCHAIN_DIR',
  'BITTERLESS_SIGNING_ENV',
  'APPLE_ID',
  'APPLE_TEAM_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'CDN_API_ENDPOINT',
  'COACH_AI_CRMS_CORE_BASE_URL',
  'COACH_AI_CRMS_MEDIA_UPLOAD_URL',
  'COACH_AI_CRMS_RELAY_BASE_URL',
  'COACH_MEDIA_UPLOAD_URL',
  'MICROMEET_CLI_PATH',
  'MICROMEET_CRMS_CREDENTIAL_FILE'
] as const;

export type ApplicationDiagnosticEnvironmentKey =
  (typeof APPLICATION_DIAGNOSTIC_ENVIRONMENT_KEYS)[number];

export interface ApplicationDiagnosticDirectoryEntry {
  key: ApplicationDiagnosticDirectoryKey;
  path: string;
  exists: boolean;
}

export interface ApplicationDiagnosticEnvironmentEntry {
  key: ApplicationDiagnosticEnvironmentKey;
  configured: boolean;
  safeValue?: string;
}

export interface ApplicationDiagnosticsSnapshot {
  schema: typeof APPLICATION_DIAGNOSTICS_SCHEMA;
  observedAt: number;
  runtime: {
    profile: ApplicationRuntimeProfileId;
    appId: ApplicationRuntimeProfile['appId'];
    appName: ApplicationRuntimeProfile['appName'];
    releaseChannel: ApplicationReleaseChannel;
    viteEnv: ApplicationViteEnvironment;
    viteMode: ApplicationViteMode;
    packaged: boolean;
    platform: string;
    architecture: string;
    version: string;
    versionCode: string;
  };
  log: {
    file: string;
    directory: string;
    exists: boolean;
  };
  startup: StartupDiagnosticsSnapshot;
  directories: ApplicationDiagnosticDirectoryEntry[];
  environment: ApplicationDiagnosticEnvironmentEntry[];
}

export type ApplicationDiagnosticsOpenDirectoryResult =
  | { ok: true }
  | {
      ok: false;
      error: 'directory-not-created' | 'open-failed' | 'unknown-directory';
    };

export interface ApplicationDiagnosticsApi {
  getSnapshot(): Promise<ApplicationDiagnosticsSnapshot>;
  revealLogFile(): Promise<ApplicationDiagnosticsOpenDirectoryResult>;
  openDirectory(params: {
    key: ApplicationDiagnosticDirectoryKey;
  }): Promise<ApplicationDiagnosticsOpenDirectoryResult>;
}

export const parseApplicationDiagnosticDirectoryKey = (
  value: unknown
): ApplicationDiagnosticDirectoryKey | null =>
  typeof value === 'string' &&
  (APPLICATION_DIAGNOSTIC_DIRECTORY_KEYS as readonly string[]).includes(value)
    ? (value as ApplicationDiagnosticDirectoryKey)
    : null;
