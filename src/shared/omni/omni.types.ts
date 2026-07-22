export type OmniContentMode = 'browser' | 'miniapp';

export const OMNI_MINI_APP_IDS = ['todo', 'eyesOnAgents', 'translator'] as const;
export type OmniMiniAppId = (typeof OMNI_MINI_APP_IDS)[number];

export const DEFAULT_OMNI_MINI_APP_ID: OmniMiniAppId = 'todo';

export const OMNI_MINI_APP_DISPLAY_URLS: Record<OmniMiniAppId, string> = {
  todo: 'bl://miniapp/todo',
  eyesOnAgents: 'bl://miniapp/eyes-on-agents',
  translator: 'bl://miniapp/translator'
};

export const isOmniMiniAppId = (value: unknown): value is OmniMiniAppId =>
  typeof value === 'string' && (OMNI_MINI_APP_IDS as readonly string[]).includes(value);

export const parseOmniMiniAppId = (value: unknown): OmniMiniAppId => {
  if (isOmniMiniAppId(value)) return value;
  throw new Error(`Unsupported Omni mini app: ${String(value)}`);
};

export interface OmniPaneNode {
  id: string;
  type: 'leaf' | 'split';
  url?: string;
  contentMode?: OmniContentMode;
  miniAppId?: OmniMiniAppId;
  direction?: 'h' | 'v';
  children?: OmniPaneNode[];
  sizes?: number[];
}

export interface OmniCellLayout {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  contentMode: OmniContentMode;
  miniAppId: OmniMiniAppId;
}

export interface OmniLayoutConfig {
  tree: OmniPaneNode;
}
