<template>
  <div name="submodules__listControls" class="submodules-controls" role="search">
    <a-input
      ref="searchInputRef"
      name="submodules__listControls__search"
      class="submodules-controls__search"
      size="mini"
      allow-clear
      :model-value="submodulesStore.search"
      :placeholder="searchPlaceholder"
      :aria-label="i18nHelper.submodules.actions.search"
      @update:model-value="submodulesStore.setSearch($event)"
      @keydown.esc.prevent.stop="clearSearch"
    >
      <template #prefix>
        <IconSearch :size="12" aria-hidden="true" />
      </template>
    </a-input>

    <a-select
      name="submodules__listControls__sortMode"
      class="submodules-controls__sort"
      size="mini"
      :model-value="submodulesStore.settings.sortMode"
      :aria-label="i18nHelper.submodules.sort.label"
      :title="i18nHelper.submodules.sort.label"
      :trigger-props="{ autoFitPopupWidth: false, autoFitPopupMinWidth: true }"
      @change="handleSortChange"
    >
      <a-option value="name">{{ i18nHelper.submodules.sort.name }}</a-option>
      <a-option value="updated">{{ i18nHelper.submodules.sort.updated }}</a-option>
    </a-select>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { IconSearch } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { uaHelper } from '@renderer/common/utils/userAgentHelper/ua.helper';
import type { SubmodulesSortMode } from '@shared/submodules/submodules.type';
import { submodulesStore } from '../../store/submodules.store';

interface SearchInputInstance {
  focus?: () => void;
}

const searchInputRef = ref<SearchInputInstance | null>(null);

// The placeholder states the shortcut, like the Chat header tooltip does. Windows shows `Alt+F` as
// the primary combo; `Ctrl+F` fires there too (see App.vue) and needs no second line of chrome.
const searchPlaceholder = computed(() =>
  uaHelper.isMac
    ? i18nHelper.submodules.actions.searchShortcutMac
    : i18nHelper.submodules.actions.searchShortcutWin
);

const handleSortChange = async (value: unknown): Promise<void> => {
  await submodulesStore.setSortMode(value as SubmodulesSortMode);
};

/** `Cmd/Ctrl+F` routes here from App.vue, and `Esc` returns focus after clearing. */
const focusSearch = async (): Promise<void> => {
  await nextTick();
  searchInputRef.value?.focus?.();
};

const clearSearch = async (): Promise<void> => {
  submodulesStore.clearSearch();
  await focusSearch();
};

defineExpose({ focusSearch });
</script>

<style lang="less">
@import './SubmodulesListControls.less';
</style>
