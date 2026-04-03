import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ProxyConfig } from '../model.adaptor';
import { getSettingSkill } from './getSetting.skill';
import { createFetchUrlSkill } from './fetchUrl.skill';
import { createSearchWebSkill } from './searchWeb.skill';
import { getDateSkill } from './getDate.skill';
import { getDateRangeSkill } from './getDateRange.skill';
import { executeCommandSkill } from './executeCommand.skill';

export const createAllSkills = (proxy?: ProxyConfig): Record<string, StructuredToolInterface> => ({
  get_setting: getSettingSkill,
  fetch_url: createFetchUrlSkill(proxy),
  search_web: createSearchWebSkill(proxy),
  get_date: getDateSkill,
  get_date_range: getDateRangeSkill,
  // execute_command: executeCommandSkill,
});

export const allSkillNames = ['get_setting', 'fetch_url', 'search_web',
  'get_date', 'get_date_range'
  , 'execute_command'] as const;

export const SKILL_PROMPT = `You have access to tools. Each tool has its own description and usage rules — follow them strictly.
Default to NOT calling any tool. Only call a tool when the answer genuinely cannot be produced from your own knowledge.
Do not call a tool to confirm, verify, or supplement something you already know — answer directly instead.
Each tool may only be called the number of times specified in its own description.`;


