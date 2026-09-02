/* eslint-disable @typescript-eslint/no-require-imports */
const { resolve } = require('node:path');
const { assertSelectedRuntimeProfile } = require('./runtimeProfile.config.cjs');

const expectedMode = process.argv[2];
try {
  const selected = assertSelectedRuntimeProfile(resolve(__dirname, '..', '..'), expectedMode);
  console.log(
    `[runtime-profile] ${selected.profileName}: VITE_MODE=${selected.viteMode}, VITE_ENV=${selected.viteEnv}, VITE_RELEASE_CHANNEL=${selected.releaseChannel}`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
