#!/usr/bin/env node
// Type-check this repo one SURFACE at a time, each in its own child process.
//
// Why not a single whole-project check: it does not finish. `tsc` runs out of heap before printing
// anything, and the crash output contains no `error TS`, so a whole-project run is indistinguishable
// from a clean one — which is how `typecheck:node`'s `--noCheck` went unnoticed for so long. The
// blowup is two files (`src/preload/base/langGraph/{langGraph.helper,defaultSkills/skill.registry}.ts`,
// LangGraph generics), not project size: `src/main/**` checks in ~6s while a 2.5k-line preload module
// that reaches those files cannot check at all. Full write-up and the per-surface measurements:
// `docs/issues/typecheck-is-a-false-green.md`.
//
// Splitting also buys ~1–3s feedback per surface, and keeps one exploding surface from erasing every
// other surface's result.
//
// Surfaces are DISCOVERED from the filesystem, not listed here, so a new renderer or preload module
// is checked the day it appears instead of silently escaping. Only the quarantine is hand-written —
// and it is printed on every run, because a skip nobody sees is the bug this file exists to fix.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// `exclude` cannot express this: it drops root files but not the dependency graph, so a module that
// merely imports the offender still pulls it in and still explodes. These three are quarantined by
// NAME, and the check fails loudly if one ever starts passing (that means the blowup is fixed and the
// entry should go).
const QUARANTINE = new Map([
  [
    'preload/agent',
    'reaches src/preload/base/langGraph — tsc OOMs (docs/issues/typecheck-is-a-false-green.md)'
  ],
  [
    'preload/base',
    'contains langGraph.helper.ts + defaultSkills/skill.registry.ts — tsc OOMs'
  ],
  [
    'preload/sqlite',
    'reaches src/preload/base/langGraph — tsc OOMs'
  ]
]);

const NODE_BASE = './tsconfig.node.json';
const WEB_BASE = './tsconfig.web.json';

// Test sources that live INSIDE the app trees. They reference `node:test` globals that neither app
// tsconfig provides, so checking them here reports ~45 "Cannot find name 'describe'" that say nothing
// about the app — `src/renderer/common/poker/gto/tests/gtoEngine.test.ts` alone accounts for all of
// them. `exclude` is sufficient unlike the quarantine above, because production code never imports a
// test file, so dropping it as a root file drops it entirely.
//
// This leaves those files type-checked NOWHERE, which is a real gap — the fix is a test-scoped config
// that supplies the runner types, not permanent silence. Printed on every run so it stays visible.
const TEST_SOURCE_GLOBS = ['**/*.test.ts', '**/*.test.mts', '**/tests/**/*'];

// `src/shared/<x>/main` 与 `src/shared/<x>/preload` 是**进程专属**子树(pathHelper / packageHelper,
// maestro 侧同名两份)。它们住在 shared 下只是因为和各自的 renderer 版并排好找,内容是 Electron 主进程
// 代码:import `electron` 的 `app`、读 `import.meta.env`、import `@main/…`。
//
// 而每个 web surface 的 include 都带 `src/shared` 通配,于是这些文件被编进**每一个 renderer surface**,
// 在那里必然报错 —— `tsconfig.web.json` 刻意不给 `@main/*` 映射(「renderer 不该能解析 main,
// 这条边界是刻意的」),所以 `homeData.ts` 那句 `@main/environment/runtimeProfile.runtime` 永远解析不了。
// 15 个 renderer surface 各报 3 条,45 条诊断,而 renderer 根本不 import 这些文件(已核实)。
//
// 排除它们不会漏检:main / preload 那几个 surface 仍然完整编译它们。
const PROCESS_SPECIFIC_SHARED_GLOBS = ['src/shared/**/main/**/*', 'src/shared/**/preload/**/*'];

