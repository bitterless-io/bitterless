import 'reflect-metadata';
import { injectable } from 'inversify';
import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ProxyConfig } from './model.adaptor';
import {
  getSettingDefinition,
  getSettingImplementation,
} from './defaultSkills/getSetting.skill';
import {
  fetchUrlDefinition,
  createFetchUrlImplementation,
} from './defaultSkills/fetchUrl.skill';
import {
  searchWebDefinition,
  createSearchWebImplementation,
} from './defaultSkills/searchWeb.skill';
import {
  getDateDefinition,
  getDateImplementation,
} from './defaultSkills/getDate.skill';
import {
  getDateRangeDefinition,
  getDateRangeImplementation,
} from './defaultSkills/getDateRange.skill';

export const SKILL_PROMPT = `You have access to tools. Each tool has its own description and usage rules — follow them strictly.
Default to NOT calling any tool. Only call a tool when the answer genuinely cannot be produced from your own knowledge.
Do not call a tool to confirm, verify, or supplement something you already know — answer directly instead.
Each tool may only be called the number of times specified in its own description.`;

@injectable()
export class SkillService {
  getAllSkillDefinitions() {
    return [
      getSettingDefinition,
      fetchUrlDefinition,
      searchWebDefinition,
      getDateDefinition,
      getDateRangeDefinition,
    ];
  }

  getAllSkillNames(): string[] {
    return [
      'get_setting',
      'fetch_url',
      'search_web',
      'get_date',
      'get_date_range',
    ];
  }

  getSkillPrompt(): string {
    return SKILL_PROMPT;
  }

  createTools(proxy?: ProxyConfig): Record<string, StructuredToolInterface> {
    return {
      get_setting: tool(getSettingImplementation, {
        name: getSettingDefinition.name,
        description: getSettingDefinition.description,
        schema: getSettingDefinition.schema,
      }),
      fetch_url: tool(createFetchUrlImplementation(proxy), {
        name: fetchUrlDefinition.name,
        description: fetchUrlDefinition.description,
        schema: fetchUrlDefinition.schema,
      }),
      search_web: tool(createSearchWebImplementation(proxy), {
        name: searchWebDefinition.name,
        description: searchWebDefinition.description,
        schema: searchWebDefinition.schema,
      }),
      get_date: tool(getDateImplementation, {
        name: getDateDefinition.name,
        description: getDateDefinition.description,
        schema: getDateDefinition.schema,
      }),
      get_date_range: tool(getDateRangeImplementation, {
        name: getDateRangeDefinition.name,
        description: getDateRangeDefinition.description,
        schema: getDateRangeDefinition.schema,
      }),
    };
  }
}
