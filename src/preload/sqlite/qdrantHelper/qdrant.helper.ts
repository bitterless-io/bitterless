import { ipcRenderer } from 'electron';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';

let qdrantProcess: ChildProcess | null = null;

export const initQdrant = async (): Promise<void> => {
  const appPath = await ipcRenderer.invoke('bitterless:get-app-path');
  const dbPath = await ipcRenderer.invoke('bitterless:get-db-path');
  const qdrantBinary = join(appPath, process.env.VITE_QDRANT_PATH || 'external_resources/qdrant/qdrant');
  const storagePath = join(dbPath, 'memory');

  console.log('[qdrant] binary:', qdrantBinary);
  console.log('[qdrant] storage:', storagePath);

  qdrantProcess = spawn(qdrantBinary, [], {
    env: {
      ...process.env,
      QDRANT__SERVICE__HTTP_PORT: '12833',
      QDRANT__SERVICE__API_KEY: '123456',
      QDRANT__STORAGE__STORAGE_PATH: storagePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  qdrantProcess.stdout?.on('data', (data: Buffer) => {
    console.log('[qdrant]', data.toString().trim());
  });

  qdrantProcess.stderr?.on('data', (data: Buffer) => {
    console.error('[qdrant:err]', data.toString().trim());
  });

  qdrantProcess.on('error', (err) => {
    console.error('[qdrant] failed to start:', err.message);
  });

  qdrantProcess.on('exit', (code, signal) => {
    console.log(`[qdrant] exited with code=${code} signal=${signal}`);
    qdrantProcess = null;
  });

  window.addEventListener('beforeunload', () => {
    if (qdrantProcess) {
      console.log('[qdrant] killing process');
      qdrantProcess.kill('SIGTERM');
      qdrantProcess = null;
    }
  });

  console.log('[qdrant] process started, pid:', qdrantProcess.pid);
};

export const stopQdrant = (): void => {
  if (qdrantProcess) {
    console.log('[qdrant] killing process');
    qdrantProcess.kill('SIGTERM');
    qdrantProcess = null;
  }
};
