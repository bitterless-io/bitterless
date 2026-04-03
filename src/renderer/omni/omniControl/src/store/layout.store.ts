import { reactive } from 'vue';
import { nanoid } from 'nanoid';
import { xpcRenderer } from 'electron-xpc/renderer';
import type { OmniPaneNode, OmniCellLayout, OmniLayoutConfig } from '../types/layout.types';

function createLeaf(url = 'https://www.bing.com'): OmniPaneNode {
  return { id: nanoid(), type: 'leaf', url };
}

function flattenTree(
  node: OmniPaneNode,
  x: number,
  y: number,
  width: number,
  height: number,
): OmniCellLayout[] {
  if (node.type === 'leaf') {
    return [{ id: node.id, url: node.url || '', x, y, width, height }];
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
}

class LayoutStore {
  tree: OmniPaneNode = createLeaf();
  splitting = false;

  reset(): void {
    this.tree = createLeaf();
  }

  splitPane(nodeId: string, direction: 'h' | 'v', position: 'before' | 'after' = 'after'): void {
    const found = this.findNode(this.tree, nodeId);
    if (!found || found.type !== 'leaf') return;

    const originalLeaf: OmniPaneNode = { id: found.id, type: 'leaf', url: found.url };
    const newLeaf = createLeaf();

    found.type = 'split';
    found.direction = direction;
    found.id = nanoid();
    found.children = position === 'before' ? [newLeaf, originalLeaf] : [originalLeaf, newLeaf];
    found.sizes = [50, 50];
    delete found.url;
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

  removePane(nodeId: string): void {
    const result = this.removeNodeFromTree(this.tree, nodeId);
    if (result === null) {
      this.tree = createLeaf();
    }
  }

  getFlatLayout(): OmniCellLayout[] {
    return flattenTree(this.tree, 0, 0, 100, 100);
  }

  async syncLayout(): Promise<void> {
    const cells = this.getFlatLayout();
    const tree: OmniPaneNode = JSON.parse(JSON.stringify(this.tree));
    const config: OmniLayoutConfig = { tree };
    await xpcRenderer.send('OmniWindowHandler/updateLayout', { cells, tree });
    await xpcRenderer.send('OmniWindowHandler/saveLayout', { config });
  }

  async navigateCell(nodeId: string, url: string): Promise<void> {
    await xpcRenderer.send('OmniWindowHandler/navigateCell', { cellId: nodeId, url });
  }

  async saveConfig(): Promise<void> {
    const config: OmniLayoutConfig = { tree: JSON.parse(JSON.stringify(this.tree)) };
    await xpcRenderer.send('OmniWindowHandler/saveLayout', { config });
  }

  async loadLayout(): Promise<void> {
    const config = await xpcRenderer.send('OmniWindowHandler/loadLayout') as OmniLayoutConfig | null;
    if (config && config.tree) {
      this.tree = config.tree;
    }
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
      const kept = this.removeNodeFromTree(child, id);
      if (kept !== null) newChildren.push(kept);
    }

    if (newChildren.length === 0) return null;

    // Only update children/sizes when a direct child was removed
    // (avoids mutating grandparent sizes for deeper removals)
    if (newChildren.length !== origCount) {
      node.children = newChildren;
      node.sizes = newChildren.map(() => 100 / newChildren.length);
    }
    return node;
  }
}

export const layoutStore = reactive(new LayoutStore()) as LayoutStore;

xpcRenderer.subscribe('omniControl/cellUrlChanged', (payload) => {
  const data = payload.params as { cellId: string; url: string };
  layoutStore.updateUrl(data.cellId, data.url);
  layoutStore.saveConfig();
});
