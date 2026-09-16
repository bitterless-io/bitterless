// VENDORED FILE — bitterless is the source; micromeet-cowork only receives. See lanIp.helper.ts.
//
// The xpc contract for the LAN address row. Renderer types off THIS file, never off the handler
// class, so no renderer→main import exists. Both methods take ZERO parameters, comfortably inside
// electron-xpc's `AssertSingleParam` (2+ parameters map to `never`). There is no broadcast channel:
// a LAN address is pulled, never pushed.
import type { LanIpv4Snapshot } from './lanIp.helper';

export type { LanIpv4Candidate, LanIpv4Snapshot } from './lanIp.helper';

export interface LanIpApi {
  state(): Promise<LanIpv4Snapshot>;
  refresh(): Promise<LanIpv4Snapshot>;
}
