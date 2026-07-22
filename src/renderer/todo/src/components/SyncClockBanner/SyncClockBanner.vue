<template>
  <a-alert v-if="clock" class="todo-sync-clock" type="error" :show-icon="true">
    <template #title>{{ i18nHelper.todo.syncClockWrongTitle }}</template>
    <div class="todo-sync-clock__content">
      <span>{{ i18nHelper.todo.syncClockWrongDescription }}</span>
      <span class="todo-sync-clock__times">
        {{ i18nHelper.todo.syncClockLocal }}: {{ formatTime(clock.local_time_ms) }} ·
        {{ i18nHelper.todo.syncClockTrusted }}: {{ formatTime(clock.trusted_time_ms) }} ·
        {{ i18nHelper.todo.syncClockOffset }}: {{ formatOffset(clock.offset_ms) }} ·
        {{ i18nHelper.todo.syncClockLastCheck }}: {{ formatTime(clock.last_success_at) }}
      </span>
    </div>
    <template #action>
      <a-button size="mini" type="primary" @click="handleOpenDateTimeSettings">
        {{ i18nHelper.todo.syncClockOpenSettings }}
      </a-button>
    </template>
  </a-alert>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import dayjs from 'dayjs';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { todoistSyncStore } from '../../store/todoistSync.store';
import { observeTodoMutation } from '../../store/todoMutation.service';

const clock = computed(() => todoistSyncStore.clockState?.status === 'clock_wrong'
  ? todoistSyncStore.clockState
  : null);
const formatTime = (value: number): string => dayjs(value).format('YYYY-MM-DD HH:mm:ss');
const formatOffset = (value: number): string => `${value >= 0 ? '+' : ''}${Math.round(value / 1000)}s`;
const handleOpenDateTimeSettings = (): void => {
  void observeTodoMutation(() => todoistSyncStore.openDateTimeSettings());
};
</script>

<style lang="less">
@import './SyncClockBanner.less';
</style>
