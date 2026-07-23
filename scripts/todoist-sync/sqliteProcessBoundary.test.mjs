import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const viteConfigPath = resolve(projectRoot, 'electron.vite.config.ts');
const todoRuntimeRoot = resolve(projectRoot, 'src/preload/sqlite/todoistSync');
const oldMainRuntimeRoot = resolve(projectRoot, 'src/main/todoistSync');
const electronXpcMainPath = resolve(projectRoot, 'node_modules/electron-xpc/dist/main/index.js');
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const sourceResolutionSuffixes = [
  '',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '/index.ts',
  '/index.tsx',
  '/index.mts',
  '/index.cts',
  '/index.js',
  '/index.mjs',
  '/index.cjs',
];
const aliases = new Map([
  ['@main/', resolve(projectRoot, 'src/main') + '/'],
  ['@preload/', resolve(projectRoot, 'src/preload') + '/'],
  ['@renderer/', resolve(projectRoot, 'src/renderer') + '/'],
  ['@shared/', resolve(projectRoot, 'src/shared') + '/'],
  ['@maestro-main/', resolve(projectRoot, 'src/main/maestro') + '/'],
  ['@maestro-shared/', resolve(projectRoot, 'src/shared/maestro') + '/'],
]);

const normalize = (path) => resolve(path);
const projectPath = (path) => relative(projectRoot, path).replaceAll('\\', '/');
const read = (path) => readFileSync(path, 'utf8');

const listFiles = (root) => {
  if (!existsSync(root)) return [];
  const result = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) result.push(path);
    }
  };
  visit(root);
  return result.sort();
};

const listSourceFiles = (root) =>
  listFiles(root).filter((path) => sourceExtensions.has(extname(path)));

const propertyName = (node) => {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return null;
};

const findObjectProperty = (object, name) => {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || propertyName(property.name) !== name) continue;
    return property.initializer;
  }
  return null;
};

const requireObject = (value, label) => {
  assert(value && ts.isObjectLiteralExpression(value), `${label} must be an object literal`);
  return value;
};

