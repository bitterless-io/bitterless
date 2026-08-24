import { markRaw, reactive } from 'vue';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewErrorCode } from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewFindAdapterBridge } from '../../onlyPreviewFindAdapter.service';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';
import type { OnlyPreviewSheetSessionApi } from '../../onlyPreviewSheet.service';
import {
  createOnlyPreviewSheetAxis,
  getOnlyPreviewSheetAxisOffset,
  getOnlyPreviewSheetVirtualRange,
  type OnlyPreviewSheetAxis
} from '../../onlyPreviewSheetViewport.service';
import type {
  OnlyPreviewSheetLayout,
  OnlyPreviewSheetManifest,
  OnlyPreviewSheetSearchResult,
  OnlyPreviewSheetSearchTarget,
  OnlyPreviewSheetViewport
} from '../../workers/onlyPreviewSheetWorker.contract';

export interface OnlyPreviewSheetViewportMetrics {
  scrollLeft: number;
  scrollTop: number;
  width: number;
  height: number;
}

export interface OnlyPreviewSheetPreviewHooks {
  getViewportMetrics(): OnlyPreviewSheetViewportMetrics | null;
  prepareViewport(): Promise<void>;
  afterViewportInstall(): Promise<void>;
  scrollToCell(left: number, top: number): boolean;
  reportReady(): void;
}

export interface OnlyPreviewSheetPreviewStoreOptions {
  session: OnlyPreviewSheetSessionApi;
  manifest: OnlyPreviewSheetManifest;
  reportingRevision: string;
  hooks: OnlyPreviewSheetPreviewHooks;
}

interface ViewportRequestCoordinator {
  sheetId: number;
  sheetGeneration: number;
  viewportGeneration: number;
  requestedVersion: number;
  running: boolean;
  promise: Promise<boolean>;
}

const errorCodeFor = (error: unknown): OnlyPreviewErrorCode =>
  error instanceof OnlyPreviewContractError ? error.code : 'SHEET_PARSE_FAILED';

export class OnlyPreviewSheetPreviewStoreController {
  readonly manifest: OnlyPreviewSheetManifest;
  activeSheetId: number;
  layout: OnlyPreviewSheetLayout | null = null;
  viewport: OnlyPreviewSheetViewport | null = null;
  rowAxis: OnlyPreviewSheetAxis | null = null;
  columnAxis: OnlyPreviewSheetAxis | null = null;
  rowRange = { start: 1, end: 1 };
  columnRange = { start: 1, end: 1 };
  activeCell = { row: 1, column: 1 };
  activeSearchTarget: OnlyPreviewSheetSearchTarget | null = null;
  private readonly session: OnlyPreviewSheetSessionApi;
  private readonly reportingRevision: string;
  private readonly hooks: OnlyPreviewSheetPreviewHooks;
  private sheetGeneration = 0;
  private viewportGeneration = 0;
  private searchGeneration = 0;
  private mounted = false;
  private readyReported = false;
  private pendingActivation: { sheetId: number; promise: Promise<boolean> } | null = null;
  private viewportRequestCoordinator: ViewportRequestCoordinator | null = null;
  private unregisterFindAdapter: (() => void) | null = null;

  constructor(options: OnlyPreviewSheetPreviewStoreOptions) {
    this.session = markRaw(options.session);
    this.manifest = markRaw(options.manifest);
    this.reportingRevision = options.reportingRevision;
    this.hooks = markRaw(options.hooks);
    this.activeSheetId = options.manifest.sheets[0]?.id ?? 0;
  }

  mount(): void {
    this.mounted = true;
    const selectionRevision = Number(this.reportingRevision);
    if (Number.isSafeInteger(selectionRevision) && selectionRevision >= 0) {
      this.unregisterFindAdapter = onlyPreviewFindAdapterBridge.register(
        'sheet',
        selectionRevision,
        {
          execute: async (command) => {
            const result = command.findNext
              ? await this.query(command.query, command.caseSensitive)
              : command.direction === 'forward'
                ? await this.next()
                : await this.previous();
            return {
              activeMatchOrdinal: result.active,
              matches: result.total,
              finalUpdate: true,
              coverage: result.coverage
            };
          },
          clear: async () => {
            await this.clear();
          }
        }
      );
    }
    void this.activateSheet(this.activeSheetId);
  }

  dispose(): void {
    this.mounted = false;
    this.sheetGeneration += 1;
    this.viewportGeneration += 1;
    this.searchGeneration += 1;
    this.unregisterFindAdapter?.();
    this.unregisterFindAdapter = null;
    this.session.dispose();
  }

