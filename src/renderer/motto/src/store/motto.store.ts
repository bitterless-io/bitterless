import { reactive } from 'vue';
import {
  loadMottoItems,
  MottoStorageError,
  persistMottoItems,
  type MottoItem,
  type MottoStorage,
  type MottoStorageErrorCode
} from './mottoStorage.service';

type MottoEditorMode = 'add' | 'edit';

class MottoState {
  items: MottoItem[] = [];
  storageError: MottoStorageErrorCode | null = null;
  editorMode: MottoEditorMode | null = null;
  editingId: string | null = null;
  draftTitle = '';
  draftSubtitle = '';
  private storage: MottoStorage | null = null;
  private initialized = false;

  get editorVisible(): boolean {
    return this.editorMode !== null;
  }

  get canSubmitEditor(): boolean {
    return Boolean(this.draftTitle.trim());
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

  openAddEditor(): void {
    this.editorMode = 'add';
    this.editingId = null;
    this.draftTitle = '';
    this.draftSubtitle = '';
  }

  openEditEditor(item: MottoItem): void {
    this.editorMode = 'edit';
    this.editingId = item.id;
    this.draftTitle = item.title;
    this.draftSubtitle = item.subtitle;
  }

  cancelEditor(): void {
    this.editorMode = null;
    this.editingId = null;
    this.draftTitle = '';
    this.draftSubtitle = '';
  }

  submitEditor(): boolean {
    const title = this.draftTitle.trim();
    const subtitle = this.draftSubtitle.trim();
    if (!title || !this.editorMode) return false;

    let nextItems: MottoItem[];
    if (this.editorMode === 'add') {
      nextItems = [...this.items, { id: this.createUniqueId(), title, subtitle }];
    } else {
      const editingId = this.editingId;
      if (!editingId || !this.items.some((item) => item.id === editingId)) return false;
      nextItems = this.items.map((item) =>
        item.id === editingId ? { ...item, title, subtitle } : item
      );
    }

    if (!this.persistNextItems(nextItems)) return false;
    this.cancelEditor();
    return true;
  }

  deleteItem(id: string): boolean {
    if (!this.items.some((item) => item.id === id)) return false;
    return this.persistNextItems(this.items.filter((item) => item.id !== id));
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
    } while (this.items.some((item) => item.id === id));
    return id;
  }
}

export const mottoStore = reactive<MottoState>(new MottoState());
