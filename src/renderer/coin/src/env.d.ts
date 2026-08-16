import type { TrenchHostContext } from '@shared/trench/trenchXpc.type';
import type { SnipingBridge } from '@shared/sniping/snipingBridge.type';
import type { MonitoringBridge } from '@shared/monitoring/monitoringBridge.type';

declare global {
  interface Window {
    readonly trenchHost: TrenchHostContext;
    readonly sniping: SnipingBridge;
    readonly monitoring: MonitoringBridge;
  }
}

export {};
