import { app, net } from 'electron';
import { WebSocket } from 'undici';
import {
  coinGmgnCliService,
  coinServiceEndpointService,
} from '../resources/coinResource.runtime';
import { CoinStateService } from '../state/coinState.service';
import { CoinDataService, type CoinWebSocketPort } from './coinData.service';
import { CoinHttpClient } from './coinHttp.client';

const http = new CoinHttpClient(async (url, init) => {
  const response = await net.fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    text: async () => await response.text(),
  };
});

export const coinStateService = new CoinStateService({
  userDataRoot: () => app.getPath('userData'),
});

export const coinDataService = new CoinDataService({
  http,
  services: coinServiceEndpointService,
  gmgn: coinGmgnCliService,
  createWebSocket: (url) => new WebSocket(url) as unknown as CoinWebSocketPort,
});
