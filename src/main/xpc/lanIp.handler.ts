// VENDORED FILE — bitterless is the source; micromeet-cowork only receives. See lanIp.helper.ts.
//
// Registration is a pure construction side effect: the module-scope `new` registers
// `xpc:LanIpHandler/state` and `xpc:LanIpHandler/refresh`. The class name is identical in both
// repos so the renderer emitter string is identical too.
import { XpcMainHandler } from 'electron-xpc/main';
import { readLanIpState, refreshLanIp } from '@main/lanIp/lanIp.service';
import type { LanIpApi, LanIpv4Snapshot } from '@shared/lanIp/lanIp.api';

export class LanIpHandler extends XpcMainHandler implements LanIpApi {
  async state(): Promise<LanIpv4Snapshot> {
    return readLanIpState();
  }

  async refresh(): Promise<LanIpv4Snapshot> {
    return refreshLanIp();
  }
}

export const lanIpHandler = new LanIpHandler();
