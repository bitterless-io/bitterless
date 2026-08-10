<template>
  <div
    name="trench__detail__structured-value"
    class="trench-structured-value"
    :class="`trench-structured-value--${kind}`"
    :data-path="path"
  >
    <template v-if="kind === 'string'">
      <span class="trench-structured-value__primitive" v-text="visibleString" />
      <button
        v-if="stringPreview.shortened"
        class="trench-structured-value__text-action"
        type="button"
        @click="stringExpanded = !stringExpanded"
      >
        {{ stringExpanded ? t('trench.structured.showLess') : t('trench.structured.showFullText') }}
      </button>
    </template>
    <span
      v-else-if="kind === 'number'"
      class="trench-structured-value__primitive"
      v-text="String(value)"
    />
    <span v-else-if="kind === 'boolean'" class="trench-structured-value__primitive">
      {{ value ? t('trench.structured.true') : t('trench.structured.false') }}
    </span>
    <span
      v-else-if="kind === 'null'"
      class="trench-structured-value__primitive trench-structured-value__primitive--empty"
    >
      {{ t('trench.structured.null') }}
    </span>
    <details
      v-else
      class="trench-structured-value__container"
      :open="initiallyExpanded"
      @toggle="handleToggle"
    >
      <summary>
        {{
          kind === 'array'
            ? t('trench.structured.items', { count: entries.length })
            : t('trench.structured.fields', { count: entries.length })
        }}
      </summary>
      <div v-if="expanded" class="trench-structured-value__children">
        <span v-if="entries.length === 0" class="trench-structured-value__empty">
          {{
            kind === 'array' ? t('trench.structured.emptyList') : t('trench.structured.emptyObject')
          }}
        </span>
        <div v-for="entry in visibleEntries" :key="entry.path" class="trench-structured-value__row">
          <span class="trench-structured-value__key" v-text="entry.key" />
          <TrenchStructuredValue :value="entry.value" :path="entry.path" />
        </div>
        <button
          v-if="visibleEntries.length < entries.length"
          class="trench-structured-value__more"
          type="button"
          @click="visibleCount += TRENCH_STRUCTURED_VALUE_PAGE_SIZE"
        >
          {{
            t('trench.structured.showMore', {
              count: Math.min(
                TRENCH_STRUCTURED_VALUE_PAGE_SIZE,
                entries.length - visibleEntries.length
              )
            })
          }}
        </button>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  TRENCH_STRUCTURED_VALUE_PAGE_SIZE,
  trenchStructuredEntries,
  trenchStructuredStringPreview,
  trenchStructuredValueKind
} from './trenchStructuredValue.service';

defineOptions({ name: 'TrenchStructuredValue' });

const props = withDefaults(
  defineProps<{
    value: unknown;
    path: string;
    initiallyExpanded?: boolean;
  }>(),
  {
    initiallyExpanded: false
  }
);

const { t } = useI18n();
const expanded = ref(props.initiallyExpanded);
const stringExpanded = ref(false);
const visibleCount = ref(TRENCH_STRUCTURED_VALUE_PAGE_SIZE);
const kind = computed(() => trenchStructuredValueKind(props.value));
const entries = computed(() => trenchStructuredEntries(props.value, props.path));
const visibleEntries = computed(() => entries.value.slice(0, visibleCount.value));
const stringPreview = computed(() => trenchStructuredStringPreview(String(props.value)));
const visibleString = computed(() =>
  stringExpanded.value ? String(props.value) : stringPreview.value.text
);

const handleToggle = (event: Event): void => {
  expanded.value = (event.currentTarget as HTMLDetailsElement).open;
};
</script>

<style lang="less">
@import './TrenchStructuredValue.less';
</style>
