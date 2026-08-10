/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { load as loadYaml } from 'js-yaml';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-agent-skill-'));
const serviceBundle = join(buildRoot, 'service.mjs');
const versionBundle = join(buildRoot, 'version.mjs');

await build({
  entryPoints: {
    service: join(
      projectRoot,
      'src/main/onlypreview/onlyPreviewAgentSkill.service.ts'
    ),
    version: join(
      projectRoot,
      'src/shared/onlypreview/onlyPreviewAgentSkillVersion.shared.ts'
    )
  },
  outdir: buildRoot,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const service = await import(pathToFileURL(serviceBundle).href);
const version = await import(pathToFileURL(versionBundle).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

const listFiles = (root) => {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(relative(root, path).replaceAll('\\', '/'));
    }
  };
  visit(root);
  return files.sort();
};

const createSkillFixture = () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'bitterless-preview-skill-fixture-'));
  const skillPath = join(fixtureRoot, 'bitterless-preview');
  for (const relativePath of service.ONLY_PREVIEW_AGENT_SKILL_REQUIRED_FILES) {
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

test('portable Preview skill inventory, version, and MCP dependency are exact', () => {
  const skillRoot = join(projectRoot, 'skills/bitterless-preview');
  const expectedFiles = [
    'SKILL.md',
    'agents/openai.yaml',
    'references/mcp-setup.md',
    'references/tools.md'
  ];
  assert.deepEqual(listFiles(skillRoot), expectedFiles);
  for (const relativePath of expectedFiles) {
    const stats = lstatSync(join(skillRoot, relativePath));
    assert.equal(stats.isSymbolicLink(), false);
    assert.equal(stats.isFile(), true);
    assert(stats.size > 0);
  }

  const skill = source('skills/bitterless-preview/SKILL.md');
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/)?.[1];
  assert(frontmatter);
  const metadata = loadYaml(frontmatter);
  assert.equal(metadata.name, 'bitterless-preview');
  assert.match(metadata.metadata.version_code, /^\d{12}$/);
  assert.equal(metadata.metadata.version_code, version.ONLY_PREVIEW_AGENT_SKILL_VERSION_CODE);
  assert.equal(version.isOnlyPreviewAgentSkillVersionCode(metadata.metadata.version_code), true);

  const sidecar = loadYaml(source('skills/bitterless-preview/agents/openai.yaml'));
  assert.deepEqual(sidecar.dependencies.tools, [
    {
      type: 'mcp',
      value: 'bitterless',
      description: 'Production Bitterless local MCP server',
      transport: 'stdio'
    }
  ]);
  assert.match(sidecar.interface.default_prompt, /\$bitterless-preview/);

  const portableContent = expectedFiles.map((path) => source(`skills/bitterless-preview/${path}`)).join('\n');
  assert.doesNotMatch(portableContent, /\/Users\//);
  assert.doesNotMatch(portableContent, /[A-Za-z]:\\Users\\/);
  assert.doesNotMatch(portableContent, /(?:api[_-]?key|access[_-]?token|password)\s*[:=]/i);
  assert.match(skill, /explicit local file or folder/i);
  assert.match(skill, /read-only human inspection/i);
  assert.match(skill, /Never guess/i);
});

test('skill path resolution and complete-file validation fail closed', () => {
  assert.equal(
    service.resolveOnlyPreviewAgentSkillPath({
      appPath: '/application',
      isPackaged: false,
      resourcesPath: '/resources'
    }),
    join('/application', 'skills', 'bitterless-preview')
  );
  assert.equal(
    service.resolveOnlyPreviewAgentSkillPath({
      appPath: '/application',
      isPackaged: true,
      resourcesPath: '/resources'
    }),
    join('/resources', 'agent-skills', 'bitterless-preview')
  );

  withSkillFixture(({ skillPath }) => {
    assert.equal(service.requireOnlyPreviewAgentSkillPath(skillPath), skillPath);
  });

  for (const relativePath of service.ONLY_PREVIEW_AGENT_SKILL_REQUIRED_FILES) {
    withSkillFixture(({ skillPath }) => {
      unlinkSync(join(skillPath, relativePath));
      assert.throws(() => service.requireOnlyPreviewAgentSkillPath(skillPath), /unavailable/);
    });
    withSkillFixture(({ skillPath }) => {
      writeFileSync(join(skillPath, relativePath), '');
      assert.throws(() => service.requireOnlyPreviewAgentSkillPath(skillPath), /unavailable/);
    });
    withSkillFixture(({ skillPath }) => {
      const filePath = join(skillPath, relativePath);
      unlinkSync(filePath);
      symlinkSync(join(skillPath, 'SKILL.md'), filePath);
      assert.throws(() => service.requireOnlyPreviewAgentSkillPath(skillPath), /unavailable/);
    });
  }

  withSkillFixture(({ fixtureRoot, skillPath }) => {
    const realPath = `${skillPath}-real`;
    renameSync(skillPath, realPath);
    symlinkSync(realPath, skillPath, 'dir');
    assert.throws(() => service.requireOnlyPreviewAgentSkillPath(skillPath), /unavailable/);
    assert.equal(dirname(realPath), fixtureRoot);
  });
  withSkillFixture(({ skillPath }) => {
    const referencesPath = join(skillPath, 'references');
    const realReferencesPath = `${referencesPath}-real`;
    renameSync(referencesPath, realReferencesPath);
    symlinkSync(realReferencesPath, referencesPath, 'dir');
    assert.throws(() => service.requireOnlyPreviewAgentSkillPath(skillPath), /unavailable/);
  });
  withSkillFixture(({ skillPath }) => {
    const toolsPath = join(skillPath, 'references/tools.md');
    unlinkSync(toolsPath);
    mkdirSync(toolsPath);
    assert.throws(() => service.requireOnlyPreviewAgentSkillPath(skillPath), /unavailable/);
  });
  withSkillFixture(({ skillPath }) => {
    const toolsPath = join(skillPath, 'references/tools.md');
    chmodSync(toolsPath, 0o000);
    try {
      assert.throws(() => service.requireOnlyPreviewAgentSkillPath(skillPath), /unavailable/);
    } finally {
      chmodSync(toolsPath, 0o600);
    }
  });
});

test('Guide info exposes three fields and one complete English production or DEBUG instruction', () => {
  const production = service.createOnlyPreviewAgentSkillGuideInfo({
    configJson: '{"mcpServers":{"bitterless":{"command":"/tmp/helper"}}}',
    serverName: 'bitterless',
    skillPath: '/tmp/bitterless-preview',
    skillVersionCode: version.ONLY_PREVIEW_AGENT_SKILL_VERSION_CODE
  });
  assert.deepEqual(Object.keys(production).sort(), [
    'instruction',
    'serverName',
    'skillVersionCode'
  ]);
  assert.equal(production.serverName, 'bitterless');
  assert.match(production.instruction, /MCP configuration/);
  assert.match(production.instruction, /entire `bitterless-preview` skill directory/);
  assert.match(production.instruction, /~\/\.codex\/skills\/bitterless-preview/);
  assert.match(production.instruction, /~\/\.claude\/skills\/bitterless-preview/);
  assert.match(production.instruction, /start a new agent session/i);
  assert.match(production.instruction, /production Bitterless instance/);
  assert.doesNotMatch(production.instruction, /[\u3400-\u9fff]/);

  const debug = service.createOnlyPreviewAgentSkillGuideInfo({
    configJson: '{"mcpServers":{"bitterless-debug":{"command":"/tmp/helper"}}}',
    serverName: 'bitterless-debug',
    skillPath: '/tmp/bitterless-preview',
    skillVersionCode: version.ONLY_PREVIEW_AGENT_SKILL_VERSION_CODE
  });
  assert.match(debug.instruction, /test instance for development verification only/);
  assert.match(debug.instruction, /Do not register it as `bitterless`/);
  assert.doesNotMatch(debug.instruction, /[\u3400-\u9fff]/);
});

test('Guide renderer and Main capability wiring remain narrow and one-card only', () => {
  const types = source('src/shared/onlypreview/onlyPreview.types.ts');
  const preload = source('src/preload/onlypreview/onlypreview.preload.ts');
  const envPreload = source('src/preload/onlypreview/onlyPreviewEnv.preload.ts');
  const preloadType = source('src/preload/onlypreview/onlypreview.preload.type.ts');
  const handler = source('src/main/xpc/onlyPreview.handler.ts');
  const windowHelper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  const guideOpen = windowHelper.slice(
    windowHelper.indexOf('async openAgentSkillGuide('),
    windowHelper.indexOf('requireAgentSkillGuideHost(')
  );
  const guideApp = source('src/renderer/onlypreview/guide/src/App.vue');
  const guideClient = source(
    'src/renderer/onlypreview/guide/src/onlyPreviewGuide.client.ts'
  );
  const guideStore = source('src/renderer/onlypreview/guide/src/onlyPreviewGuide.store.ts');
  const shellApp = source('src/renderer/onlypreview/shell/src/App.vue');
  const shellStore = source('src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts');

  assert.match(types, /OnlyPreviewHostKind = 'standalone' \| 'settings' \| 'guide'/);
  assert.match(types, /OnlyPreviewHostRole = 'content' \| 'settings' \| 'guide'/);
  assert.match(types, /interface OnlyPreviewAgentSkillGuideInfo \{[\s\S]*serverName: string;[\s\S]*skillVersionCode: string;[\s\S]*instruction: string;/);
  assert.match(
    preloadType,
    /'shell' \| 'previewHeader' \| 'preview' \| 'settings' \| 'guide'/
  );
  assert.match(envPreload, /value === 'guide'/);
  assert.doesNotMatch(preload, /clipboard|writeText|openAgentSkillGuide|getAgentSkillGuideInfo/);

  assert.match(
    guideClient,
    /Pick<OnlyPreviewApi, 'getAgentSkillGuideInfo'>/
  );
  assert.match(
    guideClient,
    /createXpcRendererEmitter<OnlyPreviewGuideApi>\([\s\S]*'OnlyPreviewHandler'/
  );
  assert.doesNotMatch(
    guideClient,
    /openOnlyPreviewWindow|openAgentSkillGuide|chooseFolder|readText|openExternally/
  );
  assert.match(guideStore, /from '\.\/onlyPreviewGuide\.client'/);
  assert.doesNotMatch(guideStore, /common\/onlyPreviewClient|onlyPreviewClient/);

  assert.match(handler, /openAgentSkillGuide[\s\S]*require\(params\?\.hostToken, \['content'\]\)/);
  assert.match(handler, /getAgentSkillGuideInfo[\s\S]*requireAgentSkillGuideHost\(params\?\.hostToken\)/);
  assert.match(handler, /createOnlyPreviewAgentSkillGuideInfo\(\{[\s\S]*serverName,[\s\S]*skillVersionCode:/);
  assert.doesNotMatch(source('src/main/mcp/mcpBridge.server.ts'), /onlyPreview\.handler/);
  assert.match(source('src/main/app.main.ts'), /mcpBridgeServer\.configurePreviewOpener\(openOnlyPreviewAbsoluteTarget\)/);

  assert.match(guideOpen, /requireStandaloneWindow\(sourceHostToken\)/);
  assert.match(guideOpen, /issue\('guide', 'guide'\)/);
  assert.match(guideOpen, /parent: parentWindow/);
  assert.match(guideOpen, /minWidth: MIN_WIDTH,[\s\S]*minHeight: MIN_HEIGHT/);
  assert.match(guideOpen, /autoHideMenuBar: true/);
  assert.match(guideOpen, /sandbox: true,[\s\S]*contextIsolation: true,[\s\S]*nodeIntegration: false,[\s\S]*webSecurity: true/);
  assert.match(guideOpen, /windowStateService\.resolve\('onlypreview-guide'\)/);
  assert.match(guideOpen, /restored\?\.bounds\.width[\s\S]*restored\?\.bounds\.height/);
  assert.doesNotMatch(guideOpen, /restored\.bounds\.(?:x|y)/);
  assert.match(guideOpen, /configureNavigationFence\(window\.webContents, target\.url, false\)/);
  assert.doesNotMatch(guideOpen, /modal:\s*true|frame:\s*false|bindNativeShortcuts|bindOnlyPreviewDevToolsShortcut/);
  assert.match(windowHelper, /destroyAgentSkillGuide\(\): void \{[\s\S]*flushAndDispose\(\)[\s\S]*revoke/);

  assert.match(shellApp, /onlypreview__agentSkillGuide[\s\S]*IconRobot/);
  assert(shellApp.indexOf('onlypreview__agentSkillGuide') < shellApp.indexOf('onlypreview__settings'));
  assert.match(shellStore, /openAgentSkillGuide\(\)[\s\S]*onlyPreviewClient\.openAgentSkillGuide/);
  assert.equal(
    (guideApp.match(/class="onlypreview-guide__copy-card"/g) ?? []).length,
    1
  );
  assert.match(guideApp, /Complete setup instructions|onlyPreviewI18n\.guide\.completeSetup/);
  assert.doesNotMatch(guideApp, /a-modal|summary|Detailed instructions|helper path|configJson|skillPath|badge|acknowledge/i);
  assert.equal((guideStore.match(/navigator\.clipboard\.writeText/g) ?? []).length, 1);
  assert.match(guideStore, /writeText\(this\.info\.instruction\)/);
  assert.doesNotMatch(guideStore, /localStorage|SettingDao|acknowledge/);
});

test('Guide is included in renderer, logging, i18n, and complete resource inventories', () => {
  const builder = loadYaml(source('electron-builder.tmp.yml'));
  assert(
    builder.extraResources.some(
      (entry) =>
        entry.from === 'skills/bitterless-preview' &&
        entry.to === 'agent-skills/bitterless-preview'
    )
  );
  const vite = source('electron.vite.config.ts');
  assert.match(
    vite,
    /for \(const mode of \['shell', 'previewHeader', 'preview', 'settings', 'guide'\]\)/
  );
  assert.match(vite, /'onlypreview\/guide': resolve\('src\/renderer\/onlypreview\/guide\/index\.html'\)/);
  assert.match(
    source('src/main/logging/logPolicy.service.ts'),
    /\/onlypreview\/guide\/index\.html'[\s\S]*renderer:onlypreviewGuide/
  );
  const i18nInventory = source('scripts/renderer-i18n/check-renderer-i18n.mjs');
  assert.match(i18nInventory, /onlyPreviewGuide.*onlypreview\/guide\/src\/main\.ts/);
  assert.match(i18nInventory, /rendererEntries\.length, 17/);
  const catalog = source('src/renderer/onlypreview/common/onlyPreviewI18n.ts');
  assert.match(catalog, /title: 'Copy the skill to your agent'/);
  assert.match(
    catalog,
    /Copy these instructions to your agent\. They include the skill and MCP setup\./
  );
});
