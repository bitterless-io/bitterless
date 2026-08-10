import type {
  ApplicationRuntimeProfile,
  ApplicationViteEnvironment,
  ApplicationViteMode
} from '@shared/diagnostics/applicationDiagnostics.contract';

export interface ResolveRuntimeProfileInput {
  viteEnv: string;
  viteMode: string;
}

export interface AssertRuntimeLaunchModeInput {
  compiledViteMode: string;
  helperMode: boolean;
  packaged: boolean;
  processViteMode: string | undefined;
}

const NODE_ONLY_HELPER_ARGUMENTS = new Set([
  '--mcp-helper',
  '--coding-agent-hook-helper'
]);

const isViteEnvironment = (value: string): value is ApplicationViteEnvironment =>
  value === 'dev' || value === 'prod';

const isViteMode = (value: string): value is ApplicationViteMode =>
  value === 'debug' || value === 'release';

export const isNodeOnlyHelperRuntime = (argv: readonly string[]): boolean =>
  argv.some((argument) => NODE_ONLY_HELPER_ARGUMENTS.has(argument));

export const assertRuntimeLaunchMode = (input: AssertRuntimeLaunchModeInput): void => {
  if (input.helperMode) return;
  if (input.packaged) {
    if (input.compiledViteMode !== 'release') {
      throw new Error(
        `[runtime-profile] packaged Bitterless requires compiled VITE_MODE=release; received ${input.compiledViteMode || 'missing'}`
      );
    }
    return;
  }
  if (input.compiledViteMode !== 'debug') {
    throw new Error(
      `[runtime-profile] unpackaged Bitterless requires compiled VITE_MODE=debug; received ${input.compiledViteMode || 'missing'}`
    );
  }
  if (input.processViteMode !== 'debug') {
    throw new Error(
      `[runtime-profile] unpackaged Bitterless requires child-process VITE_MODE=debug; received ${input.processViteMode || 'missing'}`
    );
  }
};

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
