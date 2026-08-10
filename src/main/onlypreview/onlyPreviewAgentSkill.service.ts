import { accessSync, constants, lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { OnlyPreviewAgentSkillGuideInfo } from '@shared/onlypreview/onlyPreview.types';

export const ONLY_PREVIEW_AGENT_SKILL_NAME = 'bitterless-preview';
export const ONLY_PREVIEW_AGENT_SKILL_RESOURCE_DIRECTORY = 'agent-skills';
export const ONLY_PREVIEW_AGENT_SKILL_REQUIRED_FILES = [
  'SKILL.md',
  'agents/openai.yaml',
  'references/mcp-setup.md',
  'references/tools.md'
] as const;

interface OnlyPreviewAgentSkillPathOptions {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
}

interface OnlyPreviewAgentSetupInstructionOptions {
  configJson: string;
  serverName: string;
  skillPath: string;
  skillVersionCode: string;
}

export const resolveOnlyPreviewAgentSkillPath = ({
  appPath,
  isPackaged,
  resourcesPath
}: OnlyPreviewAgentSkillPathOptions): string =>
  isPackaged
    ? join(
        resourcesPath,
        ONLY_PREVIEW_AGENT_SKILL_RESOURCE_DIRECTORY,
        ONLY_PREVIEW_AGENT_SKILL_NAME
      )
    : join(appPath, 'skills', ONLY_PREVIEW_AGENT_SKILL_NAME);

export const requireOnlyPreviewAgentSkillPath = (skillPath: string): string => {
  try {
    for (const directoryPath of [
      skillPath,
      join(skillPath, 'agents'),
      join(skillPath, 'references')
    ]) {
      const stats = lstatSync(directoryPath);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error('invalid skill directory');
      }
    }
    for (const relativePath of ONLY_PREVIEW_AGENT_SKILL_REQUIRED_FILES) {
      const filePath = join(skillPath, relativePath);
      const stats = lstatSync(filePath);
      if (stats.isSymbolicLink() || !stats.isFile() || stats.size === 0) {
        throw new Error('invalid skill file');
      }
      accessSync(filePath, constants.R_OK);
    }
  } catch {
    throw new Error('Bitterless Preview agent skill is unavailable. Restart Bitterless and retry.');
  }
  return skillPath;
};

const createInstanceSafetyInstruction = (serverName: string): string => {
  if (serverName === 'bitterless') {
    return 'The current `bitterless` MCP server is the production Bitterless instance.';
  }
  return [
    `The current \`${serverName}\` MCP server is a test instance for development verification only.`,
    'Do not register it as `bitterless`.',
    "The portable skill's production MCP dependency remains `bitterless`."
  ].join(' ');
};

export const createOnlyPreviewAgentSetupInstruction = ({
  configJson,
  serverName,
  skillPath,
  skillVersionCode
}: OnlyPreviewAgentSetupInstructionOptions): string =>
  [
    'Set up Bitterless Preview for me by completing both required steps below.',
    '',
    '1. Add this current-instance MCP configuration to your agent application:',
    '',
    configJson,
    '',
    '2. Install the entire `bitterless-preview` skill directory (do not copy only SKILL.md):',
    '',
    skillPath,
    '',
    `bitterless-preview version_code: ${skillVersionCode}`,
    '',
    'Codex destination: `~/.codex/skills/bitterless-preview/`',
    'Claude Code destination: `~/.claude/skills/bitterless-preview/` (or `.claude/skills/bitterless-preview/` inside the project)',
    'Copy the directory contents additively into the destination and overwrite same-named files. Do not delete other skills.',
    '',
    'After installing or updating the skill, start a new agent session. Keep the current Bitterless application running while the agent uses MCP.',
    createInstanceSafetyInstruction(serverName)
  ].join('\n');

export const createOnlyPreviewAgentSkillGuideInfo = (
  options: OnlyPreviewAgentSetupInstructionOptions
): OnlyPreviewAgentSkillGuideInfo => ({
  serverName: options.serverName,
  skillVersionCode: options.skillVersionCode,
  instruction: createOnlyPreviewAgentSetupInstruction(options)
});
