#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import AdmZip from 'adm-zip';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { TRENCH_AGENT_SKILL_VERSION_CODE } from '../../src/shared/trench/trenchAgentSkillVersion.shared.ts';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..', '..');
const skillName = 'bitterless-trench';
const skillRoot = join(projectRoot, 'skills', skillName);
const exporterPath = join(scriptDirectory, 'export-trench-skill.mjs');
const tempDirectory = mkdtempSync(join(tmpdir(), 'bitterless-trench-skill-'));
const archivePath = join(tempDirectory, `${skillName}.zip`);

const expectedFiles = [
  'SKILL.md',
  'agents/openai.yaml',
  'references/mcp-setup.md',
  'references/person-import.md',
  'references/schemas.md',
  'references/tools.md',
  'scripts/convert-person-import.mjs'
];

const collectRelativeFiles = (directory) => {
  const result = [];
  const visit = (currentDirectory) => {
    const entries = readdirSync(currentDirectory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
    for (const entry of entries) {
      const absolutePath = join(currentDirectory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) result.push(relative(directory, absolutePath).split(sep).join('/'));
      else throw new Error(`Unexpected skill entry: ${absolutePath}`);
    }
  };
  visit(directory);
  return result.sort();
};

const parseFrontmatter = (markdown) => {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, 'SKILL.md must have YAML frontmatter');
  return parseYaml(match[1]);
};

const assertNoCredentialMaterial = (text, label) => {
  assert.doesNotMatch(text, /\b(?:sk|pk)_[A-Za-z0-9_-]{16,}\b/, `${label} contains key material`);
  assert.doesNotMatch(
    text,
    /GMGN_(?:API|PRIVATE)_KEY\s*=/,
    `${label} contains a credential assignment`
  );
  assert.doesNotMatch(
    text,
    /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
    `${label} contains a private key`
  );
};

try {
  const exported = spawnSync(process.execPath, [exporterPath, '--output', archivePath], {
    encoding: 'utf8'
  });
  assert.equal(exported.status, 0, `${exported.stdout}\n${exported.stderr}`);
  assert.match(exported.stdout, /wrote .*bitterless-trench\.zip/);

  const sourceFiles = collectRelativeFiles(skillRoot);
  assert.deepEqual(sourceFiles, expectedFiles);

  const archive = new AdmZip(archivePath);
  const archiveEntries = archive.getEntries().filter((entry) => !entry.isDirectory);
  const archiveNames = archiveEntries.map((entry) => entry.entryName).sort();
  assert.deepEqual(archiveNames, expectedFiles.map((file) => `${skillName}/${file}`).sort());
  for (const entry of archiveEntries) {
    const relativePath = entry.entryName.slice(`${skillName}/`.length);
    const sourceBytes = readFileSync(join(skillRoot, relativePath));
    assert.deepEqual(entry.getData(), sourceBytes);
    assertNoCredentialMaterial(sourceBytes.toString('utf8'), relativePath);
  }

  const skillMarkdown = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');
  const skillMetadata = parseFrontmatter(skillMarkdown);
  assert.equal(skillMetadata.name, skillName);
  assert.equal(skillMetadata.metadata?.version_code, TRENCH_AGENT_SKILL_VERSION_CODE);
  assert.match(skillMetadata.description, /BSC, Solana, or Robinhood/);
  assert.match(skillMetadata.description, /production\s+`bitterless` MCP server/);
  assert.match(skillMarkdown, /Before provider research, read both dictionaries/);
  assert.match(skillMarkdown, /no more than the top 100 profit wallets/);
  assert.match(skillMarkdown, /human's explicit chain, address, and nonblank explanation/);
  assert.match(skillMarkdown, /holdings analysis.*separate read-only provider step/is);
  assert.match(skillMarkdown, /Reread once with `trench\.analysis\.get`/);
  assert.match(skillMarkdown, /never handles credentials|Never request, read, paste, forward/is);
  assert.match(skillMarkdown, /Never invoke swap,\s+cooking, order, signing, launch, transfer/is);
  assert.match(skillMarkdown, /Robinhood addresses as EVM addresses/);
  assert.doesNotMatch(skillMarkdown, /bitterless-(?:debug|dev).*for real work/is);

  const openaiConfig = parseYaml(readFileSync(join(skillRoot, 'agents', 'openai.yaml'), 'utf8'));
  assert.deepEqual(
    openaiConfig.dependencies?.tools?.map((tool) => tool.value),
    ['bitterless']
  );
  assert.equal(openaiConfig.dependencies.tools[0].transport, 'stdio');
  assert.match(openaiConfig.interface?.default_prompt, /\$bitterless-trench/);

  const tools = readFileSync(join(skillRoot, 'references', 'tools.md'), 'utf8');
  assert.equal(
    (tools.match(/`trench\.[a-z_.]+`/g) ?? []).filter(
      (value, index, values) => values.indexOf(value) === index
    ).length,
    13
  );
  assert.match(tools, /After every successful mutation, call the matching get once/);
  assert.match(tools, /A timeout is indeterminate/);
  assert.match(tools, /`trench\.person\.import`/);

  const personImport = readFileSync(join(skillRoot, 'references', 'person-import.md'), 'utf8');
  assert.match(personImport, /strict UTF-8 JSON/);
  assert.match(personImport, /empty temporary directory/);
  assert.match(personImport, /delete the whole temporary directory/);
  assert.match(personImport, /stable UUIDv4-shaped IDs/);

  const schemas = readFileSync(join(skillRoot, 'references', 'schemas.md'), 'utf8');
  assert.match(schemas, /BSC and Robinhood use lowercase EVM identity/);
  assert.match(schemas, /Solana.*cannot coexist\s+with an EVM chain block/is);
  assert.match(schemas, /`holdings` contains at most 1,000 unique asset identities/);
  assert.match(schemas, /provider is unavailable.*`holdings: \[\]`/is);

  const setup = readFileSync(join(skillRoot, 'references', 'mcp-setup.md'), 'utf8');
  assert.match(setup, /Codex/);
  assert.match(setup, /Claude Code/);
  assert.match(setup, /server name `bitterless`/);
  assert.match(setup, /copy the directory contents additively/);
  assert.match(setup, /`ops\/bitterless\/ops\.yml`/);
  assert.match(setup, /owners are all `ral`/);
  assert.match(setup, /never fall back to `areas\/keychain\/`/);
  assert.doesNotMatch(setup, /\/Users\//);
  assert.doesNotMatch(setup, /[A-Z]:\\Users\\/i);

  const invalidOutput = spawnSync(process.execPath, [exporterPath, '--output', 'not-a-zip'], {
    encoding: 'utf8'
  });
  assert.equal(invalidOutput.status, 2);
  assert.match(invalidOutput.stderr, /must end with \.zip/);

  console.log('[trench-skill-export-test] source, metadata, policy, and ZIP bytes passed');
} finally {
  rmSync(tempDirectory, { force: true, recursive: true });
}
