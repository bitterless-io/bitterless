import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import { createBoundedTodoXpcClient } from '@shared/todoistSync/todoXpcCall.shared';

export const settingEmitter = createBoundedTodoXpcClient(
  createXpcRendererEmitter<SettingDao>('SettingDao') as SettingDao,
  'SettingDao',
);
