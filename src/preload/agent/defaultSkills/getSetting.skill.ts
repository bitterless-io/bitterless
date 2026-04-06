import { z } from 'zod';
import { settingDao } from '../../../sqlite/dao/setting.dao';

export const getSettingSchema = z.object({
  key: z.string().describe(
    'The setting key to retrieve. Known keys: DINGTALK_CONFIG, FEISHU_CONFIG, LLM, PROXY, sys_prompt.',
  ),
});

export const getSettingDefinition = {
  name: 'get_setting',
  description:
    'Read application configuration data by key from local storage. Use this to retrieve stored settings such as connector configs (DINGTALK_CONFIG, FEISHU_CONFIG), LLM model settings (LLM), proxy settings (PROXY), etc.',
  schema: getSettingSchema,
};

export const getSettingImplementation = async ({ key }: { key: string }) => {
  console.log('[skill] get_setting, key:', key);
  try {
    const data = await settingDao.get({ key });
    if (!data) {
      return JSON.stringify({ error: `Setting key '${key}' not found` });
    }
    return JSON.stringify(data, null, 2);
  } catch (err: any) {
    console.error('[skill] get_setting error:', err.message);
    return JSON.stringify({ error: err.message });
  }
};
