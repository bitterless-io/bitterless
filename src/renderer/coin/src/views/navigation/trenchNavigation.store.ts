import type { TrenchChain } from '@shared/trench/trench.type';

export const TRENCH_NAVIGATION_KEYS = [
  'index:solana',
  'index:bsc',
  'index:robinhood',
  'trenchers:all',
  'sniping:products',
  'sniping:activity',
  'monitoring:watches',
  'monitoring:anomalies',
] as const;

export type TrenchNavigationKey = (typeof TRENCH_NAVIGATION_KEYS)[number];

interface TrenchNavigationSelectionOwner {
  select(key: string): void;
}

export const createTrenchNavigationMenuItemHandler = (
  navigation: TrenchNavigationSelectionOwner,
): ((key: string) => void) => (key) => navigation.select(key);

export class TrenchNavigationStore {
  selectedKey: TrenchNavigationKey = 'index:solana';

  get module(): 'index' | 'trenchers' | 'sniping' | 'monitoring' {
    if (this.selectedKey.startsWith('index:')) return 'index';
    if (this.selectedKey.startsWith('sniping:')) return 'sniping';
    return this.selectedKey.startsWith('monitoring:') ? 'monitoring' : 'trenchers';
  }

  get selectedChain(): TrenchChain {
    if (this.module !== 'index') return 'solana';
    return this.selectedKey.slice('index:'.length) as TrenchChain;
  }

  get snipingScope(): 'products' | 'activity' {
    return this.selectedKey === 'sniping:activity' ? 'activity' : 'products';
  }

  get monitoringScope(): 'watches' | 'anomalies' {
    return this.selectedKey === 'monitoring:anomalies' ? 'anomalies' : 'watches';
  }

  select(key: string): void {
    if (!TRENCH_NAVIGATION_KEYS.includes(key as TrenchNavigationKey)) return;
    this.selectedKey = key as TrenchNavigationKey;
  }
}
