import { xpcRenderer } from 'electron-xpc/renderer';
import {
  ONLY_PREVIEW_FIND_COMMAND_EVENT,
  type OnlyPreviewFindCommand,
  type OnlyPreviewFindCoverage
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';

export interface OnlyPreviewContentFindAdapterResult {
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
  coverage: OnlyPreviewFindCoverage;
}

export interface OnlyPreviewContentFindAdapter {
  execute(command: OnlyPreviewFindCommand): Promise<OnlyPreviewContentFindAdapterResult>;
  clear(): Promise<void> | void;
}

interface RegisteredAdapter {
  adapterId: 'monaco' | 'office';
  selectionRevision: number;
  adapter: OnlyPreviewContentFindAdapter;
}

const isFindCommand = (value: unknown): value is OnlyPreviewFindCommand => {
  if (!value || typeof value !== 'object') return false;
  const command = value as Record<string, unknown>;
  const expectedKeys = [
    'hostId',
    'selectionRevision',
    'surface',
    'findRevision',
    'query',
    'caseSensitive',
    'direction',
    'findNext',
    'adapter'
  ];
  return (
    Object.keys(command).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(command, key)) &&
    typeof command.hostId === 'string' &&
    command.hostId.length >= 1 &&
    command.hostId.length <= 256 &&
    Number.isSafeInteger(command.selectionRevision) &&
    (command.selectionRevision as number) >= 0 &&
    command.surface === 'vue' &&
    Number.isSafeInteger(command.findRevision) &&
    (command.findRevision as number) >= 0 &&
    typeof command.query === 'string' &&
    command.query.length <= 4096 &&
    !command.query.includes('\0') &&
    typeof command.caseSensitive === 'boolean' &&
    (command.direction === 'forward' || command.direction === 'backward') &&
    typeof command.findNext === 'boolean' &&
    (command.adapter === 'monaco' || command.adapter === 'office')
  );
};

class OnlyPreviewFindAdapterBridge {
  private initialized = false;
  private generation = 0;
  private lastFindRevision = -1;
  private registered: RegisteredAdapter | null = null;

  private clearAdapter(adapter: OnlyPreviewContentFindAdapter): void {
    void Promise.resolve(adapter.clear()).catch(() => undefined);
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    xpcRenderer.subscribe(ONLY_PREVIEW_FIND_COMMAND_EVENT, ({ params }) => {
      if (!isFindCommand(params) || params.hostId !== onlyPreviewEnv.hostId) return;
      void this.handleCommand(params);
    });
  }

  register(
    adapterId: RegisteredAdapter['adapterId'],
    selectionRevision: number,
    adapter: OnlyPreviewContentFindAdapter
  ): () => void {
    if (!Number.isSafeInteger(selectionRevision) || selectionRevision < 0) {
      throw new Error('OnlyPreview find adapter selection revision is invalid.');
    }
    this.generation += 1;
    if (this.registered) this.clearAdapter(this.registered.adapter);
    const registered = { adapterId, selectionRevision, adapter };
    this.registered = registered;
    return () => {
      if (this.registered !== registered) return;
      this.generation += 1;
      this.registered = null;
      this.clearAdapter(adapter);
    };
  }

  clear(): void {
    this.generation += 1;
    if (this.registered) this.clearAdapter(this.registered.adapter);
    this.registered = null;
  }

  private async handleCommand(command: OnlyPreviewFindCommand): Promise<void> {
    const registered = this.registered;
    if (
      !registered ||
      registered.selectionRevision !== command.selectionRevision ||
      registered.adapterId !== command.adapter ||
      command.findRevision <= this.lastFindRevision
    ) {
      return;
    }
    this.lastFindRevision = command.findRevision;
    const generation = ++this.generation;
    if (!command.query) {
      await registered.adapter.clear();
      return;
    }
    try {
      const result = await registered.adapter.execute(command);
      if (generation !== this.generation || this.registered !== registered) return;
      const hostToken = onlyPreviewEnv.hostToken;
      const previewRuntimeToken = onlyPreviewEnv.previewRuntimeToken;
      if (!hostToken || !previewRuntimeToken) return;
      await onlyPreviewClient.reportPreviewFindResult({
        hostToken,
        previewRuntimeToken,
        result: {
          hostId: command.hostId,
          selectionRevision: command.selectionRevision,
          surface: 'vue',
          findRevision: command.findRevision,
          activeMatchOrdinal: result.activeMatchOrdinal,
          matches: result.matches,
          finalUpdate: result.finalUpdate,
          coverage: result.coverage
        }
      });
    } catch {
      // The owning preview session reports its typed terminal error separately when applicable.
    }
  }
}

export const onlyPreviewFindAdapterBridge = new OnlyPreviewFindAdapterBridge();
