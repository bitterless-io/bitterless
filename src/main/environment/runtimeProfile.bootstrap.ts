import { applyRuntimeProfile } from '@main/environment/runtimeProfile.runtime';
import { app } from 'electron';

// This module must remain the first import in app.main.ts. ESM evaluates this dependency before
// the remaining application modules, so their module-level app.getPath('userData') reads are
// already isolated to the resolved runtime profile.
const terminateInvalidRuntimeProfile = (error: unknown): never => {
  const runtimeError = error instanceof Error ? error : new Error(String(error));
  console.error(runtimeError.message);
  app.exit(1);
  throw runtimeError;
};

export const runtimeProfile = (() => {
  try {
    return applyRuntimeProfile();
  } catch (error) {
    return terminateInvalidRuntimeProfile(error);
  }
})();
