<template>
  <article
    name="codingAgentSessions__sessionRow"
    class="coding-agent-session-row"
    :class="`coding-agent-session-row--${displayState}`"
  >
    <span class="coding-agent-session-row__rail" aria-hidden="true" />

    <div class="coding-agent-session-row__identity">
      <div class="coding-agent-session-row__kicker">
        <span>{{ providerLabel }}</span>
        <span>{{ surfaceLabel }}</span>
      </div>
      <strong class="coding-agent-session-row__title">{{ displayTitle }}</strong>
      <code class="coding-agent-session-row__id">{{ session.externalSessionId }}</code>
      <span v-if="session.cwd" class="coding-agent-session-row__cwd" :title="session.cwd">
        <IconFolder :size="13" aria-hidden="true" />
        {{ session.cwd }}
      </span>
    </div>

    <div class="coding-agent-session-row__evidence">
      <span class="coding-agent-session-row__label">
        {{ i18nHelper.codingAgentSessions.labels.evidence }}
      </span>
      <strong>{{ sourceLabel }}</strong>
      <span>{{ freshnessLabel }}</span>
      <span v-if="session.providerState && session.state === 'failed'">
        {{ i18nHelper.codingAgentSessions.labels.providerState }} · {{ session.providerState }}
      </span>
    </div>

    <div class="coding-agent-session-row__status">
      <span
        class="coding-agent-session-row__state"
        :class="`coding-agent-session-state--${displayState}`"
      >
        {{ stateLabel }}
      </span>
      <span> {{ i18nHelper.codingAgentSessions.labels.lastTurn }} · {{ turnLabel }} </span>
    </div>

    <div class="coding-agent-session-row__actions">
      <a-tooltip :content="actionReason || primaryLabel" position="top">
        <span>
          <a-button
            type="primary"
            size="mini"
            :loading="store.openingIds.has(session.id)"
            :disabled="primaryAction.disabled || store.openingIds.has(session.id)"
            @click="store.openSession(session)"
          >
            {{ primaryLabel }}
          </a-button>
        </span>
      </a-tooltip>
      <a-dropdown trigger="click" position="br">
        <a-button size="mini" :aria-label="i18nHelper.codingAgentSessions.actions.more">
          <template #icon><IconDots :size="15" /></template>
        </a-button>
        <template #content>
          <a-doption @click="store.openRenameDialog(session)">
            <IconPencil :size="14" />
            {{ i18nHelper.codingAgentSessions.actions.rename }}
          </a-doption>
          <a-doption @click="store.copySessionId(session)">
            <IconCopy :size="14" />
            {{
              store.copiedSessionId === session.id
                ? i18nHelper.codingAgentSessions.actions.copied
                : i18nHelper.codingAgentSessions.actions.copyId
            }}
          </a-doption>
          <a-doption
            class="coding-agent-session-row__remove"
            @click="store.openRemoveDialog(session)"
          >
            <IconTrash :size="14" />
            {{ i18nHelper.codingAgentSessions.actions.remove }}
          </a-doption>
        </template>
      </a-dropdown>
    </div>

    <div
      v-if="actionReason || actionError || session.state === 'failed'"
      name="codingAgentSessions__sessionNotice"
      class="coding-agent-session-row__notice"
      :class="{ 'coding-agent-session-row__notice--danger': Boolean(actionError) }"
      role="status"
    >
      <IconInfoCircle :size="14" aria-hidden="true" />
      <span>{{ actionErrorLabel || actionReason || failedNotice }}</span>
      <code v-if="actionError?.detail">{{ actionError.detail }}</code>
      <a-button
        v-if="primaryAction.reason === 'liveness-unknown' || session.state === 'failed'"
        size="mini"
        @click="store.refresh(session.provider)"
      >
        {{ i18nHelper.codingAgentSessions.actions.refreshProvider }}
      </a-button>
      <a-button v-else-if="actionError" size="mini" @click="store.openSession(session)">
        {{ i18nHelper.codingAgentSessions.actions.retry }}
      </a-button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  IconCopy,
  IconDots,
  IconFolder,
  IconInfoCircle,
  IconPencil,
  IconTrash
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type {
  CodingAgentSessionRecord,
  CodingAgentStatusSource,
  CodingAgentSurface,
  CodingAgentTurnState
} from '@shared/codingAgent/codingAgentSession.type';
import { codingAgentSessionStore as store } from '../../codingAgentSession.store';
import type { CodingAgentDisplayState } from '../../codingAgentSession.type';

const props = defineProps<{ session: CodingAgentSessionRecord }>();

const displayState = computed(() => store.displayState(props.session));
const primaryAction = computed(() => store.primaryAction(props.session));
const actionError = computed(() => store.actionErrors[props.session.id]);
const displayTitle = computed(() => {
  if (props.session.title) return props.session.title;
  const id = props.session.externalSessionId;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
});
const providerLabel = computed(
  () => i18nHelper.codingAgentSessions.providers[props.session.provider]
);

