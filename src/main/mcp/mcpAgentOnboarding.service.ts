import { accessSync, constants, statSync } from 'fs';
import { join } from 'path';
// Relative, not aliased: `scripts/mcp/agent-onboarding.test.mjs` imports this file directly with
// raw Node, which resolves no TypeScript path aliases.
import { classifyMcpServerName } from '../../shared/mcp/mcpBridge.shared.ts';

export const TODO_AGENT_SKILL_NAME = 'bitterless-todo';
export const TODO_AGENT_SKILL_RESOURCE_DIRECTORY = 'agent-skills';

interface TodoAgentSkillPathOptions {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
}

interface TodoAgentSetupInstructionOptions {
  configJson: string;
  serverName: string;
  skillPath: string;
  skillVersionCode: string;
}

export const resolveTodoAgentSkillPath = ({
  appPath,
  isPackaged,
  resourcesPath
}: TodoAgentSkillPathOptions): string =>
  isPackaged
    ? join(resourcesPath, TODO_AGENT_SKILL_RESOURCE_DIRECTORY, TODO_AGENT_SKILL_NAME)
    : join(appPath, 'skills', TODO_AGENT_SKILL_NAME);

export const requireTodoAgentSkillPath = (skillPath: string): string => {
  const skillManifestPath = join(skillPath, 'SKILL.md');

  try {
    if (!statSync(skillManifestPath).isFile()) throw new Error('not a regular file');
    accessSync(skillManifestPath, constants.R_OK);
  } catch {
    throw new Error(
      `Bitterless Todo agent skill is unavailable: expected a readable SKILL.md at ${skillManifestPath}`
    );
  }

  return skillPath;
};

const createInstanceSafetyInstruction = (serverName: string): string => {
  const kind = classifyMcpServerName(serverName);
  if (kind === 'production') {
    return 'The current `bitterless` server is the production instance. It reads and writes your real, personal, multi-device-synchronized Todo data.';
  }

  if (kind === 'preview') {
    return 'The current `bitterless-preview` server is the Preview edition of Bitterless, not a test instance. It reads and writes your real, personal, multi-device-synchronized Todo data under the Preview edition\'s own storage. Keep this exact server name; if you install Production later, copy that edition\'s Guide and use `bitterless`.';
  }

  return [
    `The current \`${serverName}\` server is a test instance for development verification only.`,
    'Do not register it as `bitterless` or `bitterless-preview`, and do not store real personal Todos in it.',
    "The portable skill's real MCP dependency remains `bitterless` or `bitterless-preview`; real personal Todo work must connect to one of those editions."
  ].join(' ');
};

export const createTodoAgentSetupInstruction = ({
  configJson,
  serverName,
  skillPath,
  skillVersionCode,
}: TodoAgentSetupInstructionOptions): string =>
  [
    'Please set up Bitterless Todo for me by completing both steps below. MCP exposes the Todo tools, and the `bitterless-todo` skill teaches the agent personal Todo semantics, when to create a durable follow-up, Domain selection, duplicate avoidance, and safety rules.',
    '',
    '1. Add this current-instance MCP configuration to your agent application:',
    '',
    configJson,
    '',
    '2. Install the entire `bitterless-todo` skill directory (do not copy only SKILL.md):',
    '',
    skillPath,
    '',
    `bitterless-todo version_code: ${skillVersionCode}`,
    '',
    'Codex destination: `~/.codex/skills/bitterless-todo/`',
    'Claude Code destination: `~/.claude/skills/bitterless-todo/` (or `.claude/skills/bitterless-todo/` inside the project)',
    'When updating, copy the directory contents additively into the destination folder and overwrite same-named files. Do not delete other skills.',
    '',
    'After installing or updating the skill, start a new agent session. Keep the current Bitterless application running while the agent uses MCP.',
    createInstanceSafetyInstruction(serverName)
  ].join('\n');
