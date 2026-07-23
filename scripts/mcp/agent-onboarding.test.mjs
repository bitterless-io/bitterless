#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  TODO_AGENT_SKILL_NAME,
  TODO_AGENT_SKILL_RESOURCE_DIRECTORY,
  createTodoAgentSetupInstruction,
  requireTodoAgentSkillPath,
  resolveTodoAgentSkillPath
} from '../../src/main/mcp/mcpAgentOnboarding.service.ts';
import { createMcpConfigJson } from '../../src/shared/mcp/mcpBridge.shared.ts';
import { resolveMcpIntegrationSkillState } from '../../src/shared/mcp/mcpIntegrationInfo.shared.ts';
import { TODO_AGENT_SKILL_VERSION_CODE } from '../../src/shared/mcp/todoAgentSkillVersion.shared.ts';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, '..', '..');
const canonicalSkillPath = join(projectRoot, 'skills', TODO_AGENT_SKILL_NAME);
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'bitterless-agent-onboarding-'));

const collectFiles = (directory, root = directory) => {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(absolutePath, root));
    else if (entry.isFile()) files.push(relative(root, absolutePath));
    else throw new Error(`Unexpected skill entry: ${absolutePath}`);
  }
  return files.map((file) => file.split(sep).join('/')).sort();
};

const readBuilderConfig = (fileName) =>
  YAML.parse(readFileSync(join(projectRoot, fileName), 'utf8'));