const surfaceLabels = (): Record<CodingAgentSurface, string> => ({
  'codex-desktop': i18nHelper.codingAgentSessions.surfaces.codexDesktop,
  'codex-managed-app-server': i18nHelper.codingAgentSessions.surfaces.codexManaged,
  'claude-code-background': i18nHelper.codingAgentSessions.surfaces.claudeBackground,
  'claude-code-cli': i18nHelper.codingAgentSessions.surfaces.claudeCli,
  'claude-desktop-chat': i18nHelper.codingAgentSessions.surfaces.claudeDesktopChat,
  'claude-desktop-code': i18nHelper.codingAgentSessions.surfaces.claudeDesktopCode
});
const surfaceLabel = computed(() => surfaceLabels()[props.session.surface]);

const stateLabels = (): Record<CodingAgentDisplayState, string> => ({
  working: i18nHelper.codingAgentSessions.states.working,
  waiting_approval: i18nHelper.codingAgentSessions.states.waitingApproval,
  waiting_input: i18nHelper.codingAgentSessions.states.waitingInput,
  turn_complete: i18nHelper.codingAgentSessions.states.turnComplete,
  idle: i18nHelper.codingAgentSessions.states.idle,
  failed: i18nHelper.codingAgentSessions.states.failed,
  stopped: i18nHelper.codingAgentSessions.states.stopped,
  ended: i18nHelper.codingAgentSessions.states.ended,
  unknown: i18nHelper.codingAgentSessions.states.unknown
});
const stateLabel = computed(() => stateLabels()[displayState.value]);

const turnLabels = (): Record<CodingAgentTurnState, string> => ({
  in_progress: i18nHelper.codingAgentSessions.turns.inProgress,
  completed: i18nHelper.codingAgentSessions.turns.completed,
  interrupted: i18nHelper.codingAgentSessions.turns.interrupted,
  failed: i18nHelper.codingAgentSessions.turns.failed,
  unknown: i18nHelper.codingAgentSessions.turns.unknown
});
const turnLabel = computed(() => turnLabels()[props.session.lastTurnState]);

const sourceLabels = (): Record<CodingAgentStatusSource, string> => ({
  'codex-app-server': i18nHelper.codingAgentSessions.sources.codexAppServer,
  'codex-hook': i18nHelper.codingAgentSessions.sources.codexHook,
  'claude-agents-cli': i18nHelper.codingAgentSessions.sources.claudeAgentsCli,
  'claude-hook': i18nHelper.codingAgentSessions.sources.claudeHook,
  manual: i18nHelper.codingAgentSessions.sources.manual,
  none: i18nHelper.codingAgentSessions.sources.none
});
const sourceLabel = computed(() => sourceLabels()[props.session.statusSource]);

const freshnessLabel = computed(() => {
  const freshness = store.freshness(props.session.statusObservedAt);
  const template = i18nHelper.codingAgentSessions.freshness[freshness.kind];
  return template.replace('{count}', String(freshness.value));
});

const primaryLabel = computed(() => {
  if (primaryAction.value.kind === 'attach') return i18nHelper.codingAgentSessions.actions.attach;
  if (primaryAction.value.kind === 'already-open') {
    return i18nHelper.codingAgentSessions.actions.alreadyOpen;
  }
  return i18nHelper.codingAgentSessions.actions.open;
});

const actionReason = computed(() => {
  const reason = primaryAction.value.reason;
  if (reason === 'already-open') return i18nHelper.codingAgentSessions.messages.alreadyOpenDetail;
  if (reason === 'liveness-unknown') return i18nHelper.codingAgentSessions.messages.livenessUnknown;
  if (reason === 'cwd-missing') return i18nHelper.codingAgentSessions.messages.cwdMissing;
  if (reason === 'attach-unavailable')
    return i18nHelper.codingAgentSessions.messages.attachUnavailable;
  return null;
});

const actionErrorLabel = computed(() => {
  if (!actionError.value) return null;
  if (actionError.value.code === 'terminal-main-required') {
    return i18nHelper.codingAgentSessions.messages.terminalMainRequired;
  }
  if (actionError.value.code === 'already-open') {
    return i18nHelper.codingAgentSessions.messages.alreadyOpenDetail;
  }
  if (actionError.value.code === 'unavailable') {
    return i18nHelper.codingAgentSessions.messages.unavailableAction;
  }
  return i18nHelper.codingAgentSessions.messages.requestFailed;
});

const failedNotice = computed(() => {
  if (props.session.state !== 'failed') return null;
  return props.session.providerState
    ? `${i18nHelper.codingAgentSessions.states.failed} · ${props.session.providerState}`
    : i18nHelper.codingAgentSessions.states.failed;
});
</script>

<style lang="less">
@import './CodingAgentSessionRow.less';
</style>
