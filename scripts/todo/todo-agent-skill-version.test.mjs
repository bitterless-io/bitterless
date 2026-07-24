#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  TODO_AGENT_SKILL_BASELINE_VERSION_CODE,
  TODO_AGENT_SKILL_VERSION_CODE,
  TODO_AGENT_SKILL_VERSION_UPDATED_EVENT,
  resolveTodoAgentSkillVersionState,
} from '../../src/shared/mcp/todoAgentSkillVersion.shared.ts';
import { resolveMcpIntegrationSkillState } from '../../src/shared/mcp/mcpIntegrationInfo.shared.ts';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, '..', '..');
const readProjectFile = (path) => readFileSync(join(projectRoot, path), 'utf8');

assert.equal(TODO_AGENT_SKILL_VERSION_CODE, '260724175151');
assert.equal(TODO_AGENT_SKILL_BASELINE_VERSION_CODE, '000000000000');
assert.deepEqual(resolveTodoAgentSkillVersionState(TODO_AGENT_SKILL_BASELINE_VERSION_CODE), {
  status: 'install-required',
  acknowledgedVersionCode: TODO_AGENT_SKILL_BASELINE_VERSION_CODE,
  attention: true,
});
assert.deepEqual(resolveTodoAgentSkillVersionState('260723121906'), {
  status: 'update-required',
  acknowledgedVersionCode: '260723121906',
  attention: true,
});
assert.deepEqual(resolveTodoAgentSkillVersionState(TODO_AGENT_SKILL_VERSION_CODE), {
  status: 'current',
  acknowledgedVersionCode: TODO_AGENT_SKILL_VERSION_CODE,
  attention: false,
});
assert.deepEqual(resolveTodoAgentSkillVersionState('260724175152'), {
  status: 'future',
  acknowledgedVersionCode: '260724175152',
  attention: false,
});
for (const invalid of [null, undefined, '', '26072417515', '26072417515x', 260724175151]) {
  assert.deepEqual(resolveTodoAgentSkillVersionState(invalid), {
    status: 'invalid',
    acknowledgedVersionCode: null,
    attention: true,
  });
}

assert.equal(resolveMcpIntegrationSkillState({
  skillPath: '/tmp/bitterless-todo',
}, TODO_AGENT_SKILL_VERSION_CODE).status, 'restart-required');
assert.equal(resolveMcpIntegrationSkillState({
  skillPath: '/tmp/bitterless-todo',
  skillVersionCode: '260723104232',
}, TODO_AGENT_SKILL_VERSION_CODE).status, 'restart-required');
assert.deepEqual(resolveMcpIntegrationSkillState({
  skillPath: ' /tmp/bitterless-todo ',
  skillVersionCode: TODO_AGENT_SKILL_VERSION_CODE,
}, TODO_AGENT_SKILL_VERSION_CODE), {
  status: 'ready',
  skillPath: '/tmp/bitterless-todo',
  skillVersionCode: TODO_AGENT_SKILL_VERSION_CODE,
});

const sharedVersion = readProjectFile('src/shared/mcp/todoAgentSkillVersion.shared.ts');
assert.match(
  sharedVersion,
  /TODO_AGENT_SKILL_VERSION_CODE = '260724175151'/,
  'application skill revision must remain a quoted hard-coded string',
);

