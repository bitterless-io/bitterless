<template>
  <article
    name="eyesOnAgents__threadCard"
    class="thread-card"
    :data-thread-id="thread.threadId"
    tabindex="0"
    :aria-label="cardAriaLabel"
    @dblclick="handleDoubleClick"
    @keydown.enter.prevent="handleOpen"
  >
    <div class="thread-card__content">
      <div class="thread-card__title-row">
        <h3 class="thread-card__title" :title="displayTitle">{{ displayTitle }}</h3>
        <span
          v-if="thread.runtimeState === 'working'"
          class="thread-card__working"
          role="status"
          :aria-label="runtimeLabel"
        >
          <a-spin :size="12" aria-hidden="true" />
        </span>
      </div>

      <p
        v-if="promptDisplay !== null"
        class="thread-card__prompt"
        :title="promptAriaLabel"
        :aria-label="promptAriaLabel"
      >
        {{ promptDisplay }}
      </p>

      <div class="thread-card__actions">
        <span class="thread-card__time">{{ activityLabel }}</span>

        <div class="thread-card__controls" @keydown.enter.stop>
          <a-tooltip v-if="thread.cwd" :content="folderLabel" position="top" mini>
            <span
              class="thread-card__folder"
              role="img"
              :title="folderLabel"
              :aria-label="folderLabel"
            >
              <IconFolder :size="10" aria-hidden="true" />
            </span>
          </a-tooltip>

          <a-tooltip :content="i18nHelper.eyesOnAgents.actions.open" position="top" mini>
            <span class="thread-card__open-control thread-card__control">
              <a-button
                size="mini"
                type="primary"
                :title="i18nHelper.eyesOnAgents.actions.open"
                :aria-label="openAriaLabel"
                :loading="eyesOnAgentsStore.openingThreadIds.has(thread.threadId)"
                :disabled="eyesOnAgentsStore.openingThreadIds.has(thread.threadId)"
                @click.stop="handleOpen"
              >
                <template #icon><IconExternalLink :size="9" /></template>
              </a-button>
              <span
                v-if="showUnreadDot"
                class="thread-card__unread-dot"
                aria-hidden="true"
              />
            </span>
          </a-tooltip>

          <a-dropdown trigger="click" position="br">
            <a-button
              class="thread-card__control"
              size="mini"
              type="text"
              :aria-label="i18nHelper.eyesOnAgents.actions.more"
              @click.stop
            >
              <template #icon><IconDots :size="12" /></template>
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
import { globalStore } from '../../store/global.store';

const props = defineProps<{ thread: EyesOnAgentsThread }>();

const displayTitle = computed(() =>
  props.thread.title?.trim()
  || `${i18nHelper.eyesOnAgents.thread.untitled} · ${props.thread.threadId.slice(0, 8)}`,
);
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
const storedPrompt = computed(() => props.thread.lastUserPrompt.preview ?? '');
const hasAvailablePrompt = computed(() =>
  props.thread.lastUserPrompt.state === 'available'
  && Boolean(props.thread.lastUserPrompt.preview));
const promptDisplay = computed(() => {
  if (props.thread.lastUserPrompt.state === 'pending') {
    return i18nHelper.eyesOnAgents.thread.latestQuestionPending;
  }
  if (!hasAvailablePrompt.value) return null;
  return storedPrompt.value.replace(/\s+/gu, ' ').trim() || null;
});
const promptAriaLabel = computed(() => {
  if (props.thread.lastUserPrompt.state === 'pending') {
    return i18nHelper.eyesOnAgents.thread.latestQuestionPending;
  }
  if (!hasAvailablePrompt.value || promptDisplay.value === null) return '';
  const prompt = i18nHelper.eyesOnAgents.thread.latestQuestion
    .replace('{question}', storedPrompt.value);
  return props.thread.lastUserPrompt.truncated
    ? `${prompt} ${i18nHelper.eyesOnAgents.thread.latestQuestionTruncated}`
    : prompt;
});
const cardAriaLabel = computed(() => [
  displayTitle.value,
  runtimeLabel.value,
  promptAriaLabel.value,
].filter(Boolean).join(', '));
const folderLabel = computed(() => i18nHelper.eyesOnAgents.thread.workingDirectory
  .replace('{path}', props.thread.cwd ?? ''));
const showUnreadDot = computed(() =>
  props.thread.isUnread && props.thread.runtimeState === 'idle');
const openAriaLabel = computed(() => showUnreadDot.value
  ? `${i18nHelper.eyesOnAgents.actions.open}, ${i18nHelper.eyesOnAgents.thread.new}`
  : i18nHelper.eyesOnAgents.actions.open);
const activityLabel = computed(() => {
  const value = props.thread.lastActivityAt ?? props.thread.lastCompletedAt;
  if (!value) return i18nHelper.eyesOnAgents.thread.unknown;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return i18nHelper.eyesOnAgents.thread.unknown;
  const minutes = Math.max(0, Math.floor((globalStore.currentTime - timestamp) / 60_000));
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
  if ((event.target as HTMLElement).closest('.thread-card__control')) return;
  await handleOpen();
};

const handleMove = async (domainId: number): Promise<void> => {
  await eyesOnAgentsStore.moveThread(props.thread.threadId, domainId).catch(() => undefined);
};

const domainLabel = (domain: EyesOnAgentsDomain): string =>
  domain.domainKey === 'uncategorized'
    ? i18nHelper.eyesOnAgents.board.all
    : domain.title;
</script>

<style lang="less">
@import './ThreadCard.less';
</style>
