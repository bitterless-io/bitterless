import { accessSync, constants, lstatSync } from 'fs';
import { dirname, join } from 'path';
import { createMcpConfigJson } from '@shared/mcp/mcpBridge.shared';
import type { McpBridgeTransport, McpIntegrationInfo } from '@shared/mcp/mcpBridge.type';
import { isTrenchAgentSkillVersionCode } from '@shared/trench/trenchAgentSkillVersion.shared';

export const TRENCH_AGENT_SKILL_NAME = 'bitterless-trench';
export const TRENCH_AGENT_SKILL_RESOURCE_DIRECTORY = 'agent-skills';
export const TRENCH_AGENT_SKILL_REQUIRED_FILES = [
  'SKILL.md',
  'agents/openai.yaml',
  'references/mcp-setup.md',
  'references/schemas.md',
  'references/tools.md',
] as const;

interface TrenchAgentSkillPathOptions {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
}

interface TrenchAgentIntegrationInfoOptions {
  serverName: string;
  commandPath: string;
  skillPath: string;
  skillVersionCode: string;
  bridgePath: string;
  transport: McpBridgeTransport;
}

const requirePlainDirectory = (directory: string): void => {
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('not a plain directory');
};

export const resolveTrenchAgentSkillPath = ({
  appPath,
  isPackaged,
  resourcesPath,
}: TrenchAgentSkillPathOptions): string => isPackaged
  ? join(resourcesPath, TRENCH_AGENT_SKILL_RESOURCE_DIRECTORY, TRENCH_AGENT_SKILL_NAME)
  : join(appPath, 'skills', TRENCH_AGENT_SKILL_NAME);

export const requireTrenchAgentSkillPath = (skillPath: string): string => {
  try {
    requirePlainDirectory(skillPath);
    for (const relativePath of TRENCH_AGENT_SKILL_REQUIRED_FILES) {
      const filePath = join(skillPath, relativePath);
      let parent = dirname(filePath);
      while (parent !== skillPath) {
        requirePlainDirectory(parent);
        parent = dirname(parent);
      }
      const stats = lstatSync(filePath);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size === 0) {
        throw new Error('not a readable regular file');
      }
      accessSync(filePath, constants.R_OK);
    }
  } catch {
    throw new Error('The complete bitterless-trench agent skill is unavailable.');
  }

  return skillPath;
};

const createInstanceSafetyInstruction = (serverName: string): string => {
  if (serverName === 'bitterless') {
    return 'The current `bitterless` server is the production Bitterless instance for real Trench records.';
  }

  return [
    `The current \`${serverName}\` server is a test instance for development verification only.`,
    'Keep this exact server name. Do not register it as `bitterless`, and do not store real Trench records in it.',
    "The portable skill's production MCP dependency remains `bitterless`; real Trench work must use the production Bitterless instance.",
  ].join(' ');
};

export const createTrenchAgentSetupInstruction = (params: {
  serverName: string;
  commandPath: string;
  configJson: string;
  skillPath: string;
  skillVersionCode: string;
}): string => [
  'Please set up Bitterless Trench by completing all three ordered steps below.',
  '',
  `1. Connect the current MCP server named \`${params.serverName}\`. Keep the current Bitterless application running while the agent uses MCP.`,
  '',
  'Current helper path:',
  params.commandPath,
  '',
  'Add this exact MCP configuration to your agent application:',
  params.configJson,
  '',
  '2. Install the entire `bitterless-trench` skill directory. Do not copy only SKILL.md:',
  params.skillPath,
  '',
  `bitterless-trench version_code: ${params.skillVersionCode}`,
  'Codex destination: `~/.codex/skills/bitterless-trench/`',
  'Claude Code destination: `~/.claude/skills/bitterless-trench/` (or `.claude/skills/bitterless-trench/` inside the project)',
  'Copy the directory contents additively and overwrite same-named files. Do not delete other skills.',
  '',
  '3. Restart the agent and verify the integration in a fresh session.',
  'Confirm tools/list exposes all 12 `trench.*` tools, then invoke `$bitterless-trench` in Codex or `/bitterless-trench` in Claude Code.',
  createInstanceSafetyInstruction(params.serverName),
].join('\n');

export const createTrenchMcpIntegrationInfo = ({
  serverName,
  commandPath,
  skillPath,
  skillVersionCode,
  bridgePath,
  transport,
}: TrenchAgentIntegrationInfoOptions): McpIntegrationInfo => {
  if (!serverName.trim() || !commandPath.trim() || !skillPath.trim() || !bridgePath.trim()) {
    throw new Error('Trench MCP integration fields must be non-empty.');
  }
  if (!isTrenchAgentSkillVersionCode(skillVersionCode)) {
    throw new Error('Trench agent skill version must contain exactly 12 digits.');
  }

  const configJson = createMcpConfigJson(commandPath, serverName);
  const instruction = createTrenchAgentSetupInstruction({
    serverName,
    commandPath,
    configJson,
    skillPath,
    skillVersionCode,
  });

  return {
    serverName,
    commandPath,
    configJson,
    skillPath,
    skillVersionCode,
    instruction,
    bridgePath,
    transport,
  };
};
