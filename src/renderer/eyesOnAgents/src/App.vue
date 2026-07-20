<template>
  <div name="eyesOnAgents__app" class="eyes-on-agents">
    <EyesOnAgentsMenuBar @open-connections="connectionsVisible = true" />

    <div
      v-if="eyesOnAgentsStore.loadError || eyesOnAgentsStore.actionError"
      name="eyesOnAgents__errorBanner"
      class="eyes-on-agents__error"
      role="alert"
    >
      <IconAlertTriangle :size="16" />
      <span>{{ eyesOnAgentsStore.loadError || eyesOnAgentsStore.actionError }}</span>
      <a-button size="mini" type="text" @click="handleRetry">
        {{ i18nHelper.eyesOnAgents.connection.retry }}
      </a-button>
    </div>

    <main name="eyesOnAgents__main" class="eyes-on-agents__main">
      <div
        v-if="eyesOnAgentsStore.loading && !eyesOnAgentsStore.snapshot"
        name="eyesOnAgents__loading"
        class="eyes-on-agents__center-state"
      >
        <a-spin :size="28" />
        <span>{{ i18nHelper.eyesOnAgents.board.loading }}</span>
      </div>

      <div
        v-else-if="eyesOnAgentsStore.threads.length === 0"
        name="eyesOnAgents__empty"
        class="eyes-on-agents__center-state eyes-on-agents__center-state--empty"
      >
        <div class="eyes-on-agents__empty-mark" aria-hidden="true">
          <IconEye :size="26" />
        </div>
        <h1>{{ i18nHelper.eyesOnAgents.board.emptyTitle }}</h1>
        <p>{{ i18nHelper.eyesOnAgents.board.emptyBody }}</p>
        <div class="eyes-on-agents__empty-actions">
          <a-button type="primary" @click="handlePrimaryEmptyAction">
            {{ emptyActionLabel }}
          </a-button>
          <a-button @click="connectionsVisible = true">
            {{ i18nHelper.eyesOnAgents.actions.openConnections }}
          </a-button>
        </div>
      </div>

      <AgentBoard v-else />
    </main>

    <ConnectionPanel
      :visible="connectionsVisible"
      @close="connectionsVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { IconAlertTriangle, IconEye } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import AgentBoard from './components/AgentBoard/AgentBoard.vue';
import ConnectionPanel from './components/ConnectionPanel/ConnectionPanel.vue';
import EyesOnAgentsMenuBar from './components/EyesOnAgentsMenuBar/EyesOnAgentsMenuBar.vue';
import { eyesOnAgentsStore } from './store/eyesOnAgents.store';
import { globalStore } from './store/global.store';

const connectionsVisible = ref(false);

const emptyActionLabel = computed(() => {
  const state = eyesOnAgentsStore.snapshot?.connection.state;
  return state === 'connected' || state === 'syncing'
    ? i18nHelper.eyesOnAgents.actions.sync
    : i18nHelper.eyesOnAgents.connection.connect;
});

const handlePrimaryEmptyAction = async (): Promise<void> => {
  const state = eyesOnAgentsStore.snapshot?.connection.state;
  if (state === 'connected' || state === 'syncing') {
    await eyesOnAgentsStore.syncThreads().catch(() => undefined);
    return;
  }
  await eyesOnAgentsStore.connectAppServer().catch(() => undefined);
};

const handleRetry = async (): Promise<void> => {
  eyesOnAgentsStore.clearActionError();
  await eyesOnAgentsStore.loadSnapshot();
};

const handleWindowFocus = (): void => {
  void eyesOnAgentsStore.refreshOnWindowActivation().catch(() => undefined);
};

onMounted(async () => {
  globalStore.startCurrentTimeLoop();
  eyesOnAgentsStore.initialize();
  window.addEventListener('focus', handleWindowFocus);
  await eyesOnAgentsStore.loadSnapshot();
});

onBeforeUnmount(() => {
  globalStore.stopCurrentTimeLoop();
  window.removeEventListener('focus', handleWindowFocus);
});
</script>

<style lang="less">
@import './App.less';
</style>
