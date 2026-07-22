export type OmniContentMode = 'browser' | 'miniapp';
export type OmniMiniAppId = 'todo' | 'eyesOnAgents';

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
