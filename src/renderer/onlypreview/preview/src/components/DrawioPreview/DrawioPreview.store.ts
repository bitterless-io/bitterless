import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  renderOnlyPreviewDrawio,
  type OnlyPreviewDrawioContent,
  type OnlyPreviewDrawioViewerHandle
} from '../../onlyPreviewDrawio.service';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';

export class DrawioPreviewStore {
  private viewerHandle: OnlyPreviewDrawioViewerHandle | null = null;
  private mountAbortController: AbortController | null = null;
  private generation = 0;

  async mount(
    element: HTMLElement,
    content: OnlyPreviewDrawioContent,
    reportingRevision: string
  ): Promise<void> {
    const generation = ++this.generation;
    this.mountAbortController?.abort();
    const abortController = new AbortController();
    this.mountAbortController = abortController;
    this.viewerHandle?.dispose();
    this.viewerHandle = null;
    try {
      const handle = await renderOnlyPreviewDrawio(element, content, {
        signal: abortController.signal
      });
      if (generation !== this.generation) {
        handle.dispose();
        return;
      }
      this.viewerHandle = handle;
      onlyPreviewPreviewStore.reportSurfaceReady(reportingRevision);
    } catch (error) {
      if (generation !== this.generation) return;
      onlyPreviewPreviewStore.reportSurfaceError(
        reportingRevision,
        error instanceof OnlyPreviewContractError ? error.code : 'DIAGRAM_PARSE_FAILED'
      );
    } finally {
      if (this.mountAbortController === abortController) this.mountAbortController = null;
    }
  }

  dispose(): void {
    this.generation += 1;
    this.mountAbortController?.abort();
    this.mountAbortController = null;
    this.viewerHandle?.dispose();
    this.viewerHandle = null;
  }
}