  requestVisibleViewport(): Promise<boolean> {
    const metrics = this.hooks.getViewportMetrics();
    const rows = this.rowAxis;
    const columns = this.columnAxis;
    const currentLayout = this.layout;
    if (
      !metrics ||
      !rows ||
      !columns ||
      !currentLayout ||
      currentLayout.sheetId !== this.activeSheetId
    ) {
      return Promise.resolve(false);
    }
    const sheetId = this.activeSheetId;
    const currentCoordinator = this.viewportRequestCoordinator;
    if (
      currentCoordinator?.running &&
      currentCoordinator.sheetId === sheetId &&
      currentCoordinator.sheetGeneration === this.sheetGeneration &&
      currentCoordinator.viewportGeneration === this.viewportGeneration
    ) {
      currentCoordinator.requestedVersion += 1;
      return currentCoordinator.promise;
    }
    const coordinator: ViewportRequestCoordinator = {
      sheetId,
      sheetGeneration: this.sheetGeneration,
      viewportGeneration: this.viewportGeneration,
      requestedVersion: 1,
      running: true,
      promise: Promise.resolve(false)
    };
    this.viewportRequestCoordinator = markRaw(coordinator);
    coordinator.promise = this.runViewportRequestCoordinator(coordinator);
    return coordinator.promise;
  }

  activateSheet(sheetId: number, preserveSearchGeneration = false): Promise<boolean> {
    if (!this.manifest.sheets.some((sheet) => sheet.id === sheetId)) {
      return Promise.resolve(false);
    }
    if (!preserveSearchGeneration) {
      this.searchGeneration += 1;
      this.activeSearchTarget = null;
    }
    if (this.pendingActivation?.sheetId === sheetId) return this.pendingActivation.promise;
    if (
      this.activeSheetId === sheetId &&
      this.layout?.sheetId === sheetId &&
      this.rowAxis &&
      this.columnAxis
    ) {
      return Promise.resolve(true);
    }
    const activation: { sheetId: number; promise: Promise<boolean> } = {
      sheetId,
      promise: Promise.resolve(false)
    };
    activation.promise = this.performActivateSheet(sheetId).then((installed) => {
      if (this.pendingActivation === activation) this.pendingActivation = null;
      return installed;
    });
    this.pendingActivation = markRaw(activation);
    return activation.promise;
  }

  setActiveCell(row: number, column: number): void {
    this.searchGeneration += 1;
    this.activeCell = { row, column };
    this.activeSearchTarget = null;
  }

  async revealCell(target: OnlyPreviewSheetSearchTarget): Promise<void> {
    const generation = ++this.searchGeneration;
    this.activeSearchTarget = null;
    await this.revealCellForGeneration(target, generation);
  }

  async query(value: string, caseSensitive: boolean): Promise<OnlyPreviewSheetSearchResult> {
    return await this.runSearchOperation(() => this.session.query(value, caseSensitive));
  }

  async next(): Promise<OnlyPreviewSheetSearchResult> {
    return await this.runSearchOperation(() => this.session.next());
  }

  async previous(): Promise<OnlyPreviewSheetSearchResult> {
    return await this.runSearchOperation(() => this.session.previous());
  }

  async clear(): Promise<OnlyPreviewSheetSearchResult> {
    this.searchGeneration += 1;
    this.activeSearchTarget = null;
    return await this.session.clear();
  }

  async reveal(ordinal: number): Promise<OnlyPreviewSheetSearchResult> {
    return await this.runSearchOperation(() => this.session.reveal(ordinal));
  }

  private isViewportCoordinatorCurrent(coordinator: ViewportRequestCoordinator): boolean {
    return (
      this.mounted &&
      this.viewportRequestCoordinator === coordinator &&
      coordinator.running &&
      coordinator.sheetGeneration === this.sheetGeneration &&
      coordinator.viewportGeneration === this.viewportGeneration &&
      coordinator.sheetId === this.activeSheetId &&
      this.layout?.sheetId === coordinator.sheetId &&
      Boolean(this.rowAxis && this.columnAxis && this.hooks.getViewportMetrics())
    );
  }

