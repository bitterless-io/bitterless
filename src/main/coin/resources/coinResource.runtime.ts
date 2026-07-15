import { app, net, safeStorage, shell } from 'electron';
import { homedir } from 'node:os';
import { codexCredentialService } from '@main/codex/codexCredential.runtime';
import { AlchemyResourceService } from './alchemyResource.service';
import { CoinResourceService } from './coinResource.service';
import { runCoinProcess } from './coinProcess.runner';
import { GmgnCliService } from './gmgnCli.service';
import { CoinResourceSecretStore } from './resourceSecret.store';
import { ServiceEndpointService } from './serviceEndpoint.service';
import { ServiceEndpointStore } from './serviceEndpoint.store';

const allowLoopback = process.env.BITTERLESS_E2E === '1' && !app.isPackaged;

const secretStore = new CoinResourceSecretStore(
  () => app.getPath('userData'),
  {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (value) => safeStorage.decryptString(value),
  },
);

const MAX_RPC_RESPONSE_BYTES = 1024 * 1024;

export const coinAlchemyResourceService = new AlchemyResourceService({
  store: secretStore,
  allowLoopback,
  requestJsonRpc: async ({ url, body, signal }) => {
    const response = await net.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RPC_RESPONSE_BYTES) {
      throw new Error('Alchemy response exceeded the bounded read limit.');
    }
    return { status: response.status, body: JSON.parse(text) as unknown };
  },
});

export const coinGmgnCliService = new GmgnCliService({
  homeDir: homedir,
  processEnv: () => process.env,
  platform: process.platform,
  runProcess: runCoinProcess,
  openExternal: async (url) => await shell.openExternal(url),
});

export const coinServiceEndpointService = new ServiceEndpointService({
  store: new ServiceEndpointStore(() => app.getPath('userData')),
  runtimeEnv: () => process.env,
  allowLoopback,
});

export const coinResourceService = new CoinResourceService({
  codex: codexCredentialService,
  gmgn: coinGmgnCliService,
  alchemy: coinAlchemyResourceService,
  services: coinServiceEndpointService,
});
