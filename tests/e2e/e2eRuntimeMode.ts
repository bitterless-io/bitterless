import type { ElectronApplication } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const E2E_BUILD_PROFILE_MARKER = 'out/.bitterless-runtime-profile.json';

export const withDebugE2ERuntimeEnvironment = (
  environment: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => ({
  ...environment,
  VITE_ENV: 'dev',
  VITE_MODE: 'debug',
  VITE_RELEASE_CHANNEL: 'dev'
});

export const assertDebugE2EBuild = (projectRoot: string): void => {
  const markerPath = join(projectRoot, E2E_BUILD_PROFILE_MARKER);
  let marker: unknown;
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Bitterless E2E build profile marker is missing or invalid: ${markerPath}. Run yarn build.`,
      { cause: error }
    );
  }
  if (
    typeof marker !== 'object' ||
    marker === null ||
    Array.isArray(marker) ||
    Object.keys(marker).sort().join(',') !==
      'profileName,releaseChannel,schemaVersion,viteEnv,viteMode' ||
    !('schemaVersion' in marker) ||
    marker.schemaVersion !== 1 ||
    !('profileName' in marker) ||
    marker.profileName !== 'debug_dev' ||
    !('releaseChannel' in marker) ||
    marker.releaseChannel !== 'dev' ||
    !('viteEnv' in marker) ||
    marker.viteEnv !== 'dev' ||
    !('viteMode' in marker) ||
    marker.viteMode !== 'debug'
  ) {
    throw new Error(
      `Bitterless E2E requires a fresh debug_dev build marker at ${markerPath}. Run yarn build.`
    );
  }
};

export const assertElectronDebugRuntime = async (
  application: ElectronApplication
): Promise<void> => {
  const runtime = await application.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    processViteMode: process.env.VITE_MODE ?? null
  }));
  if (runtime.packaged || runtime.processViteMode !== 'debug') {
    throw new Error(
      `Bitterless E2E requires unpackaged VITE_MODE=debug; packaged=${runtime.packaged}, process=${runtime.processViteMode ?? 'missing'}`
    );
  }
};
