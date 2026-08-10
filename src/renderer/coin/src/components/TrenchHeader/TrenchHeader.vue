<template>
  <header
    name="trench__header"
    class="trench-header"
    :class="{
      'trench-header--mac': host.platform === 'darwin' && host.host === 'standalone',
      'trench-header--embedded': host.host === 'omni',
    }"
  >
    <div class="trench-header__identity">
      <span class="trench-header__mark" aria-hidden="true">BL</span>
      <h1>Trench</h1>
      <span>{{ t('trench.header.subtitle') }}</span>
    </div>
    <div class="trench-header__status" aria-live="polite">
      <span
        class="trench-header__status-dot"
        :class="{
          'trench-header__status-dot--pending': currentList.phase === 'loading' || currentList.phase === 'refreshing',
          'trench-header__status-dot--error': currentList.phase === 'unavailable' || currentList.phase === 'error',
        }"
      />
      {{ statusText }}
    </div>
    <a-tooltip :content="t('trench.agentGuide.trigger')" position="bottom" mini>
      <IconBtn
        name="trench__header__agent-guide"
        class="trench-header__agent-guide"
        :title="t('trench.agentGuide.trigger')"
        :aria-label="t('trench.agentGuide.trigger')"
        @click="trenchAgentGuideStore.open()"
      >
        <IconRobot size="17" stroke="1.8" aria-hidden="true" />
      </IconBtn>
    </a-tooltip>
    <button
      name="trench__header__refresh"
      class="trench-header__refresh"
      type="button"
      :disabled="currentList.phase === 'loading' || currentList.phase === 'refreshing'"
      @click="trenchVaultStore.refresh()"
    >
      {{ t('trench.actions.refresh') }}
    </button>
  </header>
  <TrenchAgentGuideModal />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconRobot } from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import TrenchAgentGuideModal from '../TrenchAgentGuideModal/TrenchAgentGuideModal.vue';
import { trenchHost } from '../../contextBridge/trenchHost.bridge';
import { trenchAgentGuideStore } from '../../views/vault/trenchAgentGuide.runtime';
import { trenchVaultStore } from '../../views/vault/trenchVault.runtime';

const { t } = useI18n();
const host = trenchHost;
const currentList = computed(() => trenchVaultStore.currentList);
const statusText = computed(() => {
  if (currentList.value.phase === 'loading') return t('trench.header.loading');
  if (currentList.value.phase === 'refreshing') return t('trench.header.refreshing');
  if (currentList.value.phase === 'unavailable' || currentList.value.phase === 'error') {
    return t('trench.header.unavailable');
  }
  return t('trench.header.local');
});
</script>

<style lang="less">
@import './TrenchHeader.less';
</style>
