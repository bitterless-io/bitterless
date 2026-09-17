import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AUTH_E2E_PRODUCTION_ORIGIN } from '../../src/shared/auth/authE2E.contract';

export const assertProductionAuthBuild = (root: string): void => {
  const markerPath = join(root, 'out/.bitterless-runtime-profile.json');
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  if (
    marker.schemaVersion !== 1 ||
    marker.profileName !== 'debug_prod' ||
    marker.viteEnv !== 'prod' ||
    marker.viteMode !== 'debug' ||
    marker.releaseChannel !== 'prod'
  ) {
    throw new Error(
      'Auth E2E requires a fresh debug_prod build, not the baseline debug_dev build.'
    );
  }
  const built = statSync(markerPath).mtimeMs;
  for (const file of [
    'src/main/app.main.ts',
    'src/preload/home/home.preload.ts',
    'src/renderer/maestro/control/src/ControlAuthApp.vue',
    'src/renderer/home/src/stores/auth/auth.store.ts'
  ]) {
    if (statSync(join(root, file)).mtimeMs > built) throw new Error('Auth E2E build is stale.');
  }
};

export const authLaunchEnvironment = (
  homeDir: string,
  userDataDir: string
): Record<string, string> => {
  const environment: Record<string, string> = {};
  for (const key of [
    'PATH',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'DBUS_SESSION_BUS_ADDRESS',
    'XDG_RUNTIME_DIR',
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATHEXT'
  ]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return {
    ...environment,
    NODE_ENV: 'production',
    VITE_ENV: 'prod',
    VITE_MODE: 'debug',
    VITE_RELEASE_CHANNEL: 'prod',
    VITE_BITTERLESS_CORE_URL: AUTH_E2E_PRODUCTION_ORIGIN,
    BITTERLESS_E2E: '1',
    BITTERLESS_AUTH_E2E: '1',
    BITTERLESS_E2E_HOME_DIR: homeDir,
    BITTERLESS_E2E_USER_DATA_DIR: userDataDir,
    COACH_OPEN_DEVTOOLS: '0',
    COACH_WORKBENCH_DEVTOOLS: '0',
    COACH_DEVTOOLS: '0',
    COACH_DEMO_SMOKE_OUT: '1'
  };
};
