export interface OmniPaneNode {
  id: string;
  type: 'leaf' | 'split';
  url?: string;
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
}

export interface OmniLayoutConfig {
  tree: OmniPaneNode;
}
