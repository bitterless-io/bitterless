<template>
  <ol name="trench__sniping__evidence-rail" class="sniping-evidence-rail">
    <li
      v-for="stage in stages"
      :key="stage.key"
      name="trench__sniping__evidence-stage"
      :class="`sniping-evidence-rail__stage--${stage.state}`"
    >
      <span class="sniping-evidence-rail__marker" aria-hidden="true" />
      <div><strong>{{ stage.label }}</strong><small>{{ stage.detail }}</small></div>
    </li>
  </ol>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { snipingStore as store } from '../../views/sniping/sniping.runtime';

const { t } = useI18n();
const stages = computed(() => store.evidenceStages.map((stage) => ({
  ...stage,
  label: t(`trench.sniping.evidence.${stage.key === 'exact' ? 'exactCall' : stage.key}`),
  detail: stage.detail === 'positionCount'
    ? t('trench.sniping.evidence.positionCount', { count: stage.count })
    : stage.translated
      ? t(`trench.sniping.evidence.${stage.detail}`)
      : stage.detail,
})));
</script>
