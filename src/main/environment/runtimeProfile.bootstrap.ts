import { applyRuntimeProfile } from '@main/environment/runtimeProfile.runtime';

// This module must remain the first import in app.main.ts. ESM evaluates this dependency before
// the remaining application modules, so their module-level app.getPath('userData') reads are
// already isolated to the resolved runtime profile.
export const runtimeProfile = applyRuntimeProfile();
