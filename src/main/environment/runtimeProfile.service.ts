import type {
  ApplicationRuntimeProfile,
  ApplicationViteEnvironment,
  ApplicationViteMode
} from '@shared/diagnostics/applicationDiagnostics.contract';

export interface ResolveRuntimeProfileInput {
  viteEnv: string;
  viteMode: string;
}

const isViteEnvironment = (value: string): value is ApplicationViteEnvironment =>
  value === 'dev' || value === 'prod';

const isViteMode = (value: string): value is ApplicationViteMode =>
  value === 'debug' || value === 'release';

export const resolveRuntimeProfile = (
  input: ResolveRuntimeProfileInput
): ApplicationRuntimeProfile => {
  if (!isViteEnvironment(input.viteEnv) || !isViteMode(input.viteMode)) {
    throw new Error(
      `Unsupported Bitterless runtime profile: VITE_MODE=${input.viteMode}, VITE_ENV=${input.viteEnv}`
    );
  }

  if (input.viteMode === 'release' && input.viteEnv === 'prod') {
    return {
      id: 'production',
      appName: 'Bitterless',
      viteEnv: input.viteEnv,
      viteMode: input.viteMode
    };
  }
  if (input.viteMode === 'debug' && input.viteEnv === 'prod') {
    return {
      id: 'production-debug',
      appName: 'Bitterless_DEBUG_PROD',
      viteEnv: input.viteEnv,
      viteMode: input.viteMode
    };
  }
  if (input.viteMode === 'debug' && input.viteEnv === 'dev') {
    return {
      id: 'test-debug',
      appName: 'Bitterless_DEBUG_DEV',
      viteEnv: input.viteEnv,
      viteMode: input.viteMode
    };
  }
  return {
    id: 'test-release',
    appName: 'Bitterless_DEV',
    viteEnv: input.viteEnv,
    viteMode: input.viteMode
  };
};
