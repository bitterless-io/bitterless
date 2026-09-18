import type {
  OnlyPreviewApi,
  OnlyPreviewProjectEntry
} from '@shared/onlypreview/onlyPreview.types';
import {
  OnlyPreviewContractError,
  unwrapOnlyPreviewResult
} from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewCopyShortcutEvent } from './onlyPreviewCopyShortcut.service';

interface PasteHost {
  workspace: { workspaceId: string } | null;
  treeSelectedRelativePath: string | null;
  index: {
    entries: readonly { relativePath: string; nodeKind: 'file' | 'directory' | 'symlink' }[];
  } | null;
  errorMessage: string;
}

export const resolveOnlyPreviewPasteShortcut = (
  event: OnlyPreviewCopyShortcutEvent,
  context: { isMac: boolean; active: boolean; editing: boolean; targetIsEditable: boolean }
): boolean => {
  if (
    !context.active ||
    context.editing ||
    context.targetIsEditable ||
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.shiftKey ||
    event.altKey
  )
    return false;
  if (event.code !== 'KeyV' && event.key.toLowerCase() !== 'v') return false;
  return context.isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
};

export class OnlyPreviewProjectPasteController {
  busy = false;

  constructor(
    private readonly host: PasteHost,
    private readonly client: Pick<OnlyPreviewApi, 'pasteProjectItems'>,
    private readonly hostToken: string | null | undefined,
    private readonly reveal: (
      entries: OnlyPreviewProjectEntry[],
      workspaceId: string
    ) => Promise<void>,
    private readonly errorMessage: (error: unknown) => string,
    // Raising the alert-layer dialog. Injected rather than imported so this controller stays
    // testable without a client, exactly as `reveal` and `errorMessage` already are.
    private readonly showConflict: (message: string) => Promise<void> = async () => undefined
  ) {}

  async paste(): Promise<void> {
    const workspace = this.host.workspace;
    const selected = this.host.treeSelectedRelativePath;
    if (this.busy || !workspace || !this.hostToken || selected === null) return;
    const entry = this.host.index?.entries.find((item) => item.relativePath === selected);
    if (selected && (!entry || entry.nodeKind === 'symlink')) return;
    const parentRelativePath =
      entry?.nodeKind === 'file'
        ? selected.slice(0, Math.max(0, selected.lastIndexOf('/')))
        : selected;
    this.busy = true;
    try {
      const entries = unwrapOnlyPreviewResult(
        await this.client.pasteProjectItems({
          hostToken: this.hostToken,
          workspaceId: workspace.workspaceId,
          parentRelativePath
        })
      );
      if (this.host.workspace === workspace && entries.length) {
        await this.reveal(entries, workspace.workspaceId);
      }
    } catch (error) {
      if (this.host.workspace !== workspace) return;
      // A name conflict is an ordinary outcome of a deliberate paste, so it goes to the alert layer
      // — the same surface New Folder uses for the same code — and not to the Project rail's banner.
      // That banner is for index and runtime breakage, and it carries the Copy-detail button, which
      // would invite a bug report about a file that simply already exists.
      //
      // Everything else still lands on the banner: a refused workspace or a failed write IS
      // breakage, and Copy-detail is the right affordance for it.
      if (error instanceof OnlyPreviewContractError && error.code === 'NAME_EXISTS') {
        await this.showConflict(this.errorMessage(error));
        return;
      }
      this.host.errorMessage = this.errorMessage(error);
    } finally {
      this.busy = false;
    }
  }
}
