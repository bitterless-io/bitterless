<template>
  <article
    name="eyesOnAgents__threadCard"
    class="thread-card"
    :data-thread-id="thread.threadId"
    :data-session-key="thread.sessionKey"
    :data-provider="thread.provider"
    :tabindex="canOpenThread ? 0 : undefined"
    :aria-label="cardAriaLabel"
    @dblclick="handleDoubleClick"
    @keydown.enter.prevent="handleOpen"
  >
    <div class="thread-card__content">
      <div class="thread-card__title-row">
        <ProviderGlyph :provider="thread.provider" />
        <h3 class="thread-card__title" :title="displayTitle">{{ displayTitle }}</h3>
        <span
          v-if="isActiveRuntime"
          class="thread-card__status"
          role="status"
          :aria-label="runtimeLabel"
        >
          <a-spin :size="12" aria-hidden="true" />
        </span>
        <span
          v-else-if="showUnreadDot"
          class="thread-card__status"
          role="img"
          :aria-label="i18nHelper.eyesOnAgents.thread.new"
        >
          <span class="thread-card__unread-dot" aria-hidden="true" />
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

          <a-dropdown trigger="click" position="br">
            <a-button
              class="thread-card__more-control thread-card__control"
              size="mini"
              type="text"
              :aria-label="i18nHelper.eyesOnAgents.actions.more"
              @click.stop
            >
              <template #icon><IconDots :size="12" /></template>
            </a-button>
            <template #content>
              <a-doption
                v-if="canOpenThread"
                class="thread-card__option"
                :disabled="eyesOnAgentsStore.openingSessionKeys.has(thread.sessionKey)"
                @click="handleOpen"
              >
                <IconExternalLink :size="13" />
                <span class="thread-card__option-label">{{ openLabel }}</span>
                {{ ' ' }}
                <span class="thread-card__option-hint">
                  {{ i18nHelper.eyesOnAgents.actions.doubleClickHint }}
                </span>
              </a-doption>
              <a-doption
                v-if="canOpenInIterm2"
                class="thread-card__option"
                :disabled="eyesOnAgentsStore.openingSessionKeys.has(thread.sessionKey)"
                @click="handleOpenInIterm2"
              >
                <IconTerminal2 :size="13" />
                <span class="thread-card__option-label">
                  {{ i18nHelper.eyesOnAgents.actions.openInIterm2 }}
                </span>
              </a-doption>
              <a-doption
                class="thread-card__option"
                :disabled="eyesOnAgentsStore.busyAction !== null"
                @click="handleToggleReadState"
              >
                <IconCircle v-if="thread.isUnread" :size="13" />
                <IconCircleDot v-else :size="13" />
                <span class="thread-card__option-label">{{ readStateLabel }}</span>
              </a-doption>
              <a-doption
                v-if="thread.canCopySessionPath"
                class="thread-card__option"
                :disabled="eyesOnAgentsStore.busyAction !== null"
                @click="handleCopySessionPath"
              >
                <IconClipboardText :size="13" />
                <span class="thread-card__option-label">
                  {{ i18nHelper.eyesOnAgents.actions.copySessionPath }}
                </span>
              </a-doption>
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
  IconCircle,
  IconCircleDot,
  IconClipboardText,
  IconDots,
  IconExternalLink,
  IconFolder,
  IconTerminal2,
} from '@tabler/icons-vue';
import type { EyesOnAgentsThread } from '@shared/eyesOnAgents/eyesOnAgents.type';
import { isEyesOnAgentsTerminal } from '@shared/eyesOnAgents/eyesOnAgents.contract';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import ProviderGlyph from '../ProviderGlyph/ProviderGlyph.vue';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';
import { globalStore } from '../../store/global.store';

const props = defineProps<{ thread: EyesOnAgentsThread }>();

const displayTitle = computed(() =>
  props.thread.title?.trim()
  || `${props.thread.provider === 'claude'
    ? i18nHelper.eyesOnAgents.thread.untitledClaude
    : i18nHelper.eyesOnAgents.thread.untitledCodex} · ${props.thread.threadId.slice(0, 8)}`,
);
const providerLabel = computed(() => props.thread.provider === 'claude'
  ? i18nHelper.eyesOnAgents.provider.claude
  : i18nHelper.eyesOnAgents.provider.codex);
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
const isActiveRuntime = computed(() =>
  ['working', 'waiting_approval', 'waiting_input'].includes(props.thread.runtimeState));
const canOpenThread = computed(() => props.thread.provider === 'codex'
  || props.thread.desktopSessionId !== null);
const canOpenInIterm2 = computed(() => props.thread.iterm2SessionId !== null);
// Any non-active unread row shows the dot, including 'unknown'. Without this an
// authority-lost row is promoted to the unread tier with nothing to explain the
// position — see docs/issues/eyes-on-agents-restart-unknown-pinned.md.
const showUnreadDot = computed(() =>
  props.thread.isUnread && !isActiveRuntime.value);
const cardAriaLabel = computed(() => [
  providerLabel.value,
  displayTitle.value,
  runtimeLabel.value,
  promptAriaLabel.value,
  showUnreadDot.value ? i18nHelper.eyesOnAgents.thread.new : '',
].filter(Boolean).join(', '));
const folderLabel = computed(() => i18nHelper.eyesOnAgents.thread.workingDirectory
  .replace('{path}', props.thread.cwd ?? ''));
const openLabel = computed(() => props.thread.provider === 'claude'
  ? i18nHelper.eyesOnAgents.actions.openInClaude
  : i18nHelper.eyesOnAgents.actions.openInCodex);
const readStateLabel = computed(() => props.thread.isUnread
  ? i18nHelper.eyesOnAgents.actions.markRead
  : i18nHelper.eyesOnAgents.actions.markUnread);
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
  if (!canOpenThread.value) return;
  await eyesOnAgentsStore.openThread(props.thread.sessionKey).catch(() => undefined);
};

const handleOpenInIterm2 = async (): Promise<void> => {
  await eyesOnAgentsStore.openThreadInIterm2(props.thread.sessionKey).catch(() => undefined);
};

const handleCopySessionPath = async (): Promise<void> => {
  await eyesOnAgentsStore.copySessionPath(props.thread.sessionKey).catch(() => undefined);
};

const handleToggleReadState = async (): Promise<void> => {
  await eyesOnAgentsStore
    .setThreadUnread(props.thread.sessionKey, !props.thread.isUnread)
    .catch(() => undefined);
};

const handleDoubleClick = async (event: MouseEvent): Promise<void> => {
  if ((event.target as HTMLElement).closest('.thread-card__control')) return;
  await handleOpen();
};
</script>

<style lang="less">
@import './ThreadCard.less';
</style>
