import { BaseDao } from './base.dao';
import { sqliteHelper, sanitizeValue } from '../sqliteHelper/sqlite.helper';

interface SettingRow {
  key: string;
  sub_key: string;
  value: string;
  updated_at: number;
}

export class SettingDao extends BaseDao {
  /** Get a setting value by key and optional sub_key. Returns parsed JSON or null if not found. */
  async get<T = any>(params: { key: string; sub_key?: string }): Promise<T | null> {
    const subKey = params.sub_key ?? '';
    console.log('getting value', params);
    const row = await sqliteHelper.safeGet<SettingRow>(
      'SELECT key, sub_key, value FROM setting WHERE key = ? AND sub_key = ?',
      [params.key, subKey],
    );
    console.log('row', row);
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  /** Upsert a setting. Value will be JSON-serialized. */
  async upsert(params: { key: string; sub_key?: string; value: any }): Promise<string> {
    const subKey = params.sub_key ?? '';
    console.log('upserting value', params);
    const jsonValue = sanitizeValue(JSON.stringify(params.value));
    const now = Date.now();
    await sqliteHelper.safeRun(
      `INSERT INTO setting (key, sub_key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key, sub_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [params.key, subKey, jsonValue, now],
    );
    return 'ok';
  }
}

export const settingDao = new SettingDao();
