import type { TrenchHostContext } from '@shared/trench/trenchXpc.type';

declare global {
  interface Window {
    readonly trenchHost: TrenchHostContext;
  }
}

export {};
