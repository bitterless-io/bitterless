import assert from 'node:assert/strict';
import test from 'node:test';
import { isAbsolute, join, relative } from 'node:path';
import {
  resolveMicromeetCliEnvironment,
  resolveMicromeetCliExecutablePath,
  resolveMicromeetCliPaths,
  runWithMicromeetCliEnvironment,
  type MicromeetCliPaths
} from '../../src/main/maestro/cli/micromeetCliPath.service.ts';

const stableHome = join('/fixtures', 'stable-home');
const previewUserData = join('/fixtures', 'Bitterless_PREVIEW');
const packagedResources = join('/fixtures', 'Bitterless Preview.app', 'Contents', 'Resources');

const stablePaths = resolveMicromeetCliPaths({
  releaseChannel: 'prod',
  appUserDataPath: join('/fixtures', 'Bitterless'),
  homeDirectory: stableHome,
  platform: 'darwin'
});

const previewPaths = resolveMicromeetCliPaths({
  releaseChannel: 'preview',
  appUserDataPath: previewUserData,
  platform: 'darwin'
});

const persistedPaths = (paths: MicromeetCliPaths): string[] => [
  paths.shimFile,
  paths.crmsCredentialFile,
  paths.sysCredentialFile,
  paths.credentialKeyFile,
  paths.legacySessionFile
];

const bundledCliPath = (paths: MicromeetCliPaths): string =>
  resolveMicromeetCliExecutablePath({
    paths,
    packaged: true,
    resourcesPath: packagedResources,
    appPath: join('/fixtures', 'app'),
    platform: 'darwin'
  });

