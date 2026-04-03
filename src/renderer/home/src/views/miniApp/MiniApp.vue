<template>
  <div class="bl-full-container">
    <div class="mini-app-page">
      <div class="mini-app-page__grid">
        <a-card
          v-for="app in miniApps"
          :key="app.id"
          class="mini-app-page__card"
        >
          <template #title>
            <div class="mini-app-page__card-title">
              <img :src="app.icon" :alt="app.name" class="mini-app-page__card-icon" />
              <span>{{ app.name }}</span>
            </div>
          </template>
          <div class="mini-app-page__card-content">
            <p class="mini-app-page__card-subtitle">{{ app.subtitle }}</p>
          </div>
          <template #actions>
            <a-button type="primary" size="mini" @click="app.action">
              {{ i18nHelper.miniApp.open }}
            </a-button>
          </template>
        </a-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { todoWindowEmitter } from '@/emitter/todoWindow.emitter';
import { omniWindowEmitter } from '@/emitter/omniWindow.emitter';
import { createMiniApps } from './miniApps.constant';

const openTodo = () => {
  todoWindowEmitter.openTodoWindow();
};

const openOmniBrowser = async () => {
  await omniWindowEmitter.openOmniWindow();
};

const miniApps = computed(() => createMiniApps(openTodo, openOmniBrowser, i18nHelper));
</script>

<style lang="less">
@import './MiniApp.less';
</style>
