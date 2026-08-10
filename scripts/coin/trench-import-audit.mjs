/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const roots = [
  'src/main/xpc/coinWindow.handler.ts',
  'src/preload/trench/trench.preload.ts',
  'src/renderer/coin/src/main.ts',
];
const aliases = {
  '@main/': 'src/main/',
  '@preload/': 'src/preload/',
  '@renderer/': 'src/renderer/',
  '@shared/': 'src/shared/',
  '@maestro-main/': 'src/main/maestro/',
  '@maestro-shared/': 'src/shared/maestro/',
};
const forbiddenPaths = [
  /src\/main\/coin\/(?:ai|data|resources|strategy|x)\//,
  /src\/main\/coin\/coinIpc\.service\.ts$/,
  /src\/preload\/coin\/coin\.preload\.ts$/,
  /src\/renderer\/coin\/src\/(?:coinShell|coinLanguage)\./,
  /src\/renderer\/coin\/src\/views\/(?:analysis|resources)\//,
  /src\/renderer\/coin\/src\/components\/(?:Coin|TrenchCommandBar|TrenchSignalRail|TrenchDecisionDock|TrenchWorkspace)/,
];

const resolveImport = (fromFile, specifier) => {
  let base;
  const alias = Object.entries(aliases).find(([prefix]) => specifier.startsWith(prefix));
  if (alias) base = resolve(projectRoot, alias[1], specifier.slice(alias[0].length));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null;
  const extension = extname(base);
  const candidates = ['.ts', '.vue', '.mjs', '.cjs'].includes(extension)
    ? [base]
    : extension === '.js'
      ? [base, `${base.slice(0, -3)}.ts`]
      : [`${base}.ts`, `${base}.vue`, resolve(base, 'index.ts')];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

const visited = new Set();
const importSpecifiers = (source) => [
  ...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g),
  ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
].map((match) => match[1]);

const walk = (file) => {
  if (visited.has(file)) return;
  visited.add(file);
  const relative = file.slice(projectRoot.length + 1);
  assert.equal(
    forbiddenPaths.some((pattern) => pattern.test(relative)),
    false,
    `Forbidden legacy Trench import reached: ${relative}`,
  );
  const source = readFileSync(file, 'utf8');
  for (const specifier of importSpecifiers(source)) {
    const resolved = resolveImport(file, specifier);
    if (resolved) walk(resolved);
  }
};

for (const root of roots) walk(resolve(projectRoot, root));

const preloadSource = readFileSync(resolve(projectRoot, 'src/preload/trench/trench.preload.ts'), 'utf8');
assert.doesNotMatch(preloadSource, /ipcRenderer|window\.coin|clipboard|analy[sz]e|resources|xBrowser/);
const rendererSources = [...visited]
  .filter((file) => file.includes('/src/renderer/coin/') || file.includes('/src/shared/trench/'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
assert.doesNotMatch(rendererSources, /window\.coin|analyzeMeme|autoAnalyzeMeme|clipboard\.read|xBrowser/);

const activeMainFiles = new Set();
const walkActiveMain = (file) => {
  if (activeMainFiles.has(file)) return;
  activeMainFiles.add(file);
  const source = readFileSync(file, 'utf8');
  for (const specifier of importSpecifiers(source)) {
    const resolved = resolveImport(file, specifier);
    if (resolved) walkActiveMain(resolved);
  }
};
walkActiveMain(resolve(projectRoot, 'src/main/app.main.ts'));
const directSafeStorageImports = [...activeMainFiles]
  .filter((file) => /import\s*\{[^}]*\bsafeStorage\b[^}]*\}\s*from\s*['"]electron['"]/.test(
    readFileSync(file, 'utf8'),
  ))
  .map((file) => file.slice(projectRoot.length + 1));
assert.deepEqual(
  directSafeStorageImports,
  ['src/main/security/safeStorage.runtime.ts'],
  'Active Main safeStorage access must stay behind the shared E2E/debug tripwire',
);

process.stdout.write(
  `Trench active import audit passed (${visited.size} Trench files, ${activeMainFiles.size} Main files).\n`,
);