const isWithin = (root: string, candidate: string): boolean => {
  const child = relative(root, candidate);
  return (
    child === '' ||
    (!isAbsolute(child) &&
      child !== '..' &&
      !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
  );
};

test('Stable keeps the existing ~/.micromeet path contract', () => {
  const expectedRoot = join(stableHome, '.micromeet');
  assert.equal(stablePaths.rootDir, expectedRoot);
  assert.equal(stablePaths.shimFile, join(expectedRoot, 'bin', 'micromeet'));
  assert.equal(stablePaths.crmsCredentialFile, join(expectedRoot, 'credentials', 'crms.json'));
  assert.equal(stablePaths.sysCredentialFile, join(expectedRoot, 'credentials', 'sys.json'));
  assert.equal(
    stablePaths.credentialKeyFile,
    join(expectedRoot, 'credentials', '.credential-key-v2')
  );
  assert.equal(stablePaths.legacySessionFile, join(expectedRoot, 'session.json'));
  assert.equal(stablePaths.previewIsolated, false);
});

test('Preview ignores a hostile Stable CLI override while Stable preserves it', () => {
  const hostileStableCli = join(stablePaths.rootDir, 'bin', 'micromeet');
  const commonInput = {
    inheritedCliPath: hostileStableCli,
    packaged: true,
    resourcesPath: packagedResources,
    appPath: join('/fixtures', 'app'),
    platform: 'darwin' as const
  };

  assert.equal(
    resolveMicromeetCliExecutablePath({ paths: stablePaths, ...commonInput }),
    hostileStableCli
  );
  assert.equal(
    resolveMicromeetCliExecutablePath({ paths: previewPaths, ...commonInput }),
    join(packagedResources, 'maestro-tools', 'micromeet')
  );
});

test('Preview keeps every writable CLI path below its own userData/cowork/cli root', () => {
  const expectedRoot = join(previewUserData, 'cowork', 'cli');
  assert.equal(previewPaths.rootDir, expectedRoot);
  assert.equal(previewPaths.previewIsolated, true);
  for (const candidate of persistedPaths(previewPaths)) {
    assert.equal(
      isWithin(expectedRoot, candidate),
      true,
      `${candidate} must remain below ${expectedRoot}`
    );
    assert.equal(
      isWithin(stablePaths.rootDir, candidate),
      false,
      `${candidate} must not enter Stable storage`
    );
  }
});

test('Preview Windows shim remains inside the same isolated root', () => {
  const windowsPaths = resolveMicromeetCliPaths({
    releaseChannel: 'preview',
    appUserDataPath: previewUserData,
    platform: 'win32'
  });
  assert.equal(windowsPaths.shimFile, join(previewPaths.rootDir, 'bin', 'micromeet.cmd'));
  assert.equal(isWithin(previewPaths.rootDir, windowsPaths.shimFile), true);
});

test('Stable and Preview CLI persistence paths do not overlap', () => {
  for (const stablePath of persistedPaths(stablePaths)) {
    for (const previewPath of persistedPaths(previewPaths)) {
      assert.notEqual(stablePath, previewPath);
      assert.equal(isWithin(stablePaths.rootDir, previewPath), false);
      assert.equal(isWithin(previewPaths.rootDir, stablePath), false);
    }
  }
});

test('child environments preserve Stable overrides but force every Preview-local path', () => {
  const inheritedEnvironment = {
    MICROMEET_CLI_PATH: join(stablePaths.rootDir, 'bin', 'custom-micromeet'),
    MICROMEET_CREDENTIAL_FILE: join(stablePaths.rootDir, 'credentials', 'generic.json'),
    MICROMEET_CRMS_CREDENTIAL_FILE: join(stablePaths.rootDir, 'custom-crms.json'),
    MICROMEET_SYS_CREDENTIAL_FILE: join(stablePaths.rootDir, 'custom-sys.json'),
    MICROMEET_SESSION_FILE: join(stablePaths.rootDir, 'custom-session.json')
  };
  const previewCliPath = bundledCliPath(previewPaths);

  assert.deepEqual(
    resolveMicromeetCliEnvironment(
      stablePaths,
      inheritedEnvironment,
      inheritedEnvironment.MICROMEET_CLI_PATH
    ),
    inheritedEnvironment
  );
  assert.deepEqual(
    resolveMicromeetCliEnvironment(previewPaths, inheritedEnvironment, previewCliPath),
    {
      MICROMEET_CLI_PATH: previewCliPath,
      MICROMEET_CREDENTIAL_FILE: previewPaths.crmsCredentialFile,
      MICROMEET_CRMS_CREDENTIAL_FILE: previewPaths.crmsCredentialFile,
      MICROMEET_SYS_CREDENTIAL_FILE: previewPaths.sysCredentialFile,
      MICROMEET_SESSION_FILE: previewPaths.legacySessionFile
    }
  );
});

test('Stable child environments use established global defaults when no override exists', () => {
  assert.deepEqual(resolveMicromeetCliEnvironment(stablePaths, {}, bundledCliPath(stablePaths)), {
    MICROMEET_CRMS_CREDENTIAL_FILE: stablePaths.crmsCredentialFile,
    MICROMEET_SYS_CREDENTIAL_FILE: stablePaths.sysCredentialFile,
    MICROMEET_SESSION_FILE: stablePaths.legacySessionFile
  });
});

test('Stable generic credential override retains precedence for both realms', () => {
  const genericCredentialFile = join(stablePaths.credentialDir, 'custom-generic.json');
  assert.deepEqual(
    resolveMicromeetCliEnvironment(
      stablePaths,
      { MICROMEET_CREDENTIAL_FILE: genericCredentialFile },
      bundledCliPath(stablePaths)
    ),
    {
      MICROMEET_CREDENTIAL_FILE: genericCredentialFile,
      MICROMEET_CRMS_CREDENTIAL_FILE: genericCredentialFile,
      MICROMEET_SYS_CREDENTIAL_FILE: genericCredentialFile,
      MICROMEET_SESSION_FILE: stablePaths.legacySessionFile
    }
  );
});

test('Preview CRMS and Sys login/logout paths both resolve inside the isolated credential root', () => {
  const environment = resolveMicromeetCliEnvironment(
    previewPaths,
    {
      MICROMEET_CREDENTIAL_FILE: join(stablePaths.credentialDir, 'generic.json'),
      MICROMEET_CRMS_CREDENTIAL_FILE: stablePaths.crmsCredentialFile,
      MICROMEET_SYS_CREDENTIAL_FILE: stablePaths.sysCredentialFile
    },
    bundledCliPath(previewPaths)
  );

  assert.equal(environment.MICROMEET_CRMS_CREDENTIAL_FILE, previewPaths.crmsCredentialFile);
  assert.equal(environment.MICROMEET_SYS_CREDENTIAL_FILE, previewPaths.sysCredentialFile);
  assert.equal(environment.MICROMEET_CREDENTIAL_FILE, previewPaths.crmsCredentialFile);
  assert.equal(
    isWithin(previewPaths.credentialDir, environment.MICROMEET_CRMS_CREDENTIAL_FILE),
    true
  );
  assert.equal(
    isWithin(previewPaths.credentialDir, environment.MICROMEET_SYS_CREDENTIAL_FILE),
    true
  );
});

test('Preview environment isolation survives an injected filesystem initialization failure', () => {
  const hostileEnvironment: Record<string, string | undefined> = {
    MICROMEET_CLI_PATH: join(stablePaths.rootDir, 'bin', 'micromeet'),
    MICROMEET_CREDENTIAL_FILE: join(stablePaths.credentialDir, 'generic.json'),
    MICROMEET_CRMS_CREDENTIAL_FILE: stablePaths.crmsCredentialFile,
    MICROMEET_SYS_CREDENTIAL_FILE: stablePaths.sysCredentialFile,
    MICROMEET_SESSION_FILE: stablePaths.legacySessionFile
  };
  const previewCliPath = bundledCliPath(previewPaths);

  assert.throws(
    () =>
      runWithMicromeetCliEnvironment(
        previewPaths,
        hostileEnvironment,
        previewCliPath,
        hostileEnvironment,
        () => {
          throw new Error('injected filesystem failure');
        }
      ),
    /injected filesystem failure/
  );
  assert.deepEqual(hostileEnvironment, {
    MICROMEET_CLI_PATH: previewCliPath,
    MICROMEET_CREDENTIAL_FILE: previewPaths.crmsCredentialFile,
    MICROMEET_CRMS_CREDENTIAL_FILE: previewPaths.crmsCredentialFile,
    MICROMEET_SYS_CREDENTIAL_FILE: previewPaths.sysCredentialFile,
    MICROMEET_SESSION_FILE: previewPaths.legacySessionFile
  });
});
