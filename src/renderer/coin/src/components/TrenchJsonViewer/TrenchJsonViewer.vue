<template>
  <section
    :name="`trench__detail__document-${kind}`"
    class="trench-json-viewer"
    :class="{ 'trench-json-viewer--compact': compact }"
  >
    <div class="trench-json-viewer__toolbar">
      <span>{{ title }}</span>
      <button
        :name="`trench__detail__copy-${kind}`"
        type="button"
        :aria-label="t('trench.actions.copyDocument', { document: title })"
        @click="copyDocument"
      >
        {{ copyState === 'copied' ? t('trench.actions.copied') : copyState === 'failed' ? t('trench.actions.copyFailed') : t('trench.actions.copyJson') }}
      </button>
      <span
        :name="`trench__detail__copy-status-${kind}`"
        class="trench-json-viewer__copy-status"
        role="status"
      >
        {{ copyState === 'copied' ? t('trench.actions.copied') : copyState === 'failed' ? t('trench.actions.copyFailed') : '' }}
      </span>
    </div>
    <div
      class="trench-json-viewer__scroll"
      role="region"
      tabindex="0"
      :aria-label="title"
    >
      <pre v-if="highlight" name="trench__detail__json" class="trench-json-viewer__document"><span v-for="(token, index) in tokens" :key="index" :class="`trench-json-viewer__token--${token.kind}`" v-text="token.text" /></pre>
      <pre v-else name="trench__detail__json" class="trench-json-viewer__document" v-text="document" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { shouldHighlightTrenchJsonDocument } from './trenchJsonViewer.service';

const props = withDefaults(defineProps<{
  document: string;
  title: string;
  kind: 'analysis' | 'tag' | 'holdings';
  compact?: boolean;
}>(), {
  compact: false,
});
const { t } = useI18n();
const copyState = ref<'idle' | 'copied' | 'failed'>('idle');
type JsonTokenKind = 'plain' | 'key' | 'string' | 'number' | 'literal';
interface JsonToken { kind: JsonTokenKind; text: string }

const tokenize = (document: string): JsonToken[] => {
  const pattern = /("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
  const tokens: JsonToken[] = [];
  let offset = 0;
  for (const match of document.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset) tokens.push({ kind: 'plain', text: document.slice(offset, index) });
    tokens.push({
      kind: match[1] ? 'key' : match[2] ? 'string' : match[3] ? 'number' : 'literal',
      text: match[0],
    });
    offset = index + match[0].length;
  }
  if (offset < document.length) tokens.push({ kind: 'plain', text: document.slice(offset) });
  return tokens;
};

const highlight = computed(() => shouldHighlightTrenchJsonDocument(props.document));
const tokens = computed(() => highlight.value ? tokenize(props.document) : []);
watch(() => props.document, () => {
  copyState.value = 'idle';
});

const copyDocument = async (): Promise<void> => {
  try {
    await navigator.clipboard.writeText(props.document);
    copyState.value = 'copied';
  } catch {
    copyState.value = 'failed';
  }
};
</script>

<style lang="less">
@import './TrenchJsonViewer.less';
</style>
