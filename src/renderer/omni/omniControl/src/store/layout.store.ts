import { reactive } from 'vue';
import { nanoid } from 'nanoid';
import { xpcRenderer } from 'electron-xpc/renderer';
import type {
  OmniPaneNode,
  OmniCellLayout,
  OmniContentMode,
  OmniMiniAppId,
} from '../types/layout.types';
import {
  DEFAULT_OMNI_BROWSER_URL,
  DEFAULT_OMNI_MINI_APP_ID,
  OMNI_LAYOUT_RECOVERY_STATE_EVENT,
  OMNI_MINI_APP_DISPLAY_URLS,
  OMNI_MINI_APP_LOAD_STATE_EVENT,
  createDefaultOmniLayoutTree,
  isOmniMiniAppId,
  parseOmniLayoutConfig,
  parseOmniPaneTree,
} from '@shared/omni/omni.types';
import type { OmniLayoutRecoveryState } from '@shared/omni/omni.types';

const createLeaf = (
  url = DEFAULT_OMNI_BROWSER_URL,
  id = nanoid(),
): OmniPaneNode => ({
  id,
  type: 'leaf',
  url,
  contentMode: 'browser',
  miniAppId: DEFAULT_OMNI_MINI_APP_ID,
});

export const getNodeContentMode = (node: OmniPaneNode): OmniContentMode =>
  node.contentMode ?? 'browser';

export const getNodeDisplayUrl = (node: OmniPaneNode): string =>
  getNodeContentMode(node) === 'browser'
    ? node.url ?? DEFAULT_OMNI_BROWSER_URL
    : OMNI_MINI_APP_DISPLAY_URLS[node.miniAppId ?? DEFAULT_OMNI_MINI_APP_ID];

const flattenTree = (
  node: OmniPaneNode,
  x: number,
  y: number,
  width: number,
  height: number,
): OmniCellLayout[] => {
  if (node.type === 'leaf') {
    return [{
      id: node.id,
      url: node.url || '',
      x,
      y,
      width,
      height,
      contentMode: node.contentMode!,
      miniAppId: node.miniAppId!,
    }];
  }

  const results: OmniCellLayout[] = [];
  const children = node.children || [];
  const sizes = node.sizes || children.map(() => 100 / children.length);
  let offset = 0;

  for (let i = 0; i < children.length; i++) {
    const size = sizes[i];
    let cx: number, cy: number, cw: number, ch: number;

    if (node.direction === 'h') {
      cx = x + (width * offset) / 100;
      cy = y;
      cw = (width * size) / 100;
      ch = height;
    } else {
      cx = x;
      cy = y + (height * offset) / 100;
      cw = width;
      ch = (height * size) / 100;
    }

    results.push(...flattenTree(children[i], cx, cy, cw, ch));
    offset += size;
  }

  return results;
};

class LayoutStore {
  tree: OmniPaneNode = createDefaultOmniLayoutTree();
  splitting = false;
  layoutRecoveryError = false;
  miniAppLoadFailures: Record<string, OmniMiniAppId> = {};

  reset(): void {
    this.tree = createDefaultOmniLayoutTree();
    this.miniAppLoadFailures = {};
  }

  splitPane(nodeId: string, direction: 'h' | 'v', position: 'before' | 'after' = 'after'): void {
    const found = this.findNode(this.tree, nodeId);
    if (!found || found.type !== 'leaf') return;

    const originalLeaf: OmniPaneNode = {
      id: found.id,
      type: 'leaf',
      url: found.url,
      contentMode: getNodeContentMode(found),
      miniAppId: found.miniAppId ?? DEFAULT_OMNI_MINI_APP_ID,
    };
    const newLeaf = createLeaf();

    found.type = 'split';
    found.direction = direction;
    found.id = nanoid();
    found.children = position === 'before' ? [newLeaf, originalLeaf] : [originalLeaf, newLeaf];
    found.sizes = [50, 50];
    delete found.url;
    delete found.contentMode;
    delete found.miniAppId;
  }

  updateSizes(nodeId: string, sizes: number[]): void {
    const found = this.findNode(this.tree, nodeId);
    if (!found || found.type !== 'split') return;
    found.sizes = sizes;
  }

  updateUrl(nodeId: string, url: string): void {
    const found = this.findNode(this.tree, nodeId);
    if (!found || found.type !== 'leaf') return;
    found.url = url;
  }

  updateContentMode(nodeId: string, contentMode: OmniContentMode): void {
    const found = this.findNode(this.tree, nodeId);
    if (!found || found.type !== 'leaf') return;
    found.contentMode = contentMode;
    found.miniAppId = found.miniAppId ?? DEFAULT_OMNI_MINI_APP_ID;
    this.clearMiniAppLoadFailure(nodeId);
  }

  updateMiniApp(nodeId: string, miniAppId: OmniMiniAppId): void {
    const found = this.findNode(this.tree, nodeId);
    if (!found || found.type !== 'leaf') return;
    found.contentMode = 'miniapp';
    found.miniAppId = miniAppId;
    this.clearMiniAppLoadFailure(nodeId);
  }

