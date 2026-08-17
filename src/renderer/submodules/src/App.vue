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

      <div v-else name="submodules__list" class="submodules__list">
        <SubmoduleRow
          v-for="entry in submodulesStore.entries"
          :key="entry.path"
          :entry="entry"
          :loading="submodulesStore.openingPath === entry.absolutePath"
          @open="handleOpen"
        />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { IconAlertTriangle, IconFolder, IconGitBranch } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { SubmoduleEntry } from '@shared/submodules/submodules.type';
import SubmodulesMenuBar from './components/SubmodulesMenuBar/SubmodulesMenuBar.vue';
import SubmoduleRow from './components/SubmoduleRow/SubmoduleRow.vue';
import { submodulesStore } from './store/submodules.store';

const countLabel = computed(() =>
  i18nHelper.submodules.count.replace('{count}', String(submodulesStore.entries.length))
);

const handleOpen = async (entry: SubmoduleEntry): Promise<void> => {
  await submodulesStore.openInWebStorm(entry);
};

onMounted(async () => {
  await submodulesStore.initialize();
});
</script>

<style lang="less">
@import './App.less';
</style>
