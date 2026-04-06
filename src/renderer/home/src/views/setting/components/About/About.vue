<template>
  <div class="about">
    <div class="about__header">
      <h3 class="about__title">{{ i18nHelper.setting.about.tabTitle }}</h3>
    </div>
    <div class="about__body">
      <div class="about__item">
        <div class="about__label">{{ i18nHelper.setting.about.appName }}</div>
        <div class="about__value">{{ aboutStore.appInfo.name }}</div>
      </div>
      <div class="about__item">
        <div class="about__label">{{ i18nHelper.setting.about.version }}</div>
        <div class="about__value">{{ aboutStore.appInfo.version }}</div>
      </div>
      <div class="about__item">
        <div class="about__label">{{ i18nHelper.setting.about.versionCode }}</div>
        <div class="about__value">{{ aboutStore.appInfo.versionCode }}</div>
      </div>
      <div class="about__item">
        <div class="about__label">{{ i18nHelper.setting.about.website }}</div>
        <div class="about__value">
          <a class="about__link" @click="handleOpenWebsite">
            {{ aboutStore.appInfo.website }}
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { aboutStore } from './about.store';

onMounted(() => {
  aboutStore.init();
});

const handleOpenWebsite = (): void => {
  aboutStore.openWebsite();
};
</script>

<style lang="less">
@import './About.less';
</style>
