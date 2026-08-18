<template>
  <a-tooltip :content="providerLabel" position="top" mini>
    <span
      name="eyesOnAgents__providerGlyph"
      class="provider-glyph"
      :class="`provider-glyph--${provider}`"
      role="img"
      :aria-label="providerLabel"
    >
      <IconPrompt v-if="provider === 'codex'" :size="13" aria-hidden="true" />
      <IconSparkles v-else :size="13" aria-hidden="true" />
    </span>
  </a-tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconPrompt, IconSparkles } from '@tabler/icons-vue';
import type { EyesOnAgentsProvider } from '@shared/eyesOnAgents/eyesOnAgents.type';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

const props = defineProps<{ provider: EyesOnAgentsProvider }>();

const providerLabel = computed(() => props.provider === 'codex'
  ? i18nHelper.eyesOnAgents.provider.codex
  : i18nHelper.eyesOnAgents.provider.claude);
</script>

<style lang="less">
@import './ProviderGlyph.less';
</style>
