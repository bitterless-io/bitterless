import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { TrenchIoPaths } from './trenchIo.database';

export const TRENCH_IO_TEST_PASSWORD =
  '89abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567';

export interface TrenchIoPasswordProtection {
  encryptString(value: string): Buffer | Promise<Buffer>;
  decryptString(value: Buffer): string | Promise<string>;
}

const assertPassword = (value: string): string => {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('[trench-io] protected database password is invalid');
  }
  return value;
};

export const getOrCreateTrenchIoPassword = async (
  paths: TrenchIoPaths,
  protection: TrenchIoPasswordProtection,
  generatePassword: () => string = () => randomBytes(32).toString('hex'),
): Promise<string> => {
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(paths.directory, 0o700);
  if (existsSync(paths.keyPath)) {
    if (process.platform !== 'win32') chmodSync(paths.keyPath, 0o600);
    return assertPassword(await protection.decryptString(readFileSync(paths.keyPath)));
  }
  if (existsSync(paths.databasePath)) {
    throw new Error('[trench-io] database exists but its protected key is missing');
  }
  const password = assertPassword(generatePassword());
  try {
    writeFileSync(paths.keyPath, await protection.encryptString(password), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return assertPassword(await protection.decryptString(readFileSync(paths.keyPath)));
  }
  return password;
};
