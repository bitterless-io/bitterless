#!/usr/bin/env node

import AdmZip from 'adm-zip';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { TODO_AGENT_SKILL_VERSION_CODE } from '../../src/shared/mcp/todoAgentSkillVersion.shared.ts';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..', '..');
const skillName = 'bitterless-todo';
const skillRoot = join(projectRoot, 'skills', skillName);
const exporterPath = join(scriptDirectory, 'export-todo-skill.mjs');
const tempDirectory = mkdtempSync(join(tmpdir(), 'bitterless-todo-skill-'));
const archivePath = join(tempDirectory, `${skillName}.zip`);

const collectRelativeFiles = (directory) => {
  const result = [];
  const visit = (currentDirectory) => {
    const entries = readdirSync(currentDirectory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = join(currentDirectory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) result.push(relative(directory, absolutePath).split(sep).join('/'));
      else throw new Error(`Unexpected skill entry: ${absolutePath}`);
    }
  };
  visit(directory);
  return result;
};

const parseFrontmatter = (markdown) => {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, 'SKILL.md must have YAML frontmatter');
  return parseYaml(match[1]);
};

try {
  const exported = spawnSync(process.execPath, [exporterPath, '--output', archivePath], {
    encoding: 'utf8',
  });
  assert.equal(exported.status, 0, `${exported.stdout}\n${exported.stderr}`);
  assert.match(exported.stdout, /wrote .*bitterless-todo\.zip/);

  const sourceFiles = collectRelativeFiles(skillRoot);
  const archive = new AdmZip(archivePath);
  const archiveEntries = archive.getEntries().filter((entry) => !entry.isDirectory);
  const archiveNames = archiveEntries.map((entry) => entry.entryName).sort();
  const expectedNames = sourceFiles.map((file) => `${skillName}/${file}`).sort();
  assert.deepEqual(archiveNames, expectedNames);

  for (const entry of archiveEntries) {
    const relativePath = entry.entryName.slice(`${skillName}/`.length);
    assert.deepEqual(entry.getData(), readFileSync(join(skillRoot, relativePath)));
  }

  const skillMarkdown = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');
  const skillMetadata = parseFrontmatter(skillMarkdown);
  assert.equal(skillMetadata.name, skillName);
  assert.equal(skillMetadata.metadata?.version_code, TODO_AGENT_SKILL_VERSION_CODE);
  assert.match(
    skillMarkdown,
    new RegExp(`version_code: ["']${TODO_AGENT_SKILL_VERSION_CODE}["']`),
  );
  assert.match(skillMetadata.description, /personal/i);
  assert.match(skillMetadata.description, /multi-device/i);
  assert.match(skillMetadata.description, /create or update them with explicit star\/unstar/i);
  assert.match(skillMetadata.description, /important\/priority \(重点\/优先\)/i);
  assert.match(skillMetadata.description, /Focus placement\/removal/i);
  assert.match(skillMarkdown, /Do not create a todo for internal agent steps/);
  assert.match(skillMarkdown, /omit `dueAt` and `remindAt` entirely when unspecified/i);
  assert.match(skillMarkdown, /retry at most once/i);
  assert.match(skillMarkdown, /One\s+immediate empty list is insufficient/i);
  assert.match(skillMarkdown, /Call `step\.list` before editing or deleting an unknown Step/);
  assert.match(skillMarkdown, /`step\.complete` and `step\.uncomplete` as\s+idempotent/);
  assert.match(skillMarkdown, /optional `important` boolean on `todo\.create` and `todo\.update`/i);
  assert.match(skillMarkdown, /create or update with `important: true`/i);
  assert.match(skillMarkdown, /update[\s\S]*?with `important: false`/i);
  assert.match(skillMarkdown, /For `todo\.create`, use `important: false` or omit it/i);
  assert.match(skillMarkdown, /For `todo\.update`,\s+omit `important`/i);
  assert.match(skillMarkdown, /immediate human action blocks the current agent\s+session/i);
  assert.match(skillMarkdown, /do not look for or\s+invent a separate star tool/i);

  const toolReference = readFileSync(join(skillRoot, 'references', 'tools.md'), 'utf8');
  assert.match(toolReference, /never send `""` or `null` on create/i);
  assert.match(toolReference, /allow a delayed commit to settle and recheck/i);
  assert.match(toolReference, /### `step\.list`[\s\S]*Returns `\{ todo, steps \}`/);
  assert.match(toolReference, /### `step\.create`[\s\S]*Returns `\{ step \}`/);
  assert.match(toolReference, /### `step\.update`[\s\S]*changes only the Step title/);
  assert.match(toolReference, /### `step\.complete` and `step\.uncomplete`[\s\S]*idempotent/);
  assert.match(toolReference, /### `step\.delete`[\s\S]*`\{ deleted: true, id, todoId \}`/);
  assert.match(toolReference, /Set `important: true`[\s\S]*place it in Focus/i);
  assert.match(toolReference, /Otherwise use `important: false` or omit it/i);
  assert.match(toolReference, /Send\s+`important: false` for explicit unstar/i);
  assert.match(toolReference, /Omit `important`[\s\S]*existing star\s+state is preserved/i);
  assert.match(toolReference, /due date, reminder, ordinary backlog item, or unrelated edit alone\s+never changes importance/i);
  assert.match(toolReference, /do not\s+invent or call a separate star tool/i);
  assert.doesNotMatch(toolReference, /### `(?:todo\.)?star`/i);

  const openaiConfig = parseYaml(
    readFileSync(join(skillRoot, 'agents', 'openai.yaml'), 'utf8'),
  );
  assert.deepEqual(openaiConfig.dependencies?.tools?.map((tool) => tool.value), ['bitterless']);
  assert.equal(openaiConfig.dependencies.tools[0].transport, 'stdio');
  assert.match(openaiConfig.interface?.short_description, /create, update, star/i);
  assert.match(openaiConfig.interface?.default_prompt, /create or update/i);
  assert.match(openaiConfig.interface?.default_prompt, /star, unstar, and Focus intent/i);

  const setup = readFileSync(join(skillRoot, 'references', 'mcp-setup.md'), 'utf8');
  assert.match(setup, /Codex/);
  assert.match(setup, /Claude Code/);
  assert.match(setup, /codex mcp add bitterless/);
  assert.match(setup, /claude mcp add --scope user bitterless/);
  assert.match(setup, /copy the contents .* additively/i);
  assert.match(setup, /new agent session/i);
  assert.doesNotMatch(setup, /\/Users\//);
  assert.doesNotMatch(setup, /[A-Z]:\\Users\\/i);

  const invalidOutput = spawnSync(process.execPath, [exporterPath, '--output', 'not-a-zip'], {
    encoding: 'utf8',
  });
  assert.equal(invalidOutput.status, 2);
  assert.match(invalidOutput.stderr, /must end with \.zip/);

  console.log('[todo-skill-export-test] portable source, MCP metadata, and ZIP bytes passed');
} finally {
  rmSync(tempDirectory, { force: true, recursive: true });
}
