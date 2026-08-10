export const OMNI_CONTENT_MODES = ['browser', 'miniapp'] as const;
export type OmniContentMode = (typeof OMNI_CONTENT_MODES)[number];

export const isOmniContentMode = (value: unknown): value is OmniContentMode =>
  typeof value === 'string' && (OMNI_CONTENT_MODES as readonly string[]).includes(value);

export const parseOmniContentMode = (value: unknown): OmniContentMode => {
  if (isOmniContentMode(value)) return value;
  throw new Error(`Unsupported Omni content mode: ${String(value)}`);
};

export const OMNI_MINI_APP_IDS = [
  'todo',
  'eyesOnAgents',
  'translator',
  'motto',
  'trench',
] as const;
export type OmniMiniAppId = (typeof OMNI_MINI_APP_IDS)[number];

export const DEFAULT_OMNI_MINI_APP_ID: OmniMiniAppId = 'todo';
export const DEFAULT_OMNI_BROWSER_CELL_ID = 'omni-default-browser' as const;
export const DEFAULT_OMNI_BROWSER_URL = 'https://www.bing.com' as const;

export const OMNI_LAYOUT_MAX_DEPTH = 12;
export const OMNI_LAYOUT_MAX_NODES = 128;
export const OMNI_LAYOUT_MAX_ID_LENGTH = 128;
export const OMNI_LAYOUT_MAX_URL_LENGTH = 8_192;

export const OMNI_MINI_APP_LOAD_STATE_EVENT = 'omniControl/miniAppLoadState' as const;
export const OMNI_LAYOUT_RECOVERY_STATE_EVENT = 'omniControl/layoutRecoveryState' as const;
export const OMNI_LAYOUT_SNAPSHOT_EVENT = 'omniControl/layoutSnapshot' as const;
export const OMNI_CONTROL_VISIBILITY_EVENT = 'omniWindow/controlVisibility' as const;

export interface OmniMiniAppLoadState {
  cellId: string;
  miniAppId: OmniMiniAppId;
  status: 'ready' | 'failed';
}

export interface OmniLayoutRecoveryState {
  recoveredFromInvalidLayout: boolean;
}

