import { reactive } from 'vue';
import {
  loadMottoItems,
  MottoStorageError,
  persistMottoItems,
  type MottoItem,
  type MottoStorage,
  type MottoStorageErrorCode
} from './mottoStorage.service';

export type MottoEditableField = 'title' | 'subtitle';

export class MottoState {
  items: MottoItem[] = [];
  pendingDraft: MottoItem | null = null;
  storageError: MottoStorageErrorCode | null = null;
  editingId: string | null = null;
  editingField: MottoEditableField | null = null;
  draftValue = '';
  private storage: MottoStorage | null = null;
  private initialized = false;

  get inlineEditorActive(): boolean {
    return this.editingId !== null && this.editingField !== null;
  }

  initialize(storage?: MottoStorage): void {
    if (this.initialized) return;
    this.initialized = true;

    try {
      this.storage = storage ?? globalThis.localStorage;
      this.items = loadMottoItems(this.storage);
      this.storageError = null;
    } catch (error) {
      this.items = [];
      this.storageError = error instanceof MottoStorageError ? error.code : 'read-failed';
      console.error('[motto] storage load failed:', error);
    }
  }

  beginAdd(): boolean {
    if (this.inlineEditorActive) {
      return this.pendingDraft?.id === this.editingId && this.editingField === 'title';
    }

    const pendingDraft = {
      id: this.createUniqueId(),
      title: '',
      subtitle: ''
    };
    this.pendingDraft = pendingDraft;
    this.editingId = pendingDraft.id;
    this.editingField = 'title';
    this.draftValue = '';
    return true;
  }

  beginEdit(id: string, field: MottoEditableField): boolean {
    if (this.inlineEditorActive) {
      return this.editingId === id && this.editingField === field;
    }

    const item =
      this.items.find((candidate) => candidate.id === id) ??
      (this.pendingDraft?.id === id ? this.pendingDraft : null);
    if (!item) return false;

    this.editingId = id;
    this.editingField = field;
    this.draftValue = item[field];
    return true;
  }

  isEditing(id: string, field: MottoEditableField): boolean {
    return this.editingId === id && this.editingField === field;
  }

  commitInlineEdit(): boolean {
    const editingId = this.editingId;
    const editingField = this.editingField;
    if (!editingId || !editingField) return false;

    const value = this.draftValue.trim();
    if (this.pendingDraft?.id === editingId) {
      if (editingField !== 'title' || !value) {
        this.discardPendingDraft();
        return false;
      }

      const nextItems = [...this.items, { ...this.pendingDraft, title: value }];
      if (!this.persistNextItems(nextItems)) return false;
      this.pendingDraft = null;
      this.clearInlineEditor();
      return true;
    }

    const item = this.items.find((candidate) => candidate.id === editingId);
    if (!item) {
      this.clearInlineEditor();
      return false;
    }
    if (editingField === 'title' && !value) {
      this.clearInlineEditor();
      return false;
    }
    if (item[editingField] === value) {
      this.clearInlineEditor();
      return true;
    }

    const nextItems = this.items.map((candidate) =>
      candidate.id === editingId ? { ...candidate, [editingField]: value } : candidate
    );
    if (!this.persistNextItems(nextItems)) return false;
    this.clearInlineEditor();
    return true;
  }

  cancelInlineEdit(): void {
    if (this.pendingDraft?.id === this.editingId) {
      this.pendingDraft = null;
    }
    this.clearInlineEditor();
  }

  deleteItem(id: string): boolean {
    if (!this.items.some((item) => item.id === id)) return false;
    if (!this.persistNextItems(this.items.filter((item) => item.id !== id))) return false;
    if (this.editingId === id) this.clearInlineEditor();
    return true;
  }

  reorderItems(nextItems: readonly MottoItem[]): boolean {
    if (this.inlineEditorActive || nextItems.length !== this.items.length) return false;

    const currentItems = new Map(this.items.map((item) => [item.id, item]));
    const seenIds = new Set<string>();
    for (const item of nextItems) {
      const currentItem = currentItems.get(item.id);
      if (
        !currentItem ||
        seenIds.has(item.id) ||
        currentItem.title !== item.title ||
        currentItem.subtitle !== item.subtitle
      ) {
        return false;
      }
      seenIds.add(item.id);
    }

    if (nextItems.every((item, index) => item.id === this.items[index]?.id)) return true;
    return this.persistNextItems([...nextItems]);
  }

  private discardPendingDraft(): void {
    this.pendingDraft = null;
    this.clearInlineEditor();
  }

  private clearInlineEditor(): void {
    this.editingId = null;
    this.editingField = null;
    this.draftValue = '';
  }

  private persistNextItems(nextItems: MottoItem[]): boolean {
    if (!this.storage) {
      this.storageError = 'write-failed';
      return false;
    }

    try {
      const persistedItems = persistMottoItems(this.storage, nextItems);
      this.items = persistedItems;
      this.storageError = null;
      return true;
    } catch (error) {
      this.storageError = 'write-failed';
      console.error('[motto] storage write failed:', error);
      return false;
    }
  }

  private createUniqueId(): string {
    let id = '';
    do {
      id = globalThis.crypto.randomUUID();
    } while (this.items.some((item) => item.id === id) || this.pendingDraft?.id === id);
    return id;
  }
}

export const mottoStore = reactive<MottoState>(new MottoState());
