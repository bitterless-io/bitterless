<template>
  <div name="submodules__app" class="submodules">
    <SubmodulesMenuBar />

    <div
      v-if="submodulesStore.actionError"
      name="submodules__errorBanner"
      class="submodules__error"
      role="alert"
    >
      <IconAlertTriangle :size="16" />
      <span>{{ submodulesStore.actionError }}</span>
      <a-button size="mini" type="text" @click="submodulesStore.dismissActionError()">
        {{ i18nHelper.submodules.actions.dismiss }}
      </a-button>
    </div>

    <div
      v-if="submodulesStore.snapshot.rootPath"
      name="submodules__rootSummary"
      class="submodules__root"
    >
      <IconFolder :size="14" />
      <span class="submodules__root-name">{{ submodulesStore.snapshot.rootName }}</span>
      <span class="submodules__root-path">
        <bdi>{{ submodulesStore.snapshot.rootPath }}</bdi>
      </span>
      <span class="submodules__root-count">
        {{ countLabel }}
      </span>
    </div>

    <SubmodulesListControls v-if="submodulesStore.snapshot.rootPath" ref="listControlsRef" />

    <main name="submodules__main" class="submodules__main">
      <div
        v-if="submodulesStore.loading && !submodulesStore.entries.length"
        name="submodules__loading"
        class="submodules__center-state"
      >
        <a-spin :size="26" />
        <span>{{ i18nHelper.submodules.empty.loading }}</span>
      </div>

      <div
        v-else-if="!submodulesStore.snapshot.rootPath"
        name="submodules__empty"
        class="submodules__center-state"
      >
        <div class="submodules__empty-mark" aria-hidden="true">
          <IconGitBranch :size="24" />
        </div>
        <h1>{{ i18nHelper.submodules.empty.title }}</h1>
        <p>{{ i18nHelper.submodules.empty.body }}</p>
        <a-button
          type="primary"
          :loading="submodulesStore.choosing"
          @click="submodulesStore.chooseRoot()"
        >
          {{ i18nHelper.submodules.actions.openFolder }}
        </a-button>
      </div>

      <div
        v-else-if="submodulesStore.scanError"
        name="submodules__scanError"
        class="submodules__center-state submodules__center-state--error"
      >
        <IconAlertTriangle :size="24" />
        <p>{{ submodulesStore.scanError }}</p>
        <div class="submodules__center-actions">
          <a-button type="primary" @click="submodulesStore.chooseRoot()">
            {{ i18nHelper.submodules.actions.openFolder }}
          </a-button>
          <a-button @click="submodulesStore.refresh()">
            {{ i18nHelper.submodules.actions.refresh }}
          </a-button>
        </div>
      </div>

      <div
        v-else-if="!submodulesStore.entries.length"
        name="submodules__noEntries"
        class="submodules__center-state"
      >
        <p>{{ i18nHelper.submodules.empty.noSubmodules }}</p>
      </div>

      <div
        v-else-if="!submodulesStore.visibleTree.length"
        name="submodules__noMatches"
        class="submodules__center-state"
      >
        <p>{{ i18nHelper.submodules.empty.noMatches }}</p>
        <a-button size="mini" @click="submodulesStore.clearSearch()">
          {{ i18nHelper.submodules.actions.clearSearch }}
        </a-button>
      </div>

      <div v-else name="submodules__list" class="submodules__list">
        <template v-for="row in submodulesStore.visibleTree" :key="row.entry.absolutePath">
          <SubmoduleRow
            :entry="row.entry"
            :loading="submodulesStore.openingPath === row.entry.absolutePath"
            :expandable="row.expandable"
            :expanded="row.expanded"
            @open="handleOpen"
            @toggle="submodulesStore.toggleExpanded($event)"
          />
          <SubmoduleRow
            v-for="child in row.children"
            :key="child.absolutePath"
            :entry="child"
            :loading="submodulesStore.openingPath === child.absolutePath"
            nested
            @open="handleOpen"
          />
        </template>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { IconAlertTriangle, IconFolder, IconGitBranch } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { SubmoduleEntry } from '@shared/submodules/submodules.type';
import SubmodulesListControls from './components/SubmodulesListControls/SubmodulesListControls.vue';
import SubmodulesMenuBar from './components/SubmodulesMenuBar/SubmodulesMenuBar.vue';
import SubmoduleRow from './components/SubmoduleRow/SubmoduleRow.vue';
import { submodulesStore } from './store/submodules.store';

interface ListControlsInstance {
  focusSearch(): Promise<void>;
}

const listControlsRef = ref<ListControlsInstance | null>(null);

// Both levels are counted, and while a search is active the count states what is on screen, so a
// filtered list never looks wrong.
const countLabel = computed(() =>
  i18nHelper.submodules.count.replace(
    '{count}',
    submodulesStore.isSearching
      ? `${submodulesStore.visibleCount}/${submodulesStore.totalCount}`
      : String(submodulesStore.totalCount)
  )
);

const handleOpen = async (entry: SubmoduleEntry): Promise<void> => {
  await submodulesStore.openInWebStorm(entry);
};

/**
 * Focus the search box on `Cmd+F` (macOS), `Alt+F` and `Ctrl+F` (Windows — Chat's own search accepts
 * `Alt+F` there, and `Ctrl+F` is what every other Windows list uses, so both fire). The renderer has
 * no find-in-page of its own, so the shortcut is free to mean "search this list".
 *
 * `event.code` leads because macOS `Option+F` reports `event.key === 'ƒ'`, which a `key === 'f'`
 * check would miss; `key` stays as the fallback for layouts that report no code.
 */
const handleWindowKeydown = (event: KeyboardEvent): void => {
  const pressedF = event.code === 'KeyF' || event.key.toLocaleLowerCase() === 'f';
  if (!pressedF || !(event.metaKey || event.ctrlKey || event.altKey)) return;
  event.preventDefault();
  event.stopPropagation();
  void focusSearch();
};

const focusSearch = async (): Promise<void> => {
  await nextTick();
  await listControlsRef.value?.focusSearch();
};

onMounted(async () => {
  window.addEventListener('keydown', handleWindowKeydown);
  await submodulesStore.initialize();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleWindowKeydown);
});
</script>

<style lang="less">
@import './App.less';
</style>
