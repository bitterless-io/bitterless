import type { OmniPaneNode } from './omni.types';

export const OMNI_LAYOUT_DIVIDER_SIZE = 4;
export const OMNI_BROWSER_HEADER_HEIGHT = 36;

export interface OmniPixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OmniPixelCellBounds extends OmniPixelBounds {
  id: string;
  url: string;
}

export interface OmniTreeMutationResult {
  tree: OmniPaneNode | null;
  changed: boolean;
}

export interface OmniSplitPaneParams {
  direction: 'h' | 'v';
  position: 'before' | 'after';
  splitId: string;
  newLeaf: OmniPaneNode;
}

export class OmniLayoutCommitQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue(operation: () => Promise<void>): Promise<void> {
    const pending = this.tail.then(operation, operation);
    this.tail = pending.catch(() => undefined);
    return pending;
  }
}

const normalizeWeights = (weights: number[]): number[] => {
  if (weights.length === 0) return [];
  if (weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
    return weights.map(() => 100 / weights.length);
  }
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (weight / total) * 100);
};

export const splitOmniPaneTree = (
  node: OmniPaneNode,
  nodeId: string,
  params: OmniSplitPaneParams
): OmniTreeMutationResult => {
  if (node.type === 'leaf') {
    if (node.id !== nodeId) return { tree: node, changed: false };
    const children = params.position === 'before' ? [params.newLeaf, node] : [node, params.newLeaf];
    return {
      tree: {
        id: params.splitId,
        type: 'split',
        direction: params.direction,
        children,
        sizes: [50, 50]
      },
      changed: true
    };
  }

  const children = node.children ?? [];
  for (let index = 0; index < children.length; index++) {
    const result = splitOmniPaneTree(children[index], nodeId, params);
    if (!result.changed || !result.tree) continue;
    const nextChildren = [...children];
    nextChildren[index] = result.tree;
    return {
      tree: { ...node, children: nextChildren },
      changed: true
    };
  }
  return { tree: node, changed: false };
};

export const removeOmniPaneTree = (node: OmniPaneNode, nodeId: string): OmniTreeMutationResult => {
  if (node.type === 'leaf') {
    return node.id === nodeId ? { tree: null, changed: true } : { tree: node, changed: false };
  }

  const children = node.children ?? [];
  const sourceSizes =
    node.sizes?.length === children.length ? node.sizes : children.map(() => 100 / children.length);
  const nextChildren: OmniPaneNode[] = [];
  const nextWeights: number[] = [];
  let changed = false;

  for (let index = 0; index < children.length; index++) {
    const result = removeOmniPaneTree(children[index], nodeId);
    changed ||= result.changed;
    if (!result.tree) continue;
    nextChildren.push(result.tree);
    nextWeights.push(sourceSizes[index]);
  }

  if (!changed) return { tree: node, changed: false };
  if (nextChildren.length === 0) return { tree: null, changed: true };
  if (nextChildren.length === 1) return { tree: nextChildren[0], changed: true };

  return {
    tree: {
      ...node,
      children: nextChildren,
      sizes: normalizeWeights(nextWeights)
    },
    changed: true
  };
};

export const flattenOmniPaneTreePixels = (
  node: OmniPaneNode,
  bounds: OmniPixelBounds
): OmniPixelCellBounds[] => {
  if (node.type === 'leaf') {
    return [{ id: node.id, url: node.url ?? '', ...bounds }];
  }

  const children = node.children ?? [];
  if (children.length === 0) return [];
  const sourceSizes =
    node.sizes?.length === children.length ? node.sizes : children.map(() => 100 / children.length);
  const sizes = normalizeWeights(sourceSizes);
  const dividerSpace = (children.length - 1) * OMNI_LAYOUT_DIVIDER_SIZE;
  const results: OmniPixelCellBounds[] = [];

  if (node.direction === 'h') {
    const availableWidth = Math.max(bounds.width - dividerSpace, 0);
    let offsetX = bounds.x;
    for (let index = 0; index < children.length; index++) {
      const width =
        index === children.length - 1
          ? bounds.x + bounds.width - offsetX
          : Math.round((availableWidth * sizes[index]) / 100);
      results.push(
        ...flattenOmniPaneTreePixels(children[index], {
          x: offsetX,
          y: bounds.y,
          width,
          height: bounds.height
        })
      );
      offsetX += width + OMNI_LAYOUT_DIVIDER_SIZE;
    }
    return results;
  }

  const availableHeight = Math.max(bounds.height - dividerSpace, 0);
  let offsetY = bounds.y;
  for (let index = 0; index < children.length; index++) {
    const height =
      index === children.length - 1
        ? bounds.y + bounds.height - offsetY
        : Math.round((availableHeight * sizes[index]) / 100);
    results.push(
      ...flattenOmniPaneTreePixels(children[index], {
        x: bounds.x,
        y: offsetY,
        width: bounds.width,
        height
      })
    );
    offsetY += height + OMNI_LAYOUT_DIVIDER_SIZE;
  }
  return results;
};

export const resolveOmniCellViewBounds = (
  outerBounds: OmniPixelBounds,
  headerHeight: number
): { header: OmniPixelBounds | null; content: OmniPixelBounds } => {
  const width = Math.max(outerBounds.width, 0);
  const height = Math.max(outerBounds.height, 0);
  const inset = Math.min(Math.max(headerHeight, 0), height);
  const header = inset > 0 ? { x: outerBounds.x, y: outerBounds.y, width, height: inset } : null;
  return {
    header,
    content: {
      x: outerBounds.x,
      y: outerBounds.y + inset,
      width,
      height: height - inset
    }
  };
};