export const OMNI_MINI_APP_DISPLAY_URLS: Record<OmniMiniAppId, string> = {
  todo: 'bl://miniapp/todo',
  eyesOnAgents: 'bl://miniapp/eyes-on-agents',
  translator: 'bl://miniapp/translator',
  motto: 'bl://miniapp/motto',
  trench: 'bl://miniapp/trench',
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

interface OmniLayoutParserContext {
  nodeCount: number;
  nodeIds: Set<string>;
}

const expectObject = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid Omni layout at ${path}: expected an object`);
  }
  return value as Record<string, unknown>;
};

const normalizeNodeId = (
  value: unknown,
  path: string,
  context: OmniLayoutParserContext,
): string => {
  if (typeof value !== 'string') {
    throw new Error(`Invalid Omni layout at ${path}: expected a string ID`);
  }
  const id = value.trim();
  const length = Array.from(id).length;
  if (length === 0 || length > OMNI_LAYOUT_MAX_ID_LENGTH) {
    throw new Error(
      `Invalid Omni layout at ${path}: ID length must be 1-${OMNI_LAYOUT_MAX_ID_LENGTH}`,
    );
  }
  if (context.nodeIds.has(id)) {
    throw new Error(`Invalid Omni layout at ${path}: duplicate node ID`);
  }
  context.nodeIds.add(id);
  return id;
};

const normalizeUrl = (value: unknown, path: string): string => {
  // Early browser-only layouts allowed the leaf URL field to be absent.
  if (value === undefined) return DEFAULT_OMNI_BROWSER_URL;
  if (typeof value !== 'string') {
    throw new Error(`Invalid Omni layout at ${path}: expected a URL string`);
  }
  const url = value.trim();
  const length = Array.from(url).length;
  if (length === 0 || length > OMNI_LAYOUT_MAX_URL_LENGTH) {
    throw new Error(
      `Invalid Omni layout at ${path}: URL length must be 1-${OMNI_LAYOUT_MAX_URL_LENGTH}`,
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid Omni layout at ${path}: malformed URL`);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Invalid Omni layout at ${path}: unsupported URL protocol`);
  }
  return url;
};

const normalizeSizes = (
  value: unknown,
  childCount: number,
  path: string,
): number[] => {
  if (value === undefined) {
    return Array.from({ length: childCount }, () => 100 / childCount);
  }
  if (!Array.isArray(value) || value.length !== childCount) {
    throw new Error(`Invalid Omni layout at ${path}: sizes must match child count`);
  }

  const sizes = value.map((size, index) => {
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
      throw new Error(
        `Invalid Omni layout at ${path}[${index}]: size must be finite and positive`,
      );
    }
    return size;
  });
  const largestSize = Math.max(...sizes);
  const scaledSizes = sizes.map((size) => size / largestSize);
  const scaledTotal = scaledSizes.reduce((total, size) => total + size, 0);
  const normalizedSizes = scaledSizes.map((size) => (size / scaledTotal) * 100);
  if (normalizedSizes.some((size) => !Number.isFinite(size) || size <= 0)) {
    throw new Error(`Invalid Omni layout at ${path}: sizes cannot be normalized`);
  }
  return normalizedSizes;
};

const parseOmniPaneNode = (
  value: unknown,
  path: string,
  depth: number,
  context: OmniLayoutParserContext,
): OmniPaneNode => {
  if (depth > OMNI_LAYOUT_MAX_DEPTH) {
    throw new Error(
      `Invalid Omni layout at ${path}: depth exceeds ${OMNI_LAYOUT_MAX_DEPTH}`,
    );
  }
  context.nodeCount += 1;
  if (context.nodeCount > OMNI_LAYOUT_MAX_NODES) {
    throw new Error(`Invalid Omni layout: node count exceeds ${OMNI_LAYOUT_MAX_NODES}`);
  }

  const node = expectObject(value, path);
  const id = normalizeNodeId(node.id, `${path}.id`, context);

  if (node.type === 'leaf') {
    const contentMode = node.contentMode === undefined
      ? 'browser'
      : parseOmniContentMode(node.contentMode);
    const miniAppId = node.miniAppId === undefined
      ? DEFAULT_OMNI_MINI_APP_ID
      : parseOmniMiniAppId(node.miniAppId);
    return {
      id,
      type: 'leaf',
      url: normalizeUrl(node.url, `${path}.url`),
      contentMode,
      miniAppId,
    };
  }

  if (node.type === 'split') {
    if (node.direction !== 'h' && node.direction !== 'v') {
      throw new Error(`Invalid Omni layout at ${path}.direction: expected h or v`);
    }
    if (!Array.isArray(node.children) || node.children.length < 2) {
      throw new Error(`Invalid Omni layout at ${path}.children: expected at least two nodes`);
    }
    const children = node.children.map((child, index) => parseOmniPaneNode(
      child,
      `${path}.children[${index}]`,
      depth + 1,
      context,
    ));
    return {
      id,
      type: 'split',
      direction: node.direction,
      children,
      sizes: normalizeSizes(node.sizes, children.length, `${path}.sizes`),
    };
  }

  throw new Error(`Invalid Omni layout at ${path}.type: expected leaf or split`);
};

export const parseOmniPaneTree = (value: unknown): OmniPaneNode => parseOmniPaneNode(
  value,
  'tree',
  0,
  { nodeCount: 0, nodeIds: new Set<string>() },
);

export const parseOmniLayoutConfig = (value: unknown): OmniLayoutConfig => {
  const config = expectObject(value, 'config');
  return { tree: parseOmniPaneTree(config.tree) };
};

export const createDefaultOmniLayoutTree = (): OmniPaneNode => ({
  id: DEFAULT_OMNI_BROWSER_CELL_ID,
  type: 'leaf',
  url: DEFAULT_OMNI_BROWSER_URL,
  contentMode: 'browser',
  miniAppId: DEFAULT_OMNI_MINI_APP_ID,
});
