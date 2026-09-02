import { join } from 'node:path';

export type MicromeetCliReleaseChannel = 'dev' | 'prod' | 'preview';

export interface ResolveMicromeetCliPathsInput {
  releaseChannel: MicromeetCliReleaseChannel;
  appUserDataPath: string;
  homeDirectory?: string;
  platform: NodeJS.Platform;
}

export interface MicromeetCliPaths {
  rootDir: string;
  binDir: string;
  shimFile: string;
  credentialDir: string;
  crmsCredentialFile: string;
  sysCredentialFile: string;
  credentialKeyFile: string;
  legacySessionFile: string;
  previewIsolated: boolean;
}

export interface MicromeetCliEnvironment {
  MICROMEET_CLI_PATH?: string;
  MICROMEET_CREDENTIAL_FILE?: string;
  MICROMEET_CRMS_CREDENTIAL_FILE: string;
  MICROMEET_SYS_CREDENTIAL_FILE: string;
  MICROMEET_SESSION_FILE: string;
}

export interface ResolveMicromeetCliExecutablePathInput {
  paths: MicromeetCliPaths;
  inheritedCliPath?: string;
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
  platform: NodeJS.Platform;
}

const requirePath = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`${name} is required to resolve Micromeet CLI paths`);
  return value;
};

export const resolveMicromeetCliPaths = (
  input: ResolveMicromeetCliPathsInput
): MicromeetCliPaths => {
  const previewIsolated = input.releaseChannel === 'preview';
  const rootDir = previewIsolated
    ? join(requirePath(input.appUserDataPath, 'appUserDataPath'), 'cowork', 'cli')
    : join(requirePath(input.homeDirectory, 'homeDirectory'), '.micromeet');
  const binDir = join(rootDir, 'bin');
  const credentialDir = join(rootDir, 'credentials');

  return {
    rootDir,
    binDir,
    shimFile: join(binDir, input.platform === 'win32' ? 'micromeet.cmd' : 'micromeet'),
    credentialDir,
    crmsCredentialFile: join(credentialDir, 'crms.json'),
    sysCredentialFile: join(credentialDir, 'sys.json'),
    credentialKeyFile: join(credentialDir, '.credential-key-v2'),
    legacySessionFile: join(rootDir, 'session.json'),
    previewIsolated
  };
};

export const resolveMicromeetCliExecutablePath = (
  input: ResolveMicromeetCliExecutablePathInput
): string => {
  const inheritedCliPath = input.inheritedCliPath?.trim();
  if (!input.paths.previewIsolated && inheritedCliPath) return inheritedCliPath;
  const fileName = input.platform === 'win32' ? 'micromeet.exe' : 'micromeet';
  return input.packaged
    ? join(input.resourcesPath, 'maestro-tools', fileName)
    : join(input.appPath, 'build', 'maestro-tools', fileName);
};

export const resolveMicromeetCliEnvironment = (
  paths: MicromeetCliPaths,
  inheritedEnvironment: Readonly<Record<string, string | undefined>>,
  resolvedCliPath: string
): MicromeetCliEnvironment => {
  if (paths.previewIsolated) {
    return {
      MICROMEET_CLI_PATH: resolvedCliPath,
      MICROMEET_CREDENTIAL_FILE: paths.crmsCredentialFile,
      MICROMEET_CRMS_CREDENTIAL_FILE: paths.crmsCredentialFile,
      MICROMEET_SYS_CREDENTIAL_FILE: paths.sysCredentialFile,
      MICROMEET_SESSION_FILE: paths.legacySessionFile
    };
  }

  const genericCredentialFile = inheritedEnvironment.MICROMEET_CREDENTIAL_FILE;
  const inheritedCliPath = inheritedEnvironment.MICROMEET_CLI_PATH?.trim();
  return {
    ...(inheritedCliPath ? { MICROMEET_CLI_PATH: inheritedCliPath } : {}),
    ...(genericCredentialFile ? { MICROMEET_CREDENTIAL_FILE: genericCredentialFile } : {}),
    MICROMEET_CRMS_CREDENTIAL_FILE:
      inheritedEnvironment.MICROMEET_CRMS_CREDENTIAL_FILE ||
      genericCredentialFile ||
      paths.crmsCredentialFile,
    MICROMEET_SYS_CREDENTIAL_FILE:
      inheritedEnvironment.MICROMEET_SYS_CREDENTIAL_FILE ||
      genericCredentialFile ||
      paths.sysCredentialFile,
    MICROMEET_SESSION_FILE: inheritedEnvironment.MICROMEET_SESSION_FILE || paths.legacySessionFile
  };
};

export const runWithMicromeetCliEnvironment = <T>(
  paths: MicromeetCliPaths,
  inheritedEnvironment: Readonly<Record<string, string | undefined>>,
  resolvedCliPath: string,
  targetEnvironment: Record<string, string | undefined>,
  operation: () => T
): T => {
  const environment = resolveMicromeetCliEnvironment(paths, inheritedEnvironment, resolvedCliPath);
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) targetEnvironment[key] = value;
  }
  return operation();
};
