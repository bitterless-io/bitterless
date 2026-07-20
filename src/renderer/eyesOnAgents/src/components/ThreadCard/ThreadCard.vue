<template>
  <article
    name="eyesOnAgents__threadCard"
    class="thread-card"
    :class="[`thread-card--${thread.runtimeState}`, { 'thread-card--unread': thread.isUnread }]"
    :data-thread-id="thread.threadId"
    tabindex="0"
    :aria-label="`${displayTitle}, ${runtimeLabel}`"
    @dblclick="handleDoubleClick"
    @keydown.enter.prevent="handleOpen"
  >
    <div class="thread-card__content">
      <div class="thread-card__status-row">
        <span class="thread-card__runtime">{{ runtimeLabel }}</span>
        <span v-if="thread.isUnread" class="thread-card__new-badge">
          {{ i18nHelper.eyesOnAgents.thread.new }}
        </span>
      </div>

      <h3 class="thread-card__title" :title="displayTitle">{{ displayTitle }}</h3>

      <div class="thread-card__meta">
        <span v-if="thread.cwd" class="thread-card__path" :title="thread.cwd">
          <IconFolder :size="13" />
          <span>{{ displayPath }}</span>
        </span>
        <span class="thread-card__time">{{ activityLabel }}</span>
      </div>

      <div class="thread-card__actions" @keydown.enter.stop>
        <a-tooltip :content="i18nHelper.eyesOnAgents.actions.open" position="top" mini>
          <a-button
            size="mini"
            type="primary"
            :title="i18nHelper.eyesOnAgents.actions.open"
            :aria-label="i18nHelper.eyesOnAgents.actions.open"
            :loading="eyesOnAgentsStore.openingThreadIds.has(thread.threadId)"
            :disabled="eyesOnAgentsStore.openingThreadIds.has(thread.threadId)"
            @click.stop="handleOpen"
          >
            <template #icon><IconExternalLink :size="13" /></template>
          </a-button>
        </a-tooltip>

        <a-dropdown trigger="click" position="br">
          <a-button
            size="mini"
            type="text"
            :aria-label="i18nHelper.eyesOnAgents.actions.more"
            @click.stop
          >
            <template #icon><IconDots :size="16" /></template>
          </a-button>
          <template #content>
            <a-dgroup :title="i18nHelper.eyesOnAgents.actions.moveTo">
              <a-doption
                v-for="domain in eyesOnAgentsStore.domains"
                :key="domain.id"
                :disabled="domain.id === thread.domainId"
                @click="handleMove(domain.id)"
              >
                <IconCheck
                  :size="13"
                  :class="{ 'thread-card__check--hidden': domain.id !== thread.domainId }"
                />
                {{ domainLabel(domain) }}
              </a-doption>
            </a-dgroup>
          </template>
        </a-dropdown>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  IconCheck,
  IconDots,
  IconExternalLink,
  IconFolder,
} from '@tabler/icons-vue';
import type {
  EyesOnAgentsDomain,
  EyesOnAgentsThread,
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

const props = defineProps<{ thread: EyesOnAgentsThread }>();

const displayTitle = computed(() =>
  props.thread.title?.trim()
  || `${i18nHelper.eyesOnAgents.thread.untitled} · ${props.thread.threadId.slice(0, 8)}`,
);
const displayPath = computed(() => {
  const path = props.thread.cwd?.replace(/[\\/]+$/, '') ?? '';
  const segments = path.split(/[\\/]/).filter(Boolean);
  if (segments.length <= 2) return path;
  return `…/${segments.slice(-2).join('/')}`;
});
const runtimeLabel = computed(() => {
  switch (props.thread.runtimeState) {
    case 'working': return i18nHelper.eyesOnAgents.thread.working;
    case 'waiting_approval': return i18nHelper.eyesOnAgents.thread.waitingApproval;
    case 'waiting_input': return i18nHelper.eyesOnAgents.thread.waitingInput;
    case 'idle': return i18nHelper.eyesOnAgents.thread.idle;
    case 'failed': return i18nHelper.eyesOnAgents.thread.failed;
    case 'ended': return i18nHelper.eyesOnAgents.thread.ended;
    default: return i18nHelper.eyesOnAgents.thread.unknown;
  }
});
const activityLabel = computed(() => {
  const value = props.thread.lastActivityAt ?? props.thread.lastCompletedAt;
  if (!value) return i18nHelper.eyesOnAgents.thread.unknown;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return i18nHelper.eyesOnAgents.thread.unknown;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return i18nHelper.eyesOnAgents.thread.justNow;
  if (minutes < 60) {
    return i18nHelper.eyesOnAgents.thread.minutesAgo.replace('{count}', String(minutes));
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return i18nHelper.eyesOnAgents.thread.hoursAgo.replace('{count}', String(hours));
  }
  return i18nHelper.eyesOnAgents.thread.daysAgo.replace('{count}', String(Math.floor(hours / 24)));
});

const handleOpen = async (): Promise<void> => {
  await eyesOnAgentsStore.openThread(props.thread.threadId).catch(() => undefined);
};

const handleDoubleClick = async (event: MouseEvent): Promise<void> => {
  if ((event.target as HTMLElement).closest('.thread-card__actions')) return;
  await handleOpen();
};

const handleMove = async (domainId: number): Promise<void> => {
  await eyesOnAgentsStore.moveThread(props.thread.threadId, domainId).catch(() => undefined);
};

const domainLabel = (domain: EyesOnAgentsDomain): string =>
  domain.domainKey === 'uncategorized'
    ? i18nHelper.eyesOnAgents.board.uncategorized
    : domain.title;
</script>

<style lang="less">
@import './ThreadCard.less';
</style>
