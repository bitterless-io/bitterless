<template>
  <section name="coin__unavailableState" class="coin-unavailable-state" aria-live="polite">
    <IconPlugOff :size="22" stroke-width="1.6" aria-hidden="true" />
    <div class="coin-unavailable-state__copy">
      <h2>{{ title }}</h2>
      <p>{{ i18nHelper.coin.workspace.unavailableBody }}</p>
    </div>
    <a-button size="small" @click="$emit('open-sources')">
      <template #icon><IconDatabaseSearch :size="16" /></template>
      {{ i18nHelper.coin.workspace.openSources }}
    </a-button>
  </section>
</template>

<script setup lang="ts">
import { IconDatabaseSearch, IconPlugOff } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

defineProps<{
  title: string;
}>();

defineEmits<{
  (event: 'open-sources'): void;
}>();
</script>