  removePane(nodeId: string): void {
    const result = this.removeNodeFromTree(this.tree, nodeId);
    if (result === null) {
      this.tree = createLeaf();
    } else {
      this.tree = result;
    }
    this.clearMiniAppLoadFailure(nodeId);
  }

  async applyLayout(): Promise<void> {
    const tree = parseOmniPaneTree(this.tree);
    this.tree = tree;
    const cells = flattenTree(tree, 0, 0, 100, 100);
    await xpcRenderer.send('OmniWindowHandler/updateLayout', { cells, tree });
  }

  async syncLayout(): Promise<void> {
    const config = parseOmniLayoutConfig({ tree: this.tree });
    this.tree = config.tree;
    const cells = flattenTree(config.tree, 0, 0, 100, 100);
    const tree = config.tree;
    await xpcRenderer.send('OmniWindowHandler/updateLayout', { cells, tree });
    await xpcRenderer.send('OmniWindowHandler/saveLayout', { config });
  }

  async navigateCell(nodeId: string, url: string): Promise<void> {
    await xpcRenderer.send('OmniWindowHandler/navigateCell', { cellId: nodeId, url });
  }

  async saveConfig(): Promise<void> {
    const config = parseOmniLayoutConfig({ tree: this.tree });
    this.tree = config.tree;
    await xpcRenderer.send('OmniWindowHandler/saveLayout', { config });
  }

  async loadLayout(): Promise<void> {
    try {
      const persistedValue = await xpcRenderer.send(
        'OmniWindowHandler/loadLayout',
      ) as unknown;
      if (persistedValue === null || persistedValue === undefined) return;
      this.tree = parseOmniLayoutConfig(persistedValue).tree;
    } catch (error) {
      console.error('[Omni control] Failed to restore saved layout:', error);
      this.reset();
      this.layoutRecoveryError = true;
    }
  }

  getMiniAppLoadFailure(nodeId: string): OmniMiniAppId | null {
    return this.miniAppLoadFailures[nodeId] ?? null;
  }

  setMiniAppLoadState(params: {
    cellId: string;
    miniAppId: OmniMiniAppId;
    status: 'ready' | 'failed';
  }): void {
    if (params.status === 'ready') {
      this.clearMiniAppLoadFailure(params.cellId);
      return;
    }
    this.miniAppLoadFailures = {
      ...this.miniAppLoadFailures,
      [params.cellId]: params.miniAppId,
    };
  }

  setLayoutRecoveryState(params: OmniLayoutRecoveryState): void {
    if (params.recoveredFromInvalidLayout) this.reset();
    this.layoutRecoveryError = params.recoveredFromInvalidLayout;
  }

  private clearMiniAppLoadFailure(nodeId: string): void {
    if (!(nodeId in this.miniAppLoadFailures)) return;
    const nextFailures = { ...this.miniAppLoadFailures };
    delete nextFailures[nodeId];
    this.miniAppLoadFailures = nextFailures;
  }

  private findNode(node: OmniPaneNode, id: string): OmniPaneNode | null {
    if (node.id === id) return node;
    if (node.children) {
      for (const child of node.children) {
        const result = this.findNode(child, id);
        if (result) return result;
      }
    }
    return null;
  }

  private removeNodeFromTree(node: OmniPaneNode, id: string): OmniPaneNode | null {
    if (node.type === 'leaf') {
      return node.id === id ? null : node;
    }

    const origCount = (node.children || []).length;
    const newChildren: OmniPaneNode[] = [];
    for (const child of node.children || []) {
      let kept: OmniPaneNode | null = null;
      kept = this.removeNodeFromTree(child, id);
      if (kept !== null) newChildren.push(kept);
    }


    if (newChildren?.length === 0) return null;

    // Collapse: promote the single remaining child upward
    if (newChildren?.length === 1) {
      return newChildren[0];
    }

    node.children = newChildren;
    if (newChildren.length !== origCount) {
      node.sizes = newChildren.map(() => 100 / newChildren.length);
    }
    return node;
  }
}

export const layoutStore = reactive(new LayoutStore()) as LayoutStore;

xpcRenderer.subscribe('omniControl/cellUrlChanged', (payload) => {
  const data = payload.params as { cellId: string; url: string };
  layoutStore.updateUrl(data.cellId, data.url);
  // saveConfig() removed — main process already persists via throttledSaveLayoutToDao
});

xpcRenderer.subscribe(OMNI_MINI_APP_LOAD_STATE_EVENT, (payload) => {
  const params = payload.params as {
    cellId?: unknown;
    miniAppId?: unknown;
    status?: unknown;
  };
  if (
    typeof params.cellId !== 'string' ||
    !isOmniMiniAppId(params.miniAppId) ||
    (params.status !== 'ready' && params.status !== 'failed')
  ) return;
  layoutStore.setMiniAppLoadState({
    cellId: params.cellId,
    miniAppId: params.miniAppId,
    status: params.status,
  });
});

xpcRenderer.subscribe(OMNI_LAYOUT_RECOVERY_STATE_EVENT, (payload) => {
  const params = payload.params as { recoveredFromInvalidLayout?: unknown };
  if (typeof params.recoveredFromInvalidLayout !== 'boolean') return;
  layoutStore.setLayoutRecoveryState({
    recoveredFromInvalidLayout: params.recoveredFromInvalidLayout,
  });
});