const extractElectronViteEntries = () => {
  const source = ts.createSourceFile(
    viteConfigPath,
    read(viteConfigPath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let configObject = null;
  for (const statement of source.statements) {
    if (!ts.isExportAssignment(statement)) continue;
    const expression = statement.expression;
    if (!ts.isCallExpression(expression) || expression.arguments.length !== 1) continue;
    if (!ts.isIdentifier(expression.expression) || expression.expression.text !== 'defineConfig') continue;
    configObject = requireObject(expression.arguments[0], 'defineConfig argument');
  }
  assert(configObject, 'electron.vite.config.ts must export defineConfig({...}) directly');

  const extractTarget = (targetName) => {
    const target = requireObject(findObjectProperty(configObject, targetName), `${targetName} config`);
    const build = requireObject(findObjectProperty(target, 'build'), `${targetName}.build`);
    const rollup = requireObject(
      findObjectProperty(build, 'rollupOptions'),
      `${targetName}.build.rollupOptions`,
    );
    const input = requireObject(
      findObjectProperty(rollup, 'input'),
      `${targetName}.build.rollupOptions.input`,
    );
    const entries = new Map();
    for (const property of input.properties) {
      assert(ts.isPropertyAssignment(property), `${targetName} input entries must be properties`);
      const name = propertyName(property.name);
      const value = property.initializer;
      assert(name, `${targetName} input entry must have a static name`);
      assert(
        ts.isCallExpression(value) &&
          ts.isIdentifier(value.expression) &&
          value.expression.text === 'resolve' &&
          value.arguments.length === 1 &&
          ts.isStringLiteral(value.arguments[0]),
        `${targetName} input ${name} must be resolve('src/...')`,
      );
      const path = normalize(resolve(projectRoot, value.arguments[0].text));
      assert(existsSync(path), `${targetName} input ${name} does not exist: ${projectPath(path)}`);
      entries.set(name, path);
    }
    return entries;
  };

  return {
    main: extractTarget('main'),
    preload: extractTarget('preload'),
  };
};

const importClauseIsTypeOnly = (clause) => {
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings) return false;
  if (ts.isNamespaceImport(clause.namedBindings)) return false;
  return clause.namedBindings.elements.every((element) => element.isTypeOnly);
};

const collectRuntimeSpecifiers = (path) => {
  const sourceText = read(path);
  const source = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers = [];
  const addLiteral = (literal) => {
    if (literal && ts.isStringLiteralLike(literal)) specifiers.push(literal.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      if (!importClauseIsTypeOnly(node.importClause)) addLiteral(node.moduleSpecifier);
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly) addLiteral(node.moduleSpecifier);
      return;
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addLiteral(node.moduleReference.expression);
      return;
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      if (
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        specifiers.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
};

const resolveSourceImport = (importer, specifier) => {
  let base = null;
  if (specifier.startsWith('.')) {
    base = resolve(dirname(importer), specifier);
  } else {
    for (const [alias, root] of aliases) {
      if (!specifier.startsWith(alias)) continue;
      base = resolve(root, specifier.slice(alias.length));
      break;
    }
  }
  if (!base) return null;

  for (const suffix of sourceResolutionSuffixes) {
    const candidate = normalize(`${base}${suffix}`);
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    if (!sourceExtensions.has(extname(candidate))) return null;
    return candidate;
  }
  throw new Error(`${projectPath(importer)} has unresolved source import: ${specifier}`);
};

const buildRuntimeGraph = (entry) => {
  const reached = new Set();
  const pending = [normalize(entry)];
  while (pending.length > 0) {
    const path = pending.pop();
    if (reached.has(path)) continue;
    reached.add(path);
    for (const specifier of collectRuntimeSpecifiers(path)) {
      const dependency = resolveSourceImport(path, specifier);
      if (dependency && !reached.has(dependency)) pending.push(dependency);
    }
  }
  return reached;
};

const isWithin = (path, root) => {
  const child = relative(root, path);
  return child === '' || (!child.startsWith('..') && !child.startsWith('/'));
};

const assertNoRuntimeFiles = (graph, forbiddenRoot, label) => {
  const leaked = [...graph].filter((path) => isWithin(path, forbiddenRoot)).map(projectPath);
  assert.deepEqual(leaked, [], `${label} reaches Todo SQLite runtime:\n${leaked.join('\n')}`);
};

const getParsedMainSources = () =>
  listSourceFiles(resolve(projectRoot, 'src/main')).map((path) => ({
    path,
    sourceText: read(path),
    source: ts.createSourceFile(
      path,
      read(path),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  }));

test('Electron Vite has one real Core SQLite preload entry', () => {
  const entries = extractElectronViteEntries();
  assert(entries.main.size > 0, 'Electron Vite main inputs must not be empty');
  assert(entries.preload.size > 0, 'Electron Vite preload inputs must not be empty');
  assert.equal(
    projectPath(entries.preload.get('sqlite')),
    'src/preload/sqlite/sqlite.preload.ts',
    "preload input 'sqlite' must be the Core SQLite preload",
  );
});

test('installed electron-xpc normalizes undefined cross-process results to null', () => {
  assert(existsSync(electronXpcMainPath), 'electron-xpc Main runtime must be installed');
  const source = read(electronXpcMainPath);
  assert.match(source, /task\.ret = payload\.ret \?\? null/);
  assert.match(source, /return task\.toPayload\(\)\.ret \?\? null/);
});

test('Todo database and sync runtime are reachable only from the Core SQLite preload', () => {
  const entries = extractElectronViteEntries();
  const runtimeFiles = listSourceFiles(todoRuntimeRoot);
  assert(runtimeFiles.length > 0, 'Todo SQLite runtime directory must contain source files');

  const sqliteEntry = entries.preload.get('sqlite');
  assert(sqliteEntry, "Electron Vite must define preload input 'sqlite'");
  const sqliteGraph = buildRuntimeGraph(sqliteEntry);
  const unreachable = runtimeFiles.filter((path) => !sqliteGraph.has(path)).map(projectPath);
  assert.deepEqual(
    unreachable,
    [],
    `Every Todo SQLite runtime module must be owned by sqlite.preload.ts:\n${unreachable.join('\n')}`,
  );

  for (const [name, entry] of entries.main) {
    assertNoRuntimeFiles(buildRuntimeGraph(entry), todoRuntimeRoot, `main input '${name}'`);
  }
  for (const [name, entry] of entries.preload) {
    if (name === 'sqlite') continue;
    assertNoRuntimeFiles(buildRuntimeGraph(entry), todoRuntimeRoot, `preload input '${name}'`);
  }
});

test('Todo SQLite preload owns persistence, HTTP polling, timer, status, and broadcasts', () => {
  const runtimeFiles = listSourceFiles(todoRuntimeRoot);
  const runtimeSource = runtimeFiles.map(read).join('\n');
  const runtimePaths = runtimeFiles.map(projectPath);
  const sqlitePreloadSource = read(resolve(projectRoot, 'src/preload/sqlite/sqlite.preload.ts'));
  const clientSource = read(resolve(todoRuntimeRoot, 'todoistSync.client.ts'));
  const coordinatorSource = read(resolve(todoRuntimeRoot, 'todoistSync.coordinator.ts'));

  for (const expected of [
    'todoistSync.client.ts',
    'todoistSync.coordinator.ts',
    'todoistSync.database.ts',
    'todoistSync.migration.ts',
    'todoistSync.repository.ts',
    'todoistSync.session.ts',
    'todoistSyncClock.service.ts',
    'todoistSyncPassword.service.ts',
    'todoistSyncSnowflake.service.ts',
  ]) {
    assert(
      runtimePaths.some((path) => path.endsWith(`/${expected}`)),
      `Todo SQLite runtime is missing ${expected}`,
    );
  }

  assert(/electron-xpc\/preload/.test(runtimeSource), 'Todo handlers must use preload XPC');
  assert(/XpcPreloadHandler/.test(runtimeSource), 'Todo handlers must register in SQLite preload');
  assert(
    /registerTodoistSyncHandlers/.test(sqlitePreloadSource),
    'Core SQLite preload must compose the Todo XPC handlers',
  );
  assert.match(
    sqlitePreloadSource,
    /createBoundedTodoXpcClient\(pathHelper, 'PathMainHelper'\)/,
    'Core SQLite path capability calls must reject when Main never replies',
  );
  assert.match(
    sqlitePreloadSource,
    /createXpcPreloadEmitter<TodoistSyncPasswordCapabilityApi>[\s\S]*createBoundedTodoXpcClient/,
    'Todo password capability calls must reject when Main never replies',
  );
  assert(
    /todoistSyncHandlers[^=]*=\s*isSqliteRendererDocument\s*\?\s*registerTodoistSyncHandlers/.test(
      sqlitePreloadSource,
    ),
    'Todo XPC handlers must register only for the real Core SQLite renderer document',
  );
  assert(
    /xpcRenderer\.broadcast\(['"]todo\/data_updated['"]/.test(sqlitePreloadSource),
    'Todo updates must broadcast from the Core SQLite composition root',
  );
  assert(/fetchImpl\s*\?\?\s*fetch/.test(clientSource), 'Todo HTTP client must default to fetch');
  assert(/this\.fetchImpl\s*\(/.test(clientSource), 'Todo HTTP sync must execute through its fetch client');
  assert(/setTimeout\s*\(/.test(coordinatorSource), 'Todo polling timer must run in SQLite preload');
  assert(/TodoistSyncStatus/.test(runtimeSource), 'Todo sync status must be owned by SQLite preload');
  assert(!/electron-xpc\/main/.test(runtimeSource), 'Todo SQLite runtime cannot register Main XPC handlers');
  assert(!/\bsafeStorage\b/.test(runtimeSource), 'Todo SQLite runtime must use the narrow Main crypto capability');
  assert(!/\bshell\b/.test(runtimeSource), 'Todo SQLite runtime must use the narrow Main OS capability');
});

test('Main contains no Todo SQLite runtime or direct persistence ownership', () => {
  const oldRuntimeFiles = listSourceFiles(oldMainRuntimeRoot).map(projectPath);
  assert.deepEqual(
    oldRuntimeFiles,
    [],
    `Todo runtime cannot remain under src/main/todoistSync:\n${oldRuntimeFiles.join('\n')}`,
  );

  const forbiddenImports = [
    'better-sqlite3-multiple-ciphers',
    '@main/todoistSync/',
    '@preload/sqlite/todoistSync/',
    '/src/main/todoistSync/',
    '/src/preload/sqlite/todoistSync/',
  ];
  const forbiddenOwnershipNames = new Set([
    'TodoistSyncClient',
    'TodoistSyncCoordinator',
    'TodoistSyncDatabase',
    'TodoistSyncRepository',
    'TodoistSyncClockService',
    'TodoistSyncClockStateStore',
    'TodoistSyncPasswordService',
    'TodoistSyncSessionService',
    'TodoistSyncSnowflakeService',
    'applyTodoistSyncMigrations',
    'getOrCreateTodoistSyncRuntimePassword',
    'resolveTodoistSyncDatabasePaths',
  ]);
  const violations = [];

  for (const { path, source } of getParsedMainSources()) {
    for (const specifier of collectRuntimeSpecifiers(path)) {
      if (forbiddenImports.some((value) => specifier === value || specifier.includes(value))) {
        violations.push(`${projectPath(path)} runtime-imports ${specifier}`);
      }
    }
    const visit = (node) => {
      if (
        (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
        ts.isIdentifier(node.expression) &&
        forbiddenOwnershipNames.has(node.expression.text)
      ) {
        violations.push(`${projectPath(path)} instantiates/calls ${node.expression.text}`);
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'getRepository'
      ) {
        violations.push(`${projectPath(path)} calls getRepository()`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  assert.deepEqual(violations, [], `Main owns Todo SQLite behavior:\n${violations.join('\n')}`);
});

test('Main Todo integrations use shared contracts over XPC emitters', () => {
  const integrationPaths = [
    'src/main/app.main.ts',
    'src/main/xpc/auth.handler.ts',
    'src/main/mcp/mcpBridge.server.ts',
  ].map((path) => resolve(projectRoot, path));

  for (const path of integrationPaths) {
    const source = read(path);
    assert(!/@main\/todoistSync|@preload\/sqlite\/todoistSync/.test(source));
    assert(
      /@shared\/(?:todoistSync|mcp)\//.test(source),
      `${projectPath(path)} must use shared Todo contracts`,
    );
    assert(
      /createXpcMainEmitter|todoSqlite(?:Xpc)?Client|todoistSyncXpc/i.test(source),
      `${projectPath(path)} must call Todo SQLite through an XPC emitter/client`,
    );
  }

  const mcpClientPath = resolve(projectRoot, 'src/main/mcp/todoSqlite.client.ts');
  assert(existsSync(mcpClientPath), 'Main MCP must expose a Todo SQLite XPC client');
  assert.deepEqual(
    collectRuntimeSpecifiers(mcpClientPath).sort(),
    ['@shared/todoistSync/todoXpcCall.shared', 'electron-xpc/main'],
    'The Main Todo client may runtime-import only electron-xpc/main and the browser-safe timeout wrapper',
  );
  const mcpClientSource = read(mcpClientPath);
  assert.match(
    mcpClientSource,
    /createBoundedTodoXpcClient/,
    'Main MCP Todo calls must not wait forever after a SQLite renderer crash',
  );
  for (const handlerName of [
    'TodoistSyncDomainHandler',
    'TodoistSyncTodoHandler',
    'TodoistSyncSubTodoHandler',
    'TodoistSyncEventHandler',
  ]) {
    assert(mcpClientSource.includes(handlerName), `Main MCP XPC client is missing ${handlerName}`);
  }
  assert(
    /originRendererId:\s*null/.test(mcpClientSource),
    'MCP mutations must preserve the non-renderer origin across XPC',
  );

  const authSource = read(resolve(projectRoot, 'src/main/xpc/auth.handler.ts'));
  assert.match(authSource, /createBoundedTodoXpcClient/);
  const appSource = read(resolve(projectRoot, 'src/main/app.main.ts'));
  assert.match(appSource, /createBoundedTodoXpcClient\([\s\S]*CoreSqliteBootDao/);
  assert.match(appSource, /Core SQLite target registration/);
  assert.match(appSource, /withTodoXpcTimeout\(/);
});
