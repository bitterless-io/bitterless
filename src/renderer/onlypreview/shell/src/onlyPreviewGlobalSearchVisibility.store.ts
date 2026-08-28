import { reactive } from 'vue';

class OnlyPreviewGlobalSearchVisibilityStore {
  active = false;

  setActive(active: boolean): void {
    this.active = active;
  }
}

export const onlyPreviewGlobalSearchVisibilityStore = reactive(
  new OnlyPreviewGlobalSearchVisibilityStore()
);
