<template>
  <header
    name="submodules__menuBar"
    class="submodules-menu-bar"
    :class="platformClass"
    @dblclick="handleDoubleClick"
  >
    <div name="submodules__menuBar__identity" class="submodules-menu-bar__identity">
      <IconGitBranch :size="16" />
      <span class="submodules-menu-bar__title">{{ i18nHelper.submodules.title }}</span>
    </div>

    <div name="submodules__menuBar__actions" class="submodules-menu-bar__actions">
      <span
        v-if="submodulesStore.snapshot.rootPath"
        name="submodules__menuBar__watchState"
        class="submodules-menu-bar__watch"
      >
        <span
          class="submodules-menu-bar__watch-dot"
          :class="{ 'submodules-menu-bar__watch-dot--live': submodulesStore.snapshot.watching }"
        />
        {{
          submodulesStore.snapshot.watching
            ? i18nHelper.submodules.watch.live
            : i18nHelper.submodules.watch.paused
        }}
      </span>

      <a-button
        name="submodules__menuBar__open"
        size="mini"
        type="text"
        :loading="submodulesStore.choosing"
        :aria-label="i18nHelper.submodules.actions.openFolder"
        @click="submodulesStore.chooseRoot()"
      >
        <template #icon><IconFolderOpen :size="16" /></template>
        {{ i18nHelper.submodules.actions.openFolder }}
      </a-button>

      <a-button
        name="submodules__menuBar__refresh"
        size="mini"
        type="text"
        :loading="submodulesStore.loading"
        :disabled="!submodulesStore.snapshot.rootPath"
        :aria-label="i18nHelper.submodules.actions.refresh"
        @click="submodulesStore.refresh()"
      >
        <template #icon><IconRefresh :size="16" /></template>
        {{ i18nHelper.submodules.actions.refresh }}
      </a-button>

      <template v-if="isWindows && !isOmni">
        <a-button
          name="submodules__menuBar__minimize"
          size="mini"
          type="text"
          :aria-label="i18nHelper.submodules.actions.minimize"
          @click="submodulesWindowEmitter.minimize()"
        >
          <template #icon><IconMinus :size="16" /></template>
        </a-button>
        <a-button
          name="submodules__menuBar__maximize"
          size="mini"
          type="text"
          :aria-label="i18nHelper.submodules.actions.maximize"
          @click="submodulesWindowEmitter.toggleMaximize()"
        >
          <template #icon><IconMaximize :size="16" /></template>
        </a-button>
        <a-button
          name="submodules__menuBar__close"
          size="mini"
          type="text"
          class="submodules-menu-bar__close"
          :aria-label="i18nHelper.submodules.actions.close"
          @click="submodulesWindowEmitter.close()"
        >
          <template #icon><IconX :size="16" /></template>
        </a-button>
      </template>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  IconFolderOpen,
  IconGitBranch,
  IconMaximize,
  IconMinus,
  IconRefresh,
  IconX
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { uaHelper } from '@renderer/common/utils/userAgentHelper/ua.helper';
import { submodulesEnv } from '../../contextBridge/submodulesEnv.bridge';
import { submodulesStore } from '../../store/submodules.store';
import { submodulesWindowEmitter } from '../../emitter/submodules.emitter';

const isMac = uaHelper.isMac;
const isWindows = uaHelper.isWindows;
const isOmni = submodulesEnv?.host === 'omni';
const platformClass = computed(() => ({
  'submodules-menu-bar--mac': isMac && !isOmni,
  'submodules-menu-bar--windows': isWindows && !isOmni,
  'submodules-menu-bar--omni': isOmni
}));

const handleDoubleClick = async (event: MouseEvent): Promise<void> => {
  // `SubmodulesWindowApi` only addresses the standalone window; an Omni cell must never move it.
  if (isOmni) return;
  if ((event.target as HTMLElement).closest('.submodules-menu-bar__actions')) return;
  await submodulesWindowEmitter.toggleMaximize();
};
</script>

<style lang="less">
@import './SubmodulesMenuBar.less';
</style>
