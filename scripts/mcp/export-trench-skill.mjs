#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import AdmZip from 'adm-zip';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..', '..');
const skillName = 'bitterless-trench';
const skillRoot = join(projectRoot, 'skills', skillName);
const defaultOutputPath = join(projectRoot, 'dist', 'skills', `${skillName}.zip`);

class InputError extends Error {}

const HELP = `Export the portable Bitterless Trench skill for Codex and Claude Code.

Usage:
  yarn mcp:trench:skill:export [--output <zip-path>]

Options:
  --output <path>  Destination ZIP (default: dist/skills/bitterless-trench.zip)
  -h, --help       Show this help.
`;

const parseArgs = (argv) => {
  let outputPath = defaultOutputPath;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true, outputPath };
    if (arg === '--output') {
      const value = argv[index + 1];
      if (!value) throw new InputError('--output requires a path.');
      outputPath = resolve(value);
      index += 1;
      continue;
    }
    throw new InputError(`Unknown option: ${arg}`);
  }
  if (!outputPath.toLowerCase().endsWith('.zip')) {
    throw new InputError('--output must end with .zip.');
  }
  return { help: false, outputPath };
};

const collectFiles = (directory) => {
  const files = [];
  const visit = (currentDirectory) => {
    const entries = readdirSync(currentDirectory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
    for (const entry of entries) {
      const absolutePath = join(currentDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Skill packages cannot contain symlinks: ${absolutePath}`);
      }
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Skill packages can contain only regular files: ${absolutePath}`);
      }
      files.push(absolutePath);
    }
  };
  visit(directory);
  return files;
};

const toArchivePath = (absolutePath) => {
  const relativePath = relative(skillRoot, absolutePath).split(sep).join('/');
  if (!relativePath || relativePath.startsWith('../')) {
    throw new Error(`Skill file escapes source directory: ${absolutePath}`);
  }
  return `${skillName}/${relativePath}`;
};

const exportSkill = (outputPath) => {
  if (!statSync(skillRoot).isDirectory()) {
    throw new Error(`Skill source is not a directory: ${skillRoot}`);
  }
  const files = collectFiles(skillRoot);
  if (files.length === 0) throw new Error(`Skill source is empty: ${skillRoot}`);

  const archive = new AdmZip();
  for (const filePath of files) {
    archive.addFile(toArchivePath(filePath), readFileSync(filePath));
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  archive.writeZip(outputPath);
  return files.length;
};

const main = () => {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(HELP);
      return 0;
    }
    const fileCount = exportSkill(options.outputPath);
    console.log(`[trench-skill-export] wrote ${options.outputPath} (${fileCount} files)`);
    return 0;
  } catch (error) {
    const prefix = error instanceof InputError ? 'Input error' : 'FAIL';
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[trench-skill-export] ${prefix}: ${message}`);
    return error instanceof InputError ? 2 : 1;
  }
};

process.exitCode = main();
