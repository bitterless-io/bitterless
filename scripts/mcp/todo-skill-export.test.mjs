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
  assert.match(skillMarkdown, /Do not create a todo for internal agent steps/);

  const openaiConfig = parseYaml(
    readFileSync(join(skillRoot, 'agents', 'openai.yaml'), 'utf8'),
  );
  assert.deepEqual(openaiConfig.dependencies?.tools?.map((tool) => tool.value), ['bitterless']);
  assert.equal(openaiConfig.dependencies.tools[0].transport, 'stdio');

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
