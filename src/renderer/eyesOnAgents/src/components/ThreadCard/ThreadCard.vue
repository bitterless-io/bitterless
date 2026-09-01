<template>
  <a-dropdown
    :popup-visible="contextMenuVisible"
    trigger="contextMenu"
    position="bottom"
    :align-point="true"
    :auto-fit-position="true"
    :scroll-to-close="true"
    popup-container="body"
    @popup-visible-change="handleContextMenuVisibleChange"
  >
    <article
      name="eyesOnAgents__threadCard"
      class="thread-card"
      :data-thread-id="thread.threadId"
      :data-session-key="thread.sessionKey"
      :data-provider="thread.provider"
      :tabindex="canOpenThread ? 0 : undefined"
      :aria-label="cardAriaLabel"
      @contextmenu.capture="handleContextMenuRequest"
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

            <a-dropdown
              :popup-visible="moreMenuVisible"
              trigger="click"
              position="br"
              popup-container="body"
              @popup-visible-change="handleMoreMenuVisibleChange"
            >
              <a-button
                class="thread-card__more-control thread-card__control"
                size="mini"
                type="text"
                :aria-label="i18nHelper.eyesOnAgents.actions.more"
                aria-haspopup="menu"
                :aria-expanded="moreMenuVisible"
                @click.stop
              >
                <template #icon><IconDots :size="12" /></template>
              </a-button>
              <template #content>
                <ThreadCardMenu
                  :thread="thread"
                  @open="handleOpen"
                  @toggle-read-state="handleToggleReadState"
                  @copy-session-path="handleCopySessionPath"
                  @archive="handleArchive"
                />
              </template>
            </a-dropdown>
          </div>
        </div>
      </div>
    </article>
    <template #content>
      <ThreadCardMenu
        :thread="thread"
        @open="handleOpen"
        @toggle-read-state="handleToggleReadState"
        @copy-session-path="handleCopySessionPath"
        @archive="handleArchive"
      />
    </template>
  </a-dropdown>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { IconDots, IconFolder } from '@tabler/icons-vue';
import type { EyesOnAgentsThread } from '@shared/eyesOnAgents/eyesOnAgents.type';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import ProviderGlyph from '../ProviderGlyph/ProviderGlyph.vue';
import ThreadCardMenu from './ThreadCardMenu.vue';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';
import { globalStore } from '../../store/global.store';

const props = defineProps<{ thread: EyesOnAgentsThread }>();
const moreMenuVisible = ref(false);
const contextMenuVisible = ref(false);
let replayingContextMenu = false;

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

const closeMenus = (): void => {
  moreMenuVisible.value = false;
  contextMenuVisible.value = false;
};

const handleMoreMenuVisibleChange = (visible: boolean): void => {
  moreMenuVisible.value = visible;
  if (visible) contextMenuVisible.value = false;
};

const handleContextMenuVisibleChange = (visible: boolean): void => {
  contextMenuVisible.value = visible;
  if (visible) moreMenuVisible.value = false;
};

const handleContextMenuRequest = (event: MouseEvent): void => {
  if (!contextMenuVisible.value || replayingContextMenu) return;
  const card = event.currentTarget as HTMLElement | null;
  if (!card) return;
  // Arco toggles an open context-menu Trigger before refreshing align-point.
  // Close it first, then replay after the controlled prop reaches the Trigger.
  event.preventDefault();
  event.stopImmediatePropagation();
  contextMenuVisible.value = false;
  void nextTick(() => {
    if (!card.isConnected) return;
    replayingContextMenu = true;
    try {
      card.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        composed: event.composed,
        view: event.view,
        detail: event.detail,
        screenX: event.screenX,
        screenY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        button: event.button,
        buttons: event.buttons,
      }));
    } finally {
      replayingContextMenu = false;
    }
  });
};

const handleOpen = async (): Promise<void> => {
  closeMenus();
  if (!canOpenThread.value) return;
  await eyesOnAgentsStore.openThread(props.thread.sessionKey).catch(() => undefined);
};

const handleCopySessionPath = async (): Promise<void> => {
  closeMenus();
  await eyesOnAgentsStore.copySessionPath(props.thread.sessionKey).catch(() => undefined);
};

const handleToggleReadState = async (): Promise<void> => {
  closeMenus();
  await eyesOnAgentsStore
    .setThreadUnread(props.thread.sessionKey, !props.thread.isUnread)
    .catch(() => undefined);
};

const handleArchive = async (): Promise<void> => {
  closeMenus();
  await eyesOnAgentsStore.archiveThread(props.thread.sessionKey).catch(() => undefined);
};

const handleDoubleClick = async (event: MouseEvent): Promise<void> => {
  if ((event.target as HTMLElement).closest('.thread-card__control')) return;
  await handleOpen();
};
</script>

<style lang="less">
@import './ThreadCard.less';
</style>
