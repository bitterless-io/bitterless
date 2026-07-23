import { compareVersions } from 'compare-versions';

export const TODO_AGENT_SKILL_VERSION_CODE = '260723104233';
export const TODO_AGENT_SKILL_BASELINE_VERSION_CODE = '000000000000';
export const TODO_AGENT_SKILL_SETTING_KEY = 'todo_agent_skill';
export const TODO_AGENT_SKILL_SETTING_SUB_KEY = 'acknowledged_version_code';
export const TODO_AGENT_SKILL_VERSION_UPDATED_EVENT = 'todo/agent-skill-version-updated';

export type TodoAgentSkillVersionStatus =
  | 'loading'
  | 'install-required'
  | 'update-required'
  | 'current'
  | 'future'
  | 'invalid';

export interface TodoAgentSkillVersionState {
  status: TodoAgentSkillVersionStatus;
  acknowledgedVersionCode: string | null;
  attention: boolean;
}

export const TODO_AGENT_SKILL_LOADING_STATE: TodoAgentSkillVersionState = {
  status: 'loading',
  acknowledgedVersionCode: null,
  attention: false,
};

export const isTodoAgentSkillVersionCode = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{12}$/.test(value);

export const resolveTodoAgentSkillVersionState = (
  acknowledgedVersionCode: unknown,
): TodoAgentSkillVersionState => {
  if (!isTodoAgentSkillVersionCode(acknowledgedVersionCode)) {
    return {
      status: 'invalid',
      acknowledgedVersionCode: null,
      attention: true,
    };
  }

  if (acknowledgedVersionCode === TODO_AGENT_SKILL_BASELINE_VERSION_CODE) {
    return {
      status: 'install-required',
      acknowledgedVersionCode,
      attention: true,
    };
  }

  const comparison = compareVersions(
    acknowledgedVersionCode,
    TODO_AGENT_SKILL_VERSION_CODE,
  );
  if (comparison < 0) {
    return {
      status: 'update-required',
      acknowledgedVersionCode,
      attention: true,
    };
  }
  if (comparison > 0) {
    return {
      status: 'future',
      acknowledgedVersionCode,
      attention: false,
    };
  }

  return {
    status: 'current',
    acknowledgedVersionCode,
    attention: false,
  };
};
