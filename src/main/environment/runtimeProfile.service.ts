import type {
  ApplicationRuntimeProfile,
  ApplicationReleaseChannel,
  ApplicationViteEnvironment,
  ApplicationViteMode
} from '@shared/diagnostics/applicationDiagnostics.contract';

export interface ResolveRuntimeProfileInput {
  viteEnv: string;
  viteMode: string;
  releaseChannel: string;
}

export interface AssertRuntimeLaunchModeInput {
  compiledViteMode: string;
  helperMode: boolean;
  packaged: boolean;
  processViteMode: string | undefined;
}

const NODE_ONLY_HELPER_ARGUMENTS = new Set([
  '--mcp-helper',
  '--coding-agent-hook-helper',
  '--claude-inventory-watcher'
]);

const isViteEnvironment = (value: string): value is ApplicationViteEnvironment =>
  value === 'dev' || value === 'prod';

const isViteMode = (value: string): value is ApplicationViteMode =>
  value === 'debug' || value === 'release';

const isReleaseChannel = (value: string): value is ApplicationReleaseChannel =>
  value === 'dev' || value === 'prod' || value === 'preview';

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
  if (
    !isViteEnvironment(input.viteEnv) ||
    !isViteMode(input.viteMode) ||
    !isReleaseChannel(input.releaseChannel)
  ) {
    throw new Error(
      `Unsupported Bitterless runtime profile: VITE_MODE=${input.viteMode}, VITE_ENV=${input.viteEnv}, VITE_RELEASE_CHANNEL=${input.releaseChannel}`
    );
  }

  if (input.releaseChannel === 'preview') {
    if (input.viteMode !== 'release' || input.viteEnv !== 'prod') {
      throw new Error('Bitterless Preview requires VITE_MODE=release and VITE_ENV=prod');
    }
    return {
      id: 'production-preview',
      appId: 'io.bitterless.desktop.preview',
      appName: 'Bitterless_PREVIEW',
      releaseChannel: input.releaseChannel,
      viteEnv: input.viteEnv,
      viteMode: input.viteMode
    };
  }

  if (input.releaseChannel !== input.viteEnv) {
    throw new Error('Bitterless non-Preview release channel must match VITE_ENV');
  }

  if (input.viteMode === 'release' && input.viteEnv === 'prod') {
    return {
      id: 'production',
      appId: 'io.bitterless.desktop',
      appName: 'Bitterless',
      releaseChannel: input.releaseChannel,
      viteEnv: input.viteEnv,
      viteMode: input.viteMode
    };
  }
  if (input.viteMode === 'debug' && input.viteEnv === 'prod') {
    return {
      id: 'production-debug',
      appId: 'io.bitterless.desktop',
      appName: 'Bitterless_DEBUG_PROD',
      releaseChannel: input.releaseChannel,
      viteEnv: input.viteEnv,
      viteMode: input.viteMode
    };
  }
  if (input.viteMode === 'debug' && input.viteEnv === 'dev') {
    return {
      id: 'test-debug',
      appId: 'io.bitterless.desktop_dev',
      appName: 'Bitterless_DEBUG_DEV',
      releaseChannel: input.releaseChannel,
      viteEnv: input.viteEnv,
      viteMode: input.viteMode
    };
  }
  return {
    id: 'test-release',
    appId: 'io.bitterless.desktop_dev',
    appName: 'Bitterless_DEV',
    releaseChannel: input.releaseChannel,
    viteEnv: input.viteEnv,
    viteMode: input.viteMode
  };
};
