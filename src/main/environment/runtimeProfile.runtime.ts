import { app } from 'electron';
import { join } from 'node:path';
import type { ApplicationRuntimeProfile } from '@shared/diagnostics/applicationDiagnostics.contract';
import {
  assertRuntimeLaunchMode,
  isNodeOnlyHelperRuntime,
  resolveRuntimeProfile
} from '@main/environment/runtimeProfile.service';

let activeRuntimeProfile: ApplicationRuntimeProfile | null = null;

export const applyRuntimeProfile = (): ApplicationRuntimeProfile => {
  if (activeRuntimeProfile) return activeRuntimeProfile;
  assertRuntimeLaunchMode({
    compiledViteMode: import.meta.env.VITE_MODE,
    helperMode: isNodeOnlyHelperRuntime(process.argv),
    packaged: app.isPackaged,
    processViteMode: process.env.VITE_MODE
  });
  const profile = resolveRuntimeProfile({
    viteEnv: import.meta.env.VITE_ENV,
    viteMode: import.meta.env.VITE_MODE
  });
  const userDataPath = join(app.getPath('appData'), profile.appName);

  app.setName(profile.appName);
  app.setPath('userData', userDataPath);
  app.setPath('sessionData', userDataPath);
  activeRuntimeProfile = profile;
  return profile;
};

export const getRuntimeProfile = (): ApplicationRuntimeProfile => {
  if (!activeRuntimeProfile) {
    throw new Error('Bitterless runtime profile has not been applied.');
  }
  return activeRuntimeProfile;
};
