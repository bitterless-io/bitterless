import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBitterlessE2ELaunchArgs } from './electronLaunchArgs.ts';

test('macOS mock Keychain switch precedes the Bitterless application path', () => {
  const applicationArguments = ['--onlypreview-open=/private/fixture'];
  assert.deepEqual(
    buildBitterlessE2ELaunchArgs({
      platform: 'darwin',
      applicationPath: '/workspace/bitterless',
      applicationArguments
    }),
    [
      '--use-mock-keychain',
      '/workspace/bitterless',
      '--onlypreview-open=/private/fixture'
    ]
  );
  assert.deepEqual(applicationArguments, ['--onlypreview-open=/private/fixture']);
});

test('Windows launch arguments retain the application path without a macOS switch', () => {
  assert.deepEqual(
    buildBitterlessE2ELaunchArgs({
      platform: 'win32',
      applicationPath: 'C:\\workspace\\bitterless',
      applicationArguments: ['--onlypreview-open=C:\\fixture']
    }),
    ['C:\\workspace\\bitterless', '--onlypreview-open=C:\\fixture']
  );
});
