/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-trench-agent-guide-'));

await build({
  entryPoints: {
    service: join(projectRoot, 'src/main/mcp/trenchAgentOnboarding.service.ts'),
    guide: join(projectRoot, 'src/shared/trench/trenchAgentGuide.shared.ts'),
    version: join(projectRoot, 'src/shared/trench/trenchAgentSkillVersion.shared.ts'),
    store: join(projectRoot, 'src/renderer/coin/src/views/vault/trenchAgentGuide.store.ts'),
  },
  outdir: buildRoot,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
});

const service = await import(pathToFileURL(join(buildRoot, 'service.mjs')).href);
const guide = await import(pathToFileURL(join(buildRoot, 'guide.mjs')).href);
const version = await import(pathToFileURL(join(buildRoot, 'version.mjs')).href);
const storeModule = await import(pathToFileURL(join(buildRoot, 'store.mjs')).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const createSkillFixture = () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'bitterless-trench-guide-skill-'));
  const skillPath = join(fixtureRoot, 'bitterless-trench');
  for (const relativePath of service.TRENCH_AGENT_SKILL_REQUIRED_FILES) {
    const filePath = join(skillPath, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${relativePath}\n`);
  }
  return { fixtureRoot, skillPath };
};

const withSkillFixture = (callback) => {
  const fixture = createSkillFixture();
  try {
    callback(fixture);
  } finally {
    rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
};

const createInfo = (serverName = 'bitterless') => service.createTrenchMcpIntegrationInfo({
  serverName,
  commandPath: '/tmp/current-profile/bin/bitterless-mcp',
  skillPath: '/tmp/current-app/skills/bitterless-trench',
  skillVersionCode: version.TRENCH_AGENT_SKILL_VERSION_CODE,
  bridgePath: '/tmp/current-profile/mcp/bridge.sock',
  transport: 'unix',
});

const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

test('resolves packaged and unpackaged complete skill paths and fails closed on missing files', () => {
  assert.equal(
    service.resolveTrenchAgentSkillPath({
      appPath: '/application',
      isPackaged: false,
      resourcesPath: '/resources',
    }),
    join('/application', 'skills', 'bitterless-trench'),
  );
  assert.equal(
    service.resolveTrenchAgentSkillPath({
      appPath: '/application',
      isPackaged: true,
      resourcesPath: '/resources',
    }),
    join('/resources', 'agent-skills', 'bitterless-trench'),
  );

  withSkillFixture(({ skillPath }) => {
    assert.equal(service.requireTrenchAgentSkillPath(skillPath), skillPath);
  });
  for (const relativePath of service.TRENCH_AGENT_SKILL_REQUIRED_FILES) {
    withSkillFixture(({ skillPath }) => {
      unlinkSync(join(skillPath, relativePath));
      assert.throws(
        () => service.requireTrenchAgentSkillPath(skillPath),
        /complete bitterless-trench agent skill is unavailable/,
      );
    });
  }
  withSkillFixture(({ skillPath }) => {
    const filePath = join(skillPath, 'references/tools.md');
    unlinkSync(filePath);
    symlinkSync(join(skillPath, 'SKILL.md'), filePath);
    assert.throws(
      () => service.requireTrenchAgentSkillPath(skillPath),
      /complete bitterless-trench agent skill is unavailable/,
    );
  });
});

test('creates one complete production payload with exact helper, config, skill, and restart steps', () => {
  const info = createInfo();
  assert.deepEqual(Object.keys(info).sort(), [
    'bridgePath',
    'commandPath',
    'configJson',
    'instruction',
    'serverName',
    'skillPath',
    'skillVersionCode',
    'transport',
  ]);
  assert.deepEqual(JSON.parse(info.configJson), {
    mcpServers: {
      bitterless: { command: info.commandPath },
    },
  });
  assert.match(info.instruction, /1\. Connect the current MCP server named `bitterless`/);
  assert.match(info.instruction, /2\. Install the entire `bitterless-trench` skill directory/);
  assert.match(info.instruction, /3\. Restart the agent and verify/);
  assert.match(info.instruction, /all 12 `trench\.\*` tools/);
  assert.match(info.instruction, /\$bitterless-trench/);
  assert.match(info.instruction, /\/bitterless-trench/);
  assert.match(info.instruction, new RegExp(info.skillVersionCode));
  assert.match(info.instruction, new RegExp(info.commandPath));
  assert.match(info.instruction, new RegExp(info.skillPath));
  assert.doesNotMatch(info.instruction, /[\u3400-\u9fff]/);
  assert.doesNotMatch(
    JSON.stringify(info),
    /keychain|safeStorage|BEGIN [A-Z ]*PRIVATE KEY|(?:api[_-]?key|password)\s*[:=]|trench[\\/]analyses/i,
  );
});

test('keeps DEBUG identity test-only and never aliases it to production bitterless', () => {
  const info = createInfo('bitterless-debug-dev');
  assert.deepEqual(Object.keys(JSON.parse(info.configJson).mcpServers), ['bitterless-debug-dev']);
  assert.match(info.instruction, /test instance for development verification only/);
  assert.match(info.instruction, /Keep this exact server name/);
  assert.match(info.instruction, /Do not register it as `bitterless`/);
  assert.match(info.instruction, /do not store real Trench records/i);
  assert.doesNotMatch(info.configJson, /"bitterless"\s*:/);
});

test('rejects invalid versions and resolves missing or mismatched renderer contracts explicitly', () => {
  assert.throws(
    () => service.createTrenchMcpIntegrationInfo({
      serverName: 'bitterless',
      commandPath: '/tmp/helper',
      skillPath: '/tmp/skill',
      skillVersionCode: '123',
      bridgePath: '/tmp/bridge',
      transport: 'unix',
    }),
    /exactly 12 digits/,
  );

  const info = createInfo();
  assert.deepEqual(
    guide.resolveTrenchAgentGuideInfo(info, version.TRENCH_AGENT_SKILL_VERSION_CODE),
    { status: 'ready', info },
  );
  for (const field of [
    'serverName',
    'commandPath',
    'configJson',
    'skillPath',
    'skillVersionCode',
    'instruction',
    'bridgePath',
    'transport',
  ]) {
    const invalid = { ...info, [field]: '' };
    assert.deepEqual(
      guide.resolveTrenchAgentGuideInfo(invalid, version.TRENCH_AGENT_SKILL_VERSION_CODE),
      { status: 'restart-required', reason: 'invalid-payload' },
      field,
    );
  }
  assert.deepEqual(
    guide.resolveTrenchAgentGuideInfo(
      { ...info, skillVersionCode: '999999999999' },
      version.TRENCH_AGENT_SKILL_VERSION_CODE,
    ),
    { status: 'restart-required', reason: 'version-mismatch' },
  );
  assert.deepEqual(
    guide.resolveTrenchAgentGuideInfo(null, version.TRENCH_AGENT_SKILL_VERSION_CODE),
    { status: 'restart-required', reason: 'invalid-payload' },
  );
});

test('dedicated store retries loads and copies only exact Main-returned strings', async () => {
  const info = createInfo('bitterless-debug-dev');
  let response = info;
  let rejectLoad = true;
  const copied = [];
  const store = new storeModule.TrenchAgentGuideStore(
    {
      getIntegrationInfo: async () => {
        if (rejectLoad) throw new Error('unavailable');
        return response;
      },
    },
    { writeText: async (text) => { copied.push(text); } },
  );

  await store.load();
  assert.equal(store.phase, 'error');
  rejectLoad = false;
  await store.load();
  assert.equal(store.phase, 'ready');
  for (const [kind, expected] of [
    ['complete', info.instruction],
    ['helper', info.commandPath],
    ['config', info.configJson],
    ['skill', info.skillPath],
  ]) {
    assert.equal(await store.copy(kind), true);
    assert.equal(store.copyStates[kind], 'copied');
    assert.equal(copied.at(-1), expected);
  }

  response = { ...info, skillVersionCode: '999999999999' };
  await store.load();
  assert.equal(store.phase, 'restart-required');
  assert.equal(store.mismatchReason, 'version-mismatch');
  assert.equal(await store.copy('complete'), false);
});

test('Main and renderer wiring stay guide-only with no credential or Trench mutation dependency', () => {
  const handler = source('src/main/xpc/mcp.handler.ts');
  const onboarding = source('src/main/mcp/trenchAgentOnboarding.service.ts');
  const guideStore = source(
    'src/renderer/coin/src/views/vault/trenchAgentGuide.store.ts',
  );
  const header = source(
    'src/renderer/coin/src/components/TrenchHeader/TrenchHeader.vue',
  );
  const modal = source(
    'src/renderer/coin/src/components/TrenchAgentGuideModal/TrenchAgentGuideModal.vue',
  );

  assert.match(handler, /getTrenchIntegrationInfo\(\)/);
  assert.match(handler, /TRENCH_AGENT_SKILL_VERSION_CODE/);
  assert.match(handler, /createTrenchMcpIntegrationInfo/);
  assert.match(header, /name="trench__header__agent-guide"/);
  assert.match(header, /<TrenchAgentGuideModal/);
  assert.match(modal, /@open="focusNativeClose"/);
  assert.match(modal, /@close="restoreFocus"/);
  assert.match(modal, /close\.tabIndex = 0/);
  assert.doesNotMatch(
    [onboarding, guideStore].join('\n'),
    /Keychain|safeStorage|trenchVaultStore|TrenchRepository|provider credential/i,
  );
});
