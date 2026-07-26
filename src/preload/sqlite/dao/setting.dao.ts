import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';
import { serializeSettingValue } from '@shared/setting/settingValue.service';

interface SettingRow {
  key: string;
  sub_key: string;
  value: string;
  updated_at: number;
}

export interface SettingStoredValue {
  exists: boolean;
  valid: boolean;
  value: unknown;
  serializedValue: string | null;
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

  async getStored(params: { key: string; sub_key?: string }): Promise<SettingStoredValue> {
    const subKey = params.sub_key ?? '';
    const row = await sqliteHelper.safeGet<SettingRow>(
      'SELECT key, sub_key, value FROM setting WHERE key = ? AND sub_key = ?',
      [params.key, subKey],
    );
    if (!row) {
      return { exists: false, valid: false, value: null, serializedValue: null };
    }

    try {
      return {
        exists: true,
        valid: true,
        value: JSON.parse(row.value) as unknown,
        serializedValue: row.value,
      };
    } catch {
      return {
        exists: true,
        valid: false,
        value: null,
        serializedValue: row.value,
      };
    }
  }

  async insertIfAbsent(params: {
    key: string;
    sub_key?: string;
    value: any;
  }): Promise<boolean> {
    const subKey = params.sub_key ?? '';
    const jsonValue = serializeSettingValue(params.value);
    const result = await sqliteHelper.safeRun(
      `INSERT INTO setting (key, sub_key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key, sub_key) DO NOTHING`,
      [params.key, subKey, jsonValue, Date.now()],
    );
    return result.changes > 0;
  }

  async compareAndSet(params: {
    key: string;
    sub_key?: string;
    expectedSerializedValue: string;
    value: any;
  }): Promise<boolean> {
    const subKey = params.sub_key ?? '';
    const jsonValue = serializeSettingValue(params.value);
    const result = await sqliteHelper.safeRun(
      `UPDATE setting
       SET value = ?, updated_at = ?
       WHERE key = ? AND sub_key = ? AND value = ?`,
      [jsonValue, Date.now(), params.key, subKey, params.expectedSerializedValue],
    );
    return result.changes > 0;
  }

  /** Upsert a setting. Value will be JSON-serialized. */
  async upsert(params: { key: string; sub_key?: string; value: any }): Promise<string> {
    const subKey = params.sub_key ?? '';
    console.log('upserting value', params);
    const jsonValue = serializeSettingValue(params.value);
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
