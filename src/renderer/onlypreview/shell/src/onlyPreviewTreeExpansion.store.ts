import type { OnlyPreviewShellStore } from './onlyPreviewShell.store';
import { getOnlyPreviewParentPath } from './onlyPreviewTree.service';

export class OnlyPreviewTreeExpansionStore {
  revision = 0;
  private suppressedSelection: string | null = null;

  collapse(
    owner: Pick<
      OnlyPreviewShellStore,
      'workspace' | 'index' | 'selectedRelativePath' | 'expandedPaths'
    >
  ): void {
    if (!owner.workspace || !owner.index) return;
    this.suppressedSelection = owner.selectedRelativePath;
    this.revision += 1;
    owner.expandedPaths.clear();
    owner.expandedPaths.add('');
  }

  reset(): void {
    this.suppressedSelection = null;
    this.revision += 1;
  }

  expandSelectedParents(owner: OnlyPreviewShellStore, explicit = false): void {
    if (explicit) this.suppressedSelection = null;
    if (this.suppressedSelection === owner.selectedRelativePath) return;
    // **项目根目录的路径是空串,所以它必须显式加。** 下面的 `while (current)` 会在到达根之前
    // 就退出,于是根一直不在 `expandedPaths` 里;而 `onlyPreviewTree.service.ts` 是靠
    // `expandedPaths.has('')` 决定根下的子节点渲不渲染的。根被收起时,定位于是什么都看不见
    // (Ral 2026-09-22:「当 project 根目录都是非展开状态时,点击文件在目录列表中的定位,无效」)。
    // 根下的直属文件更彻底:第一个父路径就是空串,循环体一次都不执行。
    //
    // **只在 explicit 时加。** 这个函数有六个调用点,其余四个是后台后果(watch commit 把选中
    // 继承到新路径、工作区投影刷新)。从那些地方强行展开根,会去推翻用户自己收起根的选择,而且
    // 没有必要 —— 它们只需要把展开集合留成正确的,等用户重新打开根时自然生效。只有"定位到这个
    // 文件"是用户明确要求看见它,那时根必须打开。
    if (explicit) owner.expandedPaths.add('');
    let current = getOnlyPreviewParentPath(owner.selectedRelativePath);
    while (current) {
      owner.expandedPaths.add(current);
      current = getOnlyPreviewParentPath(current);
    }
  }

  async locate(owner: OnlyPreviewShellStore, loadParents: () => Promise<void>): Promise<string> {
    if (!owner.selectedRelativePath) return '';
    const revision = this.revision;
    owner.collapseTreeSelection();
    owner.treeSelectedRelativePath = owner.selectedRelativePath;
    this.expandSelectedParents(owner, true);
    await loadParents();
    if (revision !== this.revision || !owner.selectedEntry) return '';
    owner.focusedRelativePath = owner.selectedEntry.relativePath;
    return owner.focusedRelativePath;
  }
}