try {
  assert.deepEqual(resolveMcpIntegrationSkillState(null, TODO_AGENT_SKILL_VERSION_CODE), {
    status: 'pending',
    skillPath: null,
    skillVersionCode: null
  });
  assert.deepEqual(resolveMcpIntegrationSkillState(
    { serverName: 'bitterless' },
    TODO_AGENT_SKILL_VERSION_CODE
  ), {
    status: 'restart-required',
    skillPath: null,
    skillVersionCode: null
  });
  assert.deepEqual(resolveMcpIntegrationSkillState(
    { skillPath: '   ' },
    TODO_AGENT_SKILL_VERSION_CODE
  ), {
    status: 'restart-required',
    skillPath: null,
    skillVersionCode: null
  });
  assert.deepEqual(resolveMcpIntegrationSkillState(
    {
      skillPath: `  ${canonicalSkillPath}  `,
      skillVersionCode: '260723104232'
    },
    TODO_AGENT_SKILL_VERSION_CODE
  ), {
    status: 'restart-required',
    skillPath: null,
    skillVersionCode: null
  });
  assert.deepEqual(resolveMcpIntegrationSkillState(
    {
      skillPath: `  ${canonicalSkillPath}  `,
      skillVersionCode: TODO_AGENT_SKILL_VERSION_CODE
    },
    TODO_AGENT_SKILL_VERSION_CODE
  ), {
    status: 'ready',
    skillPath: canonicalSkillPath,
    skillVersionCode: TODO_AGENT_SKILL_VERSION_CODE
  });

  assert.equal(
    resolveTodoAgentSkillPath({
      appPath: projectRoot,
      isPackaged: false,
      resourcesPath: join(temporaryDirectory, 'unused-resources')
    }),
    canonicalSkillPath
  );

  const packagedResourcesPath = join(temporaryDirectory, 'Bitterless.app', 'Contents', 'Resources');
  assert.equal(
    resolveTodoAgentSkillPath({
      appPath: join(packagedResourcesPath, 'app.asar'),
      isPackaged: true,
      resourcesPath: packagedResourcesPath
    }),
    join(packagedResourcesPath, TODO_AGENT_SKILL_RESOURCE_DIRECTORY, TODO_AGENT_SKILL_NAME)
  );

  assert.equal(requireTodoAgentSkillPath(canonicalSkillPath), canonicalSkillPath);
  const missingSkillPath = join(temporaryDirectory, 'missing-skill');
  mkdirSync(missingSkillPath, { recursive: true });
  assert.throws(
    () => requireTodoAgentSkillPath(missingSkillPath),
    /Bitterless Todo agent skill is unavailable: expected a readable SKILL\.md/
  );
  const invalidSkillPath = join(temporaryDirectory, 'invalid-skill');
  mkdirSync(join(invalidSkillPath, 'SKILL.md'), { recursive: true });
  assert.throws(() => requireTodoAgentSkillPath(invalidSkillPath), /readable SKILL\.md/);

  const productionConfig = createMcpConfigJson(
    '/Applications/Bitterless/bitterless-mcp',
    'bitterless'
  );
  const productionInstruction = createTodoAgentSetupInstruction({
    configJson: productionConfig,
    serverName: 'bitterless',
    skillPath: canonicalSkillPath,
    skillVersionCode: TODO_AGENT_SKILL_VERSION_CODE
  });
  assert.ok(productionInstruction.includes(productionConfig));
  assert.ok(productionInstruction.includes(canonicalSkillPath));
  assert.match(productionInstruction, /~\/\.codex\/skills\/bitterless-todo/);
  assert.match(productionInstruction, /~\/\.claude\/skills\/bitterless-todo/);
  assert.match(productionInstruction, /启动新的 agent session/);
  assert.match(productionInstruction, /增量复制/);
  assert.match(
    productionInstruction,
    new RegExp(`bitterless-todo version_code: ${TODO_AGENT_SKILL_VERSION_CODE}`)
  );
  assert.match(productionInstruction, /保持当前 Bitterless 应用正在运行/);
  assert.match(productionInstruction, /真实、个人、多设备同步的 Todo 数据/);
  assert.doesNotMatch(productionInstruction, /测试实例，仅用于开发验证/);

  const debugConfig = createMcpConfigJson(
    '/Applications/Bitterless_DEBUG/bitterless-mcp',
    'bitterless-debug'
  );
  const debugInstruction = createTodoAgentSetupInstruction({
    configJson: debugConfig,
    serverName: 'bitterless-debug',
    skillPath: canonicalSkillPath,
    skillVersionCode: TODO_AGENT_SKILL_VERSION_CODE
  });
  assert.ok(debugInstruction.includes(debugConfig));
  assert.match(debugInstruction, /`bitterless-debug` 是测试实例，仅用于开发验证/);
  assert.match(debugInstruction, /不要把它注册成 `bitterless`/);
  assert.match(debugInstruction, /便携技能对生产 MCP 的依赖始终是 `bitterless`/);
  assert.doesNotMatch(debugInstruction, /当前 server `bitterless` 是生产实例/);

  const expectedSkillFiles = [
    'SKILL.md',
    'agents/openai.yaml',
    'references/mcp-setup.md',
    'references/tools.md'
  ];
  assert.deepEqual(collectFiles(canonicalSkillPath), expectedSkillFiles);
  const builderConfig = readBuilderConfig('electron-builder.tmp.yml');
  assert.ok(builderConfig.files.includes('!**/*.md'));
  assert.ok(
    builderConfig.extraResources.some(
      (resource) =>
        resource.from === `skills/${TODO_AGENT_SKILL_NAME}` &&
        resource.to === `${TODO_AGENT_SKILL_RESOURCE_DIRECTORY}/${TODO_AGENT_SKILL_NAME}`
    ),
    'electron-builder.tmp.yml must copy the complete portable skill outside app.asar'
  );
  const beforeScript = readFileSync(join(projectRoot, 'scripts', 'before.js'), 'utf8');
  assert.match(beforeScript, /readFileSync\(builderTmpPath/);
  assert.match(beforeScript, /writeFileSync\(builderOutPath, builderContent/);

  const mcpHandler = readFileSync(
    join(projectRoot, 'src', 'main', 'xpc', 'mcp.handler.ts'),
    'utf8'
  );
  assert.match(mcpHandler, /requireTodoAgentSkillPath\(/);
  assert.match(mcpHandler, /appPath: app\.getAppPath\(\)/);
  assert.match(mcpHandler, /resourcesPath: process\.resourcesPath/);
  assert.match(mcpHandler, /skillPath,/);
  assert.match(mcpHandler, /skillVersionCode: TODO_AGENT_SKILL_VERSION_CODE/);

  const mcpGuide = readFileSync(
    join(
      projectRoot,
      'src',
      'renderer',
      'todo',
      'src',
      'components',
      'McpGuideModal',
      'McpGuideModal.vue'
    ),
    'utf8'
  );
  assert.match(mcpGuide, /skillState\.status === 'restart-required'/);
  assert.match(mcpGuide, /mcpRestartRequiredDescription/);
  assert.match(mcpGuide, /:disabled="skillState\.status !== 'ready'"/);
  assert.match(mcpGuide, /skillState\.value\.status === 'pending' \? i18nHelper\.todo\.mcpLoading/);
  assert.match(mcpGuide, /infoPending\.value\s+\? i18nHelper\.todo\.mcpLoading/);
  assert.doesNotMatch(mcpGuide, /info\?\.[a-zA-Z]+ \|\| i18nHelper\.todo\.mcpLoading/);

  const menuBar = readFileSync(
    join(projectRoot, 'src', 'renderer', 'todo', 'src', 'components', 'MenuBar', 'MenuBar.vue'),
    'utf8'
  );
  assert.match(
    menuBar,
    /resolveMcpIntegrationSkillState\(info, TODO_AGENT_SKILL_VERSION_CODE\)/
  );
  assert.match(menuBar, /Message\.error\(i18nHelper\.todo\.mcpRestartRequiredDescription\)/);
  assert.match(menuBar, /mcpInfo\.value = \{ \.\.\.info, skillPath: skillState\.skillPath \}/);

  const openAiConfig = YAML.parse(
    readFileSync(join(canonicalSkillPath, 'agents', 'openai.yaml'), 'utf8')
  );
  assert.deepEqual(
    openAiConfig.dependencies.tools.map((dependency) => dependency.value),
    ['bitterless']
  );

  const readableFixture = join(temporaryDirectory, 'readable-skill');
  mkdirSync(readableFixture, { recursive: true });
  writeFileSync(join(readableFixture, 'SKILL.md'), '# Fixture\n');
  assert.equal(requireTodoAgentSkillPath(readableFixture), readableFixture);

  console.log('[agent-onboarding-test] skill paths, setup instructions, and packaging passed');
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
