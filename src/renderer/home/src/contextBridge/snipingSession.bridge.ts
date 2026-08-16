import type { SnipingSessionBridge } from '@shared/sniping/snipingSession.type';

export const snipingSessionBridge = (globalThis as unknown as { snipingSession: SnipingSessionBridge })
  .snipingSession;
