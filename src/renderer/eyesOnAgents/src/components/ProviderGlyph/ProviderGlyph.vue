<template>
  <a-tooltip :content="providerLabel" position="top" mini>
    <span
      name="eyesOnAgents__providerGlyph"
      class="provider-glyph"
      :class="`provider-glyph--${provider}`"
      role="img"
      :aria-label="providerLabel"
    >
      <img
        v-if="provider === 'codex'"
        class="provider-glyph__image provider-glyph__image--codex"
        :src="codexLogo"
        alt=""
        aria-hidden="true"
        draggable="false"
      />
      <img
        v-else
        class="provider-glyph__image provider-glyph__image--claude"
        :src="claudeLogo"
        alt=""
        aria-hidden="true"
        draggable="false"
      />
    </span>
  </a-tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { EyesOnAgentsProvider } from '@shared/eyesOnAgents/eyesOnAgents.type';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import claudeLogo from '@renderer/common/assets/icons/providers/claude.png';
import codexLogo from '@renderer/common/assets/icons/providers/codex.png';

const props = defineProps<{ provider: EyesOnAgentsProvider }>();

const providerLabel = computed(() => props.provider === 'codex'
  ? i18nHelper.eyesOnAgents.provider.codex
  : i18nHelper.eyesOnAgents.provider.claude);
</script>

<style lang="less">
@import './ProviderGlyph.less';
</style>
