import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';

export const settingEmitter = createXpcRendererEmitter<SettingDao>('SettingDao') as SettingDao;
