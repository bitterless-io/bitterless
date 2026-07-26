import { reactive } from 'vue';
import { nanoid } from 'nanoid';
import { xpcRenderer } from 'electron-xpc/renderer';
import type {
  OmniPaneNode,
  OmniContentMode,
  OmniMiniAppId,
} from '../types/layout.types';
import {
  DEFAULT_OMNI_BROWSER_URL,
  DEFAULT_OMNI_MINI_APP_ID,
  OMNI_LAYOUT_RECOVERY_STATE_EVENT,
  OMNI_LAYOUT_SNAPSHOT_EVENT,
  OMNI_MINI_APP_DISPLAY_URLS,
  OMNI_MINI_APP_LOAD_STATE_EVENT,
  createDefaultOmniLayoutTree,
  isOmniMiniAppId,
  parseOmniLayoutConfig,
  parseOmniPaneTree,
} from '@shared/omni/omni.types';
import type { OmniLayoutRecoveryState } from '@shared/omni/omni.types';
import {
  removeOmniPaneTree,
  splitOmniPaneTree,
} from '@shared/omni/omniLayout.service';

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

class LayoutStore {
  tree: OmniPaneNode = createDefaultOmniLayoutTree();
  structureChanging = false;
  structureRevision = 0;
  layoutRecoveryError = false;
  miniAppLoadFailures: Record<string, OmniMiniAppId> = {};

  reset(): void {
    this.tree = createDefaultOmniLayoutTree();
    this.structureRevision += 1;
    this.miniAppLoadFailures = {};
  }

  splitPane(nodeId: string, direction: 'h' | 'v', position: 'before' | 'after' = 'after'): void {
    const result = splitOmniPaneTree(this.tree, nodeId, {
      direction,
      position,
      splitId: nanoid(),
      newLeaf: createLeaf(),
    });
    if (!result.changed || !result.tree) return;
    this.tree = result.tree;
    this.structureRevision += 1;
  }

  updateSizes(nodeId: string, sizes: number[]): boolean {
    const found = this.findNode(this.tree, nodeId);
    if (!found || found.type !== 'split') return false;
    if (sizes.length !== found.children?.length) return false;
    if (sizes.some((size) => !Number.isFinite(size) || size <= 0)) return false;
    found.sizes = [...sizes];
    return true;
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
    const result = removeOmniPaneTree(this.tree, nodeId);
    if (!result.changed) return;
    this.tree = result.tree ?? createLeaf();
    this.structureRevision += 1;
    this.clearMiniAppLoadFailure(nodeId);
  }

  async applyLayout(): Promise<void> {
    const tree = parseOmniPaneTree(this.tree);
    await xpcRenderer.send('OmniWindowHandler/updateLayout', { tree });
  }

  async syncLayout(): Promise<void> {
    const config = parseOmniLayoutConfig({ tree: this.tree });
    this.tree = config.tree;
    await xpcRenderer.send('OmniWindowHandler/commitLayout', { tree: config.tree });
  }

  async navigateCell(nodeId: string, url: string): Promise<void> {
    await xpcRenderer.send('OmniWindowHandler/navigateCell', { cellId: nodeId, url });
  }

  async loadLayout(): Promise<void> {
    try {
      const persistedValue = await xpcRenderer.send(
        'OmniWindowHandler/loadLayout',
      ) as unknown;
      if (persistedValue === null || persistedValue === undefined) return;
      this.replaceLayout(parseOmniLayoutConfig(persistedValue).tree);
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

  replaceLayout(tree: OmniPaneNode): void {
    if (this.structureChanging) return;
    this.tree = parseOmniPaneTree(tree);
    this.structureRevision += 1;
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

xpcRenderer.subscribe(OMNI_LAYOUT_SNAPSHOT_EVENT, (payload) => {
  try {
    layoutStore.replaceLayout(parseOmniLayoutConfig(payload.params).tree);
  } catch (error) {
    console.error('[Omni control] Ignored invalid Main layout snapshot:', error);
  }
});
