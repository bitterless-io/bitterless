import { app } from 'electron';
import { join } from 'node:path';
import { CoinXBrowserService } from './coinXBrowser.service';

export const coinXBrowserService = new CoinXBrowserService({
  getUserDataDir: () => join(app.getPath('userData'), 'coin', 'x-research-profile'),
  cdpEndpoint: process.env.BITTERLESS_TRENCH_CHROME_CDP_URL,
});
