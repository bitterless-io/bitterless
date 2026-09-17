<template>
  <div name="onlypreview__detachedApp" class="onlypreview-detached">
    <main name="onlypreview__detachedContent" class="onlypreview-detached__content">
      <h1 class="onlypreview-detached__title">{{ onlyPreviewI18n.detached.title }}</h1>
      <p class="onlypreview-detached__body">{{ onlyPreviewI18n.detached.body }}</p>
      <a-button
        name="onlypreview__detachedFocusWindow"
        class="onlypreview-detached__focus"
        type="primary"
        size="mini"
        @click="focusWindow()"
      >
        {{ onlyPreviewI18n.detached.focusWindow }}
      </a-button>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewI18n } from '../../common/onlyPreviewI18n';

/**
 * 前往那个窗口 —— 这一整页唯一的动作,所以它没有 store。
 *
 * **不带 `hostToken`**:这一格不持有承载能力,它只是一张纸(方案 #2)。Main 侧那一步是幂等的
 * (活窗口 `show()`+`focus()`;窗口已经死了就走升格,已经有 cowork 承载之后是 no-op),所以这里
 * 不需要 pending 态,也不需要看返回值 —— 连点就是连点。
 */
const focusWindow = async (): Promise<void> => {
  await onlyPreviewClient.focusOnlyPreviewWindow();
};
</script>

<style lang="less">
@import './App.less';
</style>
