<template>
  <nav ref="moduleBar" name="trench__moduleBar" class="trench-module-bar" role="tablist" :aria-label="t('trench.modules.label')">
    <button
      v-for="item in moduleItems"
      :key="item.id"
      :name="item.name"
      class="trench-module-bar__item"
      :class="{ 'trench-module-bar__item--active': trenchVaultStore.module === item.id }"
      type="button"
      role="tab"
      :aria-selected="trenchVaultStore.module === item.id"
      aria-controls="trench-record-panel"
      :tabindex="trenchVaultStore.module === item.id ? 0 : -1"
      @click="trenchVaultStore.setModule(item.id)"
      @keydown.left.prevent="move(-1)"
      @keydown.right.prevent="move(1)"
      @keydown.home.prevent="activate(0)"
      @keydown.end.prevent="activate(moduleItems.length - 1)"
    >
      {{ t(item.label) }}
      <span>{{ trenchVaultStore.lists[item.id].total ?? '…' }}</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { trenchVaultStore } from '../../views/vault/trenchVault.runtime';
import type { TrenchModule } from '../../views/vault/trenchVault.type';

const { t } = useI18n();
const moduleBar = ref<HTMLElement | null>(null);
const moduleItems: Array<{ id: TrenchModule; label: string; name: string }> = [
  { id: 'ca', label: 'trench.modules.ca', name: 'trench__module__ca' },
  { id: 'index-wallets', label: 'trench.modules.index', name: 'trench__module__index-wallets' },
  { id: 'negative-wallets', label: 'trench.modules.negative', name: 'trench__module__negative-wallets' },
];

const move = (offset: number): void => {
  const current = moduleItems.findIndex((item) => item.id === trenchVaultStore.module);
  const next = (current + offset + moduleItems.length) % moduleItems.length;
  activate(next);
};

const activate = (index: number): void => {
  void trenchVaultStore.setModule(moduleItems[index].id);
  void nextTick(() => {
    moduleBar.value?.querySelectorAll<HTMLButtonElement>('.trench-module-bar__item')[index]?.focus();
  });
};
</script>

<style lang="less">
@import './TrenchModuleBar.less';
</style>
