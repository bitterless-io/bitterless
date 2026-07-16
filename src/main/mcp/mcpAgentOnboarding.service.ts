import { accessSync, constants, statSync } from 'fs';
import { join } from 'path';

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
  if (serverName === 'bitterless') {
    return '当前 server `bitterless` 是生产实例，会读写你真实、个人、多设备同步的 Todo 数据。';
  }

  return [
    `当前 server \`${serverName}\` 是测试实例，仅用于开发验证。`,
    '不要把它注册成 `bitterless`，也不要在其中保存真实个人 Todo。',
    '便携技能对生产 MCP 的依赖始终是 `bitterless`；真实个人 Todo 必须连接生产 Bitterless。'
  ].join(' ');
};

export const createTodoAgentSetupInstruction = ({
  configJson,
  serverName,
  skillPath
}: TodoAgentSetupInstructionOptions): string =>
  [
    '请完成两步配置：MCP 提供 Todo 工具，`bitterless-todo` 技能提供个人 Todo 语义、触发判断、分组选择、去重与安全规则。',
    '',
    '1. 把下面的当前实例 MCP 配置添加到 agent 应用：',
    '',
    configJson,
    '',
    '2. 安装完整的 `bitterless-todo` 技能目录（不要只复制 SKILL.md）：',
    '',
    skillPath,
    '',
    'Codex 目标目录：`~/.codex/skills/bitterless-todo/`',
    'Claude Code 目标目录：`~/.claude/skills/bitterless-todo/`（或项目内 `.claude/skills/bitterless-todo/`）',
    '',
    '安装或更新技能后重新启动 agent session，并在使用 MCP 时保持当前 Bitterless 应用正在运行。',
    createInstanceSafetyInstruction(serverName)
  ].join('\n');