const dirsIn = (relative) =>
  readdirSync(join(ROOT, relative), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

const buildSurfaces = () => {
  const surfaces = [
    { id: 'shared', kind: 'node', include: ['src/shared/**/*'] },
    // SDK 跟着 main 一起查:它在仓外,tsconfig.node.json 的 include 在这里会被整体覆盖,
    // 只加到那边等于没加。宿主与 SDK 的契约破裂必须在这个 surface 上现形。
    { id: 'main', kind: 'node', include: ['src/main/**/*', 'src/shared/**/*', 'src/main/agent/**/*.ts'] },
    { id: 'utility', kind: 'node', include: ['src/utility/**/*', 'src/shared/**/*'] },
    // Checked on its own because every renderer surface pulls it in; without this the ~45 errors it
    // carries would be attributed to whichever module happened to be checked.
    { id: 'renderer/common', kind: 'web', include: ['src/env.d.ts', 'src/renderer/common/**/*'] }
  ];

  for (const name of dirsIn('src/preload')) {
    surfaces.push({
      id: `preload/${name}`,
      kind: 'node',
      include: [`src/preload/${name}/**/*`, 'src/shared/**/*']
    });
  }

  for (const name of dirsIn('src/renderer')) {
    if (name === 'common') continue;
    surfaces.push({
      id: `renderer/${name}`,
      kind: 'web',
      include: [
        'src/env.d.ts',
        `src/renderer/${name}/**/*`,
        'src/renderer/common/**/*',
        'src/shared/**/*'
      ]
    });
  }

  return surfaces.filter((surface) => existsSync(join(ROOT, surface.include[0].split('/**')[0])));
};

const runSurface = (surface) => {
  // Written at the repo ROOT so `extends`, `baseUrl` and `paths` resolve exactly as they do for the
  // real configs. A copy under tmp/ would need every path rewritten by one level — a second place to
  // get wrong. `.gitignore` covers `tsconfig.surface.*.json`.
  const configPath = join(ROOT, `tsconfig.surface.${surface.id.replace(/\//g, '_')}.json`);
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        extends: surface.kind === 'node' ? NODE_BASE : WEB_BASE,
        include: surface.include,
        exclude:
          surface.kind === 'web'
            ? [...TEST_SOURCE_GLOBS, ...PROCESS_SPECIFIC_SHARED_GLOBS]
            : TEST_SOURCE_GLOBS,
        compilerOptions: { composite: false, noEmit: true }
      },
      null,
      2
    )}\n`
  );

  const startedAt = process.hrtime.bigint();
  try {
    const result = spawnSync(
      'npx',
      ['--no-install', surface.kind === 'web' ? 'vue-tsc' : 'tsc', '-p', configPath],
      {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
        // Cleared so an inherited --max-old-space-size cannot mask a surface that only fits by
        // accident on one machine.
        env: { ...process.env, NODE_OPTIONS: '' }
      }
    );
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const seconds = Number((process.hrtime.bigint() - startedAt) / 1000000n) / 1000;
    return {
      oom: /heap out of memory/.test(output),
      // Diagnostic lines only. `grep`-style counting over the whole output would also count the
      // crash stack, which is what made an OOM read as zero errors.
      lines: output.split('\n').filter((line) => /^\S.*\(\d+,\d+\): error TS\d+/.test(line)),
      seconds
    };
  } finally {
    if (existsSync(configPath)) unlinkSync(configPath);
  }
};

// `--kind=node|web` exists so `typecheck:node` and `typecheck:web` can keep their names and finally
// mean what they say. Historical `docs/plan/tasks/*.md` `verify:` lines call `yarn typecheck:node`;
// pointing that name at the real node surfaces keeps those lines runnable AND makes them check types,
// which is what they always claimed to do. The old parse-only command survives as `parse:node`.
const args = process.argv.slice(2);
const kind = args.find((arg) => arg.startsWith('--kind='))?.slice('--kind='.length);
if (kind && kind !== 'node' && kind !== 'web') {
  console.error(`--kind must be "node" or "web", got ${JSON.stringify(kind)}.`);
  process.exit(2);
}
const requested = args.filter((arg) => !arg.startsWith('--'));
const surfaces = buildSurfaces().filter(
  (surface) =>
    (!kind || surface.kind === kind) &&
    (requested.length === 0 || requested.includes(surface.id))
);
if (surfaces.length === 0) {
  console.error(`No surface matched ${JSON.stringify(requested)}.`);
  console.error(`Known: ${buildSurfaces().map((surface) => surface.id).join(', ')}`);
  process.exit(2);
}

const union = new Map();
const rows = [];
let failed = false;

console.log(`typecheck by surface — ${surfaces.length} surface(s)\n`);
console.log(`${'surface'.padEnd(24)}${'result'.padEnd(12)}${'errors'.padEnd(9)}seconds`);

for (const surface of surfaces) {
  const quarantineReason = QUARANTINE.get(surface.id);
  if (quarantineReason) {
    rows.push({ id: surface.id, quarantined: true, reason: quarantineReason });
    console.log(`${surface.id.padEnd(24)}${'QUARANTINED'.padEnd(12)}${'-'.padEnd(9)}-`);
    continue;
  }

  const { oom, lines, seconds } = runSurface(surface);
  for (const line of lines) union.set(line, true);
  const result = oom ? 'OOM' : lines.length === 0 ? 'ok' : 'errors';
  if (oom || lines.length > 0) failed = true;
  rows.push({ id: surface.id, oom, count: lines.length, seconds });
  console.log(
    `${surface.id.padEnd(24)}${result.padEnd(12)}${String(oom ? '-' : lines.length).padEnd(9)}${seconds.toFixed(1)}`
  );
}

const quarantined = rows.filter((row) => row.quarantined);
if (quarantined.length > 0) {
  console.log(`\nquarantined (${quarantined.length}) — NOT checked:`);
  for (const row of quarantined) console.log(`  ${row.id}: ${row.reason}`);
}

console.log(`\nexcluded from every surface — NOT checked anywhere: ${TEST_SOURCE_GLOBS.join(' ')}`);

// Deduped, because a shared file is a root file of one surface and a dependency of several others;
// summing the per-surface counts would multiply those.
console.log(`\ndistinct diagnostics across all surfaces: ${union.size}`);
if (union.size > 0) {
  const byCode = new Map();
  for (const line of union.keys()) {
    const code = line.match(/error (TS\d+)/)[1];
    byCode.set(code, (byCode.get(code) ?? 0) + 1);
  }
  for (const [code, count] of [...byCode].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${code}`);
  }
}

if (process.env.TYPECHECK_SURFACES_LIST_ERRORS === '1') {
  console.log('');
  for (const line of [...union.keys()].sort()) console.log(line);
}

process.exit(failed ? 1 : 0);
