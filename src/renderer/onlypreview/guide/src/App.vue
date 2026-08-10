<template>
  <div name="onlypreview__guideApp" class="onlypreview-guide">
    <main name="onlypreview__guideContent" class="onlypreview-guide__content">
      <p class="onlypreview-guide__eyebrow">{{ onlyPreviewI18n.guide.eyebrow }}</p>
      <h1>{{ onlyPreviewI18n.guide.title }}</h1>

      <div
        v-if="onlyPreviewGuideStore.info?.serverName !== 'bitterless' && onlyPreviewGuideStore.info"
        name="onlypreview__guideTestWarning"
        class="onlypreview-guide__warning"
        role="alert"
      >
        <strong>{{ testInstanceTitle }}</strong>
        <span>{{ onlyPreviewI18n.guide.testInstanceWarning }}</span>
      </div>

      <section
        name="onlypreview__guideCompleteSetup"
        class="onlypreview-guide__copy-card"
      >
        <div class="onlypreview-guide__copy-card-heading">
          <div>
            <h2>{{ onlyPreviewI18n.guide.completeSetup }}</h2>
            <p>{{ onlyPreviewI18n.guide.completeSetupHint }}</p>
          </div>
          <a-button
            name="onlypreview__guideCopy"
            class="onlypreview-guide__copy-button"
            type="primary"
            size="mini"
            :title="onlyPreviewI18n.guide.copy"
            :aria-label="onlyPreviewI18n.guide.copy"
            :disabled="onlyPreviewGuideStore.status !== 'ready'"
            @click="onlyPreviewGuideStore.copyCompleteSetup()"
          >
            <template #icon><IconCopy :size="15" aria-hidden="true" /></template>
          </a-button>
        </div>

        <p
          v-if="onlyPreviewGuideStore.status === 'pending'"
          class="onlypreview-guide__status"
          role="status"
        >
          {{ onlyPreviewI18n.guide.pending }}
        </p>
        <div
          v-else-if="onlyPreviewGuideStore.status === 'restart-required'"
          class="onlypreview-guide__status onlypreview-guide__status--error"
          role="alert"
        >
          <strong>{{ onlyPreviewI18n.guide.restartRequiredTitle }}</strong>
          <span>{{ onlyPreviewI18n.guide.restartRequired }}</span>
        </div>
        <p
          v-else-if="onlyPreviewGuideStore.feedback"
          class="onlypreview-guide__status"
          :class="{
            'onlypreview-guide__status--error': onlyPreviewGuideStore.feedback === 'copy-failed'
          }"
          role="status"
        >
          {{ feedbackMessage }}
        </p>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watchEffect } from 'vue';
import { IconCopy } from '@tabler/icons-vue';
import { interpolateOnlyPreview } from '../../common/onlyPreviewFormat';
import { onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { onlyPreviewGuideStore } from './onlyPreviewGuide.store';

const testInstanceTitle = computed(() =>
  interpolateOnlyPreview(onlyPreviewI18n.guide.testInstanceTitle, {
    serverName: onlyPreviewGuideStore.info?.serverName || ''
  })
);

const feedbackMessage = computed(() =>
  onlyPreviewGuideStore.feedback === 'copied'
    ? onlyPreviewI18n.guide.copied
    : onlyPreviewI18n.guide.copyFailed
);

onMounted(() => {
  void onlyPreviewGuideStore.initialize();
});

watchEffect(() => {
  document.title = onlyPreviewI18n.guide.title;
});
</script>

<style lang="less">
@import './App.less';
</style>
