/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { after } from 'node:test';
import { build } from 'esbuild';
import ts from 'typescript';

export const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-unit-'));
const bundlePath = join(buildRoot, 'runtime.mjs');

await build({
  entryPoints: [join(projectRoot, 'tests/onlypreview/runtime.entry.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  // fs-extra and its `graceful-fs` dependency are CommonJS and call `require('fs')` at load time.
  // esbuild leaves that call intact when it bundles them into ESM, where `require` does not exist,
  // so the bundle needs one.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);"
  },
  alias: {
    electron: join(projectRoot, 'tests/onlypreview/fixtures/electron.stub.mjs'),
    '@main/fileSearch/fileSearchWindow.service': join(
      projectRoot,
      'tests/onlypreview/fixtures/fileSearchWindow.stub.mjs'
    )
  }
});

export const runtime = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

export const withTempDirectory = async (prefix, callback) => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    return await callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

export const expectOnlyPreviewError = (code) => (error) =>
  error instanceof runtime.OnlyPreviewContractError && error.code === code;

export const write = (path, content = '') => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
};

export const createRegistries = () => {
  const hosts = new runtime.OnlyPreviewHostRegistry();
  const workspaces = new runtime.OnlyPreviewWorkspaceRegistry(hosts);
  const assets = new runtime.OnlyPreviewAssetRegistry(hosts, workspaces);
  return { hosts, workspaces, assets };
};

export const registerWorkspace = (workspaces, hostToken, rootPath, selectedRelativePath) => {
  const rootRealPath = realpathSync(rootPath);
  const workspace = workspaces.registerValidatedTarget(hostToken, {
    rootRealPath,
    displayPath: rootRealPath,
    rootName: basename(rootRealPath),
    ...(selectedRelativePath ? { selectedRelativePath } : {})
  });
  workspaces.bindProjectAuthority(hostToken, workspace.workspaceId, 1);
  return workspace;
};

export const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

export const classMethodNames = (relativePath, className) => {
  const text = source(relativePath);
  const file = ts.createSourceFile(
    relativePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const declaration = file.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === className
  );
  assert.ok(declaration, `${className} must exist`);
  return declaration.members
    .filter(ts.isMethodDeclaration)
    .map((member) => member.name.getText(file));
};