const skillMarkdown = readProjectFile('skills/bitterless-todo/SKILL.md');
const skillFrontmatter = skillMarkdown.match(/^---\n([\s\S]*?)\n---/)?.[1];
assert.ok(skillFrontmatter, 'portable skill must have YAML frontmatter');
assert.equal(
  parseYaml(skillFrontmatter).metadata?.version_code,
  TODO_AGENT_SKILL_VERSION_CODE,
);
assert.match(skillFrontmatter, /version_code: ["']260724175151["']/);

const settingDao = readProjectFile('src/preload/sqlite/dao/setting.dao.ts');
assert.match(settingDao, /async insertIfAbsent/);
assert.match(settingDao, /ON CONFLICT\(key, sub_key\) DO NOTHING/);
assert.match(settingDao, /async compareAndSet/);
assert.match(settingDao, /AND value = \?/);

const store = readProjectFile('src/renderer/todo/src/store/todoAgentSkill.store.ts');
const initializeStart = store.indexOf('async initialize()');
const baselineInsert = store.indexOf('settingEmitter.insertIfAbsent', initializeStart);
const baselineReread = store.indexOf('await this.refresh()', baselineInsert);
assert.ok(initializeStart >= 0 && baselineInsert > initializeStart && baselineReread > baselineInsert);
assert.match(store, /versionCode !== TODO_AGENT_SKILL_VERSION_CODE/);
assert.ok(
  (store.match(/this\.versionState = resolveTodoAgentSkillVersionState\(null\);/g) ?? []).length >= 2,
  'initialize and refresh failures must become invalid attention instead of staying loading',
);
assert.match(store, /state\.status === 'future' \|\| state\.status === 'current'/);
assert.ok(
  store.indexOf("state.status === 'future'") < store.indexOf('settingEmitter.compareAndSet'),
  'future revisions must return before any acknowledgement write',
);
assert.match(store, new RegExp(`xpcRenderer\\.broadcast\\(TODO_AGENT_SKILL_VERSION_UPDATED_EVENT\\)`));

const app = readProjectFile('src/renderer/todo/src/App.vue');
assert.match(
  app,
  /void todoAgentSkillStore\.initialize\(\)\.catch/,
  'skill revision initialization must not block Todo startup',
);

const subscriber = readProjectFile('src/renderer/todo/src/xpc/update.subscriber.ts');
const skillSubscriptionStart = subscriber.indexOf(
  'xpcRenderer.subscribe(TODO_AGENT_SKILL_VERSION_UPDATED_EVENT',
);
const skillSubscriptionEnd = subscriber.indexOf('});', skillSubscriptionStart);
const skillSubscription = subscriber.slice(skillSubscriptionStart, skillSubscriptionEnd);
assert.ok(skillSubscriptionStart >= 0);
assert.match(skillSubscription, /todoAgentSkillStore\.refresh\(\)/);
assert.doesNotMatch(skillSubscription, /todoStore\.loadAll|todoSettingStore\.load/);
assert.equal(TODO_AGENT_SKILL_VERSION_UPDATED_EVENT, 'todo/agent-skill-version-updated');

const modal = readProjectFile(
  'src/renderer/todo/src/components/McpGuideModal/McpGuideModal.vue',
);
const completeIndex = modal.indexOf('name="mcp-guide__complete-setup"');
const detailsIndex = modal.indexOf('mcpDetailedInstructions');
const connectIndex = modal.indexOf('name="mcp-guide__mcp-step"');
const skillIndex = modal.indexOf('name="mcp-guide__skill-step"');
assert.ok(completeIndex >= 0 && completeIndex < detailsIndex);
assert.ok(detailsIndex < connectIndex && connectIndex < skillIndex);
assert.match(modal, /@click="copyCompleteSetup"/);
assert.equal((modal.match(/acknowledgeCurrentVersion\(/g) ?? []).length, 1);
const completeCopyStart = modal.indexOf('const copyCompleteSetup');
const clipboardWrite = modal.indexOf('navigator.clipboard.writeText(instruction.value)', completeCopyStart);
const acknowledgementWrite = modal.indexOf('acknowledgeCurrentVersion', completeCopyStart);
assert.ok(clipboardWrite > completeCopyStart && acknowledgementWrite > clipboardWrite);
const clipboardFailure = modal.slice(
  modal.indexOf('} catch {', clipboardWrite),
  acknowledgementWrite,
);
assert.match(clipboardFailure, /mcpCopyFailed/);
assert.match(clipboardFailure, /return;/);
assert.equal((modal.match(/@click="copyText\(/g) ?? []).length, 3);

const menuBar = readProjectFile('src/renderer/todo/src/components/MenuBar/MenuBar.vue');
assert.match(menuBar, /<a-badge[\s\S]*?dot[\s\S]*?:count="todoAgentSkillStore\.attention \? 1 : 0"/);
assert.match(menuBar, /:title="mcpGuideTooltip"/);
assert.match(menuBar, /:aria-label="mcpGuideTooltip"/);
assert.doesNotMatch(
  menuBar.slice(0, menuBar.indexOf('const handleOpenMcpGuide')),
  /getIntegrationInfo\(\)/,
  'the menubar badge must not refresh the MCP shim on startup',
);

const handler = readProjectFile('src/main/xpc/mcp.handler.ts');
assert.match(handler, /skillVersionCode: TODO_AGENT_SKILL_VERSION_CODE/);

console.log('[todo-agent-skill-version-test] version, persistence, copy, and UI contracts passed');
