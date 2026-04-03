<template>
  <div
    :class="[
      'session-item',
      {
        'session-item--active': isActive,
        'session-item--pinned': session.pinned,
      },
    ]"
    @click="onClick"
  >
    <div class="session-item__content">
      <div class="session-item__title">{{ session.title || i18nHelper.chat.untitled }}</div>
      <div class="session-item__time">{{ formatTime(session.createdAt) }}</div>
    </div>
    <div v-if="session.pinned" class="session-item__pin-badge" />
  </div>
</template>

<script setup lang="ts">
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { SessionItem } from '../../store/session.store';
import moment from 'moment';
interface Props {
  session: SessionItem;
  isActive: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  select: [sessionId: string];
}>();

const onClick = () => {
  emit('select', props.session.sessionId);
};

const formatTime = (time: string | number): string => {
  return moment(time).format('MM-DD HH:mm');
};
</script>

<style lang="less">
@import './SessionItem.less';
</style>