  private async runViewportRequestCoordinator(
    coordinator: ViewportRequestCoordinator
  ): Promise<boolean> {
    let installed = false;
    try {
      while (this.isViewportCoordinatorCurrent(coordinator)) {
        const requestedVersion = coordinator.requestedVersion;
        const metrics = this.hooks.getViewportMetrics();
        const rows = this.rowAxis;
        const columns = this.columnAxis;
        if (!metrics || !rows || !columns) return false;
        const nextRows = getOnlyPreviewSheetVirtualRange(
          rows,
          metrics.scrollTop,
          metrics.height,
          4
        );
        const nextColumns = getOnlyPreviewSheetVirtualRange(
          columns,
          metrics.scrollLeft,
          metrics.width,
          3
        );
        this.rowRange = nextRows;
        this.columnRange = nextColumns;
        let nextViewport: OnlyPreviewSheetViewport;
        try {
          nextViewport = await this.session.requestViewport(
            coordinator.sheetId,
            nextRows.start,
            nextRows.end,
            nextColumns.start,
            nextColumns.end
          );
        } catch (error) {
          if (this.isViewportCoordinatorCurrent(coordinator)) this.reportError(error);
          return false;
        }
        if (!this.isViewportCoordinatorCurrent(coordinator)) return false;
        if (requestedVersion !== coordinator.requestedVersion) continue;
        this.viewport = markRaw(nextViewport);
        await this.hooks.afterViewportInstall();
        if (
          !this.isViewportCoordinatorCurrent(coordinator) ||
          requestedVersion !== coordinator.requestedVersion ||
          this.viewport !== nextViewport
        ) {
          continue;
        }
        installed = true;
        if (!this.readyReported) {
          this.readyReported = true;
          this.hooks.reportReady();
        }
        return true;
      }
      return installed;
    } finally {
      coordinator.running = false;
      if (this.viewportRequestCoordinator === coordinator) {
        this.viewportRequestCoordinator = null;
      }
    }
  }

  private async performActivateSheet(sheetId: number): Promise<boolean> {
    const generation = ++this.sheetGeneration;
    this.viewportGeneration += 1;
    this.activeSheetId = sheetId;
    this.activeCell = { row: 1, column: 1 };
    this.activeSearchTarget = null;
    this.rowRange = { start: 1, end: 1 };
    this.columnRange = { start: 1, end: 1 };
    this.layout = null;
    this.rowAxis = null;
    this.columnAxis = null;
    this.viewport = null;
    try {
      const nextLayout = await this.session.requestLayout(sheetId);
      if (generation !== this.sheetGeneration || sheetId !== this.activeSheetId) return false;
      this.layout = markRaw(nextLayout);
      this.rowAxis = markRaw(
        createOnlyPreviewSheetAxis(
          nextLayout.rowCount,
          nextLayout.defaultRowHeight,
          nextLayout.rowHeights
        )
      );
      this.columnAxis = markRaw(
        createOnlyPreviewSheetAxis(
          nextLayout.columnCount,
          nextLayout.defaultColumnWidth,
          nextLayout.columnWidths
        )
      );
      await this.hooks.prepareViewport();
      if (!this.mounted || generation !== this.sheetGeneration || sheetId !== this.activeSheetId) {
        return false;
      }
      const installed = await this.requestVisibleViewport();
      return installed && generation === this.sheetGeneration && sheetId === this.activeSheetId;
    } catch (error) {
      if (generation === this.sheetGeneration) this.reportError(error);
      return false;
    }
  }

  private async revealCellForGeneration(
    target: OnlyPreviewSheetSearchTarget,
    generation: number
  ): Promise<boolean> {
    if (generation !== this.searchGeneration) return false;
    if (
      target.sheetId !== this.activeSheetId ||
      this.layout?.sheetId !== target.sheetId ||
      !this.rowAxis ||
      !this.columnAxis
    ) {
      const installed = await this.activateSheet(target.sheetId, true);
      if (!installed || generation !== this.searchGeneration) return false;
    }
    if (
      target.sheetId !== this.activeSheetId ||
      this.layout?.sheetId !== target.sheetId ||
      !this.rowAxis ||
      !this.columnAxis
    ) {
      return false;
    }
    if (
      !this.hooks.scrollToCell(
        getOnlyPreviewSheetAxisOffset(this.columnAxis, target.column),
        getOnlyPreviewSheetAxisOffset(this.rowAxis, target.row)
      )
    ) {
      return false;
    }
    const installed = await this.requestVisibleViewport();
    if (
      !installed ||
      generation !== this.searchGeneration ||
      target.sheetId !== this.activeSheetId
    ) {
      return false;
    }
    this.activeCell = { row: target.row, column: target.column };
    this.activeSearchTarget = target;
    return true;
  }

  private async runSearchOperation(
    operation: () => Promise<OnlyPreviewSheetSearchResult>
  ): Promise<OnlyPreviewSheetSearchResult> {
    const generation = ++this.searchGeneration;
    this.activeSearchTarget = null;
    const result = await operation();
    if (generation !== this.searchGeneration) return result;
    if (result.target) await this.revealCellForGeneration(result.target, generation);
    return result;
  }

  private reportError(error: unknown): void {
    void onlyPreviewPreviewStore.reportSurfaceError(this.reportingRevision, errorCodeFor(error));
  }
}

export const createOnlyPreviewSheetPreviewStore = (
  options: OnlyPreviewSheetPreviewStoreOptions
): OnlyPreviewSheetPreviewStoreController =>
  reactive(
    new OnlyPreviewSheetPreviewStoreController(options)
  ) as OnlyPreviewSheetPreviewStoreController;
