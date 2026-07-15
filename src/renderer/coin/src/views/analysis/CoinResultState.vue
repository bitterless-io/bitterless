<template>
  <section
    name="coin__resultState"
    class="coin-result-state"
    :class="`coin-result-state--${kind}`"
    :aria-live="kind === 'error' ? 'assertive' : 'polite'"
  >
    <IconAlertTriangle v-if="kind === 'error'" :size="20" stroke-width="1.7" aria-hidden="true" />
    <IconDatabaseOff v-else-if="kind === 'unavailable'" :size="20" stroke-width="1.7" aria-hidden="true" />
    <a-spin v-else-if="kind === 'loading'" :size="18" />
    <IconInbox v-else :size="20" stroke-width="1.7" aria-hidden="true" />
    <div class="coin-result-state__copy">
      <strong>{{ title }}</strong>
      <span v-if="detail">{{ detail }}</span>
    </div>
    <a-button v-if="showSources" size="small" @click="$emit('open-sources')">
      {{ i18nHelper.coin.workspace.openSources }}
    </a-button>
  </section>
</template>

<script setup lang="ts">
import { IconAlertTriangle, IconDatabaseOff, IconInbox } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

defineProps<{
  kind: 'empty' | 'unavailable' | 'error' | 'loading';
  title: string;
  detail?: string;
  showSources?: boolean;
}>();

defineEmits<{
  (event: 'open-sources'): void;
}>();
</script>
