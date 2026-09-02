<template>
  <a-doption
    v-if="canOpenThread"
    name="eyesOnAgents__threadCardMenu__open"
    class="thread-card__option"
    :disabled="eyesOnAgentsStore.openingSessionKeys.has(thread.sessionKey)"
    @click="emit('open')"
  >
    <IconExternalLink :size="13" aria-hidden="true" />
    <span class="thread-card__option-label">{{ openLabel }}</span>
    {{ ' ' }}
    <span class="thread-card__option-hint">
      {{ i18nHelper.eyesOnAgents.actions.doubleClickHint }}
    </span>
  </a-doption>
  <a-doption
    v-if="canOpenInIterm2"
    name="eyesOnAgents__threadCardMenu__openInIterm2"
    class="thread-card__option"
    :disabled="eyesOnAgentsStore.openingSessionKeys.has(thread.sessionKey)"
    @click="emit('openInIterm2')"
  >
    <IconTerminal2 :size="13" aria-hidden="true" />
    <span class="thread-card__option-label">
      {{ i18nHelper.eyesOnAgents.actions.openInIterm2 }}
    </span>
  </a-doption>
  <a-doption
    name="eyesOnAgents__threadCardMenu__readState"
    class="thread-card__option"
    :disabled="eyesOnAgentsStore.busyAction !== null"
    @click="emit('toggleReadState')"
  >
    <IconCircle v-if="thread.isUnread" :size="13" aria-hidden="true" />
    <IconCircleDot v-else :size="13" aria-hidden="true" />
    <span class="thread-card__option-label">{{ readStateLabel }}</span>
  </a-doption>
  <a-doption
    v-if="thread.canCopySessionPath"
    name="eyesOnAgents__threadCardMenu__copySessionPath"
    class="thread-card__option"
    :disabled="eyesOnAgentsStore.busyAction !== null"
    @click="emit('copySessionPath')"
  >
    <IconClipboardText :size="13" aria-hidden="true" />
    <span class="thread-card__option-label">
      {{ i18nHelper.eyesOnAgents.actions.copySessionPath }}
    </span>
  </a-doption>
  <a-doption
    v-if="thread.provider === 'codex'"
    name="eyesOnAgents__threadCardMenu__archive"
    class="thread-card__option thread-card__option--archive"
    :disabled="eyesOnAgentsStore.busyAction !== null"
    @click="emit('archive')"
  >
    <IconArchive :size="13" aria-hidden="true" />
    <span class="thread-card__option-label">
      {{ i18nHelper.eyesOnAgents.actions.archive }}
    </span>
  </a-doption>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  IconArchive,
  IconCircle,
  IconCircleDot,
  IconClipboardText,
  IconExternalLink,
  IconTerminal2,
} from '@tabler/icons-vue';
import type { EyesOnAgentsThread } from '@shared/eyesOnAgents/eyesOnAgents.type';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

const props = defineProps<{ thread: EyesOnAgentsThread }>();
const emit = defineEmits<{
  open: [];
  openInIterm2: [];
  toggleReadState: [];
  copySessionPath: [];
  archive: [];
}>();

const canOpenThread = computed(() => props.thread.provider === 'codex'
  || props.thread.desktopSessionId !== null);
const canOpenInIterm2 = computed(() => props.thread.iterm2SessionId !== null);
const openLabel = computed(() => props.thread.provider === 'claude'
  ? i18nHelper.eyesOnAgents.actions.openInClaude
  : i18nHelper.eyesOnAgents.actions.openInCodex);
const readStateLabel = computed(() => props.thread.isUnread
  ? i18nHelper.eyesOnAgents.actions.markRead
  : i18nHelper.eyesOnAgents.actions.markUnread);
</script>
