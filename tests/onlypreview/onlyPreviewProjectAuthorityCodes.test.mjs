/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-authority-codes-'));
const bundlePath = join(buildRoot, 'authorityResponse.mjs');

await build({
  entryPoints: [
    join(projectRoot, 'src/main/fileSearch/fileSearchProjectAuthorityResponse.service.ts')
  ],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const { unwrapOnlyPreviewProjectAuthorityResponse, OnlyPreviewProjectAuthorityProtocolError } =
  await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const failure = (code, message) => ({ ok: false, error: { code, message } });

// A code outside the allowlist is read as the authority having violated its private protocol, and
// that tears the file-search runtime down and destroys the OnlyPreview window. So every code the
// authority legitimately produces has to be in the set — a name conflict is a user mistake, not a
// compromised authority.
test('an authoring name conflict unwraps to a typed failure, not a protocol violation', () => {
  for (const code of ['NAME_EXISTS', 'NAME_INVALID']) {
    assert.throws(
      () =>
        unwrapOnlyPreviewProjectAuthorityResponse(
          failure(code, 'An item with this name already exists in this folder.')
        ),
      (error) => {
        assert.ok(
          !(error instanceof OnlyPreviewProjectAuthorityProtocolError),
          `${code} must not be a protocol violation`
        );
        assert.equal(error.code, code);
        return true;
      }
    );
  }
});

test('every other authority code still unwraps to a typed failure', () => {
  const codes = [
    'INVALID_INPUT',
    'WORKSPACE_ACCESS_DENIED',
    'PATH_NOT_FOUND',
    'PATH_PERMISSION_DENIED',
    'PATH_OUTSIDE_WORKSPACE',
    'PATH_NOT_REGULAR_FILE',
    'PATH_UNSUPPORTED_DEVICE',
    'OPERATION_FAILED'
  ];
  for (const code of codes) {
    assert.throws(
      () => unwrapOnlyPreviewProjectAuthorityResponse(failure(code, 'The operation failed.')),
      (error) => {
        assert.ok(!(error instanceof OnlyPreviewProjectAuthorityProtocolError));
        assert.equal(error.code, code);
        return true;
      }
    );
  }
});

test('an unlisted code is still a protocol violation', () => {
  assert.throws(
    () => unwrapOnlyPreviewProjectAuthorityResponse(failure('HOST_ROLE_DENIED', 'Denied.')),
    OnlyPreviewProjectAuthorityProtocolError
  );
});

test('a message carrying a path is still a protocol violation', () => {
  assert.throws(
    () => unwrapOnlyPreviewProjectAuthorityResponse(failure('NAME_EXISTS', 'C: is taken')),
    OnlyPreviewProjectAuthorityProtocolError
  );
  assert.throws(
    () => unwrapOnlyPreviewProjectAuthorityResponse(failure('NAME_EXISTS', 'a/b is taken')),
    OnlyPreviewProjectAuthorityProtocolError
  );
});

test('a success response still returns its value', () => {
  assert.deepEqual(
    unwrapOnlyPreviewProjectAuthorityResponse({ ok: true, value: { relativePath: 'a' } }),
    { relativePath: 'a' }
  );
});
