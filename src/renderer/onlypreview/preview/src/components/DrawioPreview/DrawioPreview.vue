<template>
  <section
    name="onlypreview__drawioPreview"
    class="onlypreview-drawio"
    :aria-label="onlyPreviewI18n.preview.diagramLabel"
  >
    <div ref="mountElement" name="onlypreview__drawioCanvas" class="onlypreview-drawio__canvas" />
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import type { OnlyPreviewDrawioContent } from '../../onlyPreviewDrawio.service';
import { DrawioPreviewStore } from './DrawioPreview.store';

const props = defineProps<{
  content: OnlyPreviewDrawioContent;
  reportingRevision: string;
}>();

const mountElement = ref<HTMLElement | null>(null);
const drawioPreviewStore = new DrawioPreviewStore();

onMounted(() => {
  const mount = mountElement.value;
  if (!mount) return;
  void drawioPreviewStore.mount(mount, props.content, props.reportingRevision);
});

onBeforeUnmount(() => {
  drawioPreviewStore.dispose();
});
</script>

<style lang="less">
@import './DrawioPreview.less';
</style>
