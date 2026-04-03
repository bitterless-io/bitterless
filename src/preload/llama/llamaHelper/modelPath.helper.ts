import { join } from 'path';
import { existsSync } from 'fs';
import { ipcRenderer } from 'electron';

/**
 * Resolve the models directory.
 * In dev mode, prefer external_resources/models/ (where init_external_resources.js downloads to).
 * In production, use {userData}/models/.
 */
export const getModelsDir = async (): Promise<string> => {
  // Dev: check external_resources/models/ relative to project root
  const devModelsDir = join(process.cwd(), 'external_resources', 'models');
  if (existsSync(devModelsDir)) {
    return devModelsDir;
  }

  // Production: use userData/models/
  const userDataPath = await ipcRenderer.invoke('bitterless:get-userdata-path');
  return join(userDataPath, 'models');
};
