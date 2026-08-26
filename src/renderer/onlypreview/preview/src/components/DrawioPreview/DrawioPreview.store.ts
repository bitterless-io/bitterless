import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  renderOnlyPreviewDrawio,
  type OnlyPreviewDrawioContent,
  type OnlyPreviewDrawioViewerHandle
} from '../../onlyPreviewDrawio.service';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';

export class DrawioPreviewStore {
  private viewerHandle: OnlyPreviewDrawioViewerHandle | null = null;
  private generation = 0;

  async mount(
    element: HTMLElement,
    content: OnlyPreviewDrawioContent,
    reportingRevision: string
  ): Promise<void> {
    const generation = ++this.generation;
    this.viewerHandle?.dispose();
    this.viewerHandle = null;
    try {
      const handle = await renderOnlyPreviewDrawio(element, content);
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
    }
  }

  dispose(): void {
    this.generation += 1;
    this.viewerHandle?.dispose();
    this.viewerHandle = null;
  }
}
