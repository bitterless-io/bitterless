<template>
  <div name="codingAgentSessions__page" class="bl-full-container coding-agent-sessions">
    <header name="codingAgentSessions__header" class="coding-agent-sessions__header">
      <div class="coding-agent-sessions__heading">
        <span class="coding-agent-sessions__eyebrow">
          {{ i18nHelper.codingAgentSessions.ledgerLabel }}
        </span>
        <h1>{{ i18nHelper.codingAgentSessions.title }}</h1>
        <p>{{ i18nHelper.codingAgentSessions.subtitle }}</p>
      </div>
      <div class="coding-agent-sessions__header-actions">
        <a-button size="mini" @click="store.openIntegrations()">
          <template #icon><IconPlugConnected :size="15" /></template>
          {{ i18nHelper.codingAgentSessions.actions.integrations }}
        </a-button>
        <a-button
          size="mini"
          :loading="store.refreshing"
          :disabled="store.refreshing"
          @click="store.refresh()"
        >
          <template #icon><IconRefresh :size="15" /></template>
          {{ i18nHelper.codingAgentSessions.actions.refresh }}
        </a-button>
      </div>
    </header>

    <section name="codingAgentSessions__filters" class="coding-agent-sessions__filters">
      <a-radio-group v-model="store.stateFilter" type="button" size="mini">
        <a-radio value="all">{{ filterLabel('all', store.allCount) }}</a-radio>
        <a-radio value="needs-input">
          {{ filterLabel('needsInput', store.needsInputCount) }}
        </a-radio>
        <a-radio value="working">{{ filterLabel('working', store.workingCount) }}</a-radio>
        <a-radio value="unknown">{{ filterLabel('unknown', store.unknownCount) }}</a-radio>
      </a-radio-group>
      <div class="coding-agent-sessions__filter-actions">
        <a-select
          v-model="store.providerFilter"
          size="mini"
          class="coding-agent-sessions__provider"
        >
          <a-option value="all">{{ i18nHelper.codingAgentSessions.providers.all }}</a-option>
          <a-option value="codex">{{ i18nHelper.codingAgentSessions.providers.codex }}</a-option>
          <a-option value="claude">{{ i18nHelper.codingAgentSessions.providers.claude }}</a-option>
        </a-select>
        <a-button type="primary" size="mini" @click="store.openAddDialog()">
          <template #icon><IconPlus :size="15" /></template>
          {{ i18nHelper.codingAgentSessions.actions.addSession }}
        </a-button>
      </div>
    </section>

    <div
      v-if="store.loadError || store.refreshError || store.copyError"
      name="codingAgentSessions__errors"
      class="coding-agent-sessions__notice coding-agent-sessions__notice--danger"
      role="alert"
    >
      <IconAlertTriangle :size="16" aria-hidden="true" />
      <div>
        <strong>{{ errorHeading }}</strong>
        <span>{{ store.loadError || store.refreshError || store.copyError }}</span>
      </div>
      <a-button size="mini" @click="retryError()">
        {{
          store.copyError
            ? i18nHelper.codingAgentSessions.actions.close
            : i18nHelper.codingAgentSessions.actions.retry
        }}
      </a-button>
    </div>

    <div
      v-for="notice in providerNotices"
      :key="notice.provider"
      name="codingAgentSessions__providerNotice"
      class="coding-agent-sessions__notice"
      role="status"
    >
      <IconInfoCircle :size="16" aria-hidden="true" />
      <div>
        <strong>{{ providerUnavailable(notice.provider) }}</strong>
        <span>{{ notice.message }}</span>
      </div>
      <a-button size="mini" @click="store.refresh(notice.provider)">
        {{ i18nHelper.codingAgentSessions.actions.refreshProvider }}
      </a-button>
    </div>

    <main
      name="codingAgentSessions__list"
      class="coding-agent-sessions__list"
      data-overlay-scrollbar
      aria-live="polite"
    >
      <template v-if="store.initialLoading">
        <div
          v-for="index in 4"
          :key="index"
          name="codingAgentSessions__skeletonRow"
          class="coding-agent-sessions__skeleton"
          :aria-label="i18nHelper.codingAgentSessions.messages.loadingList"
        >
          <span class="coding-agent-sessions__skeleton-rail" />
          <div class="coding-agent-sessions__skeleton-lines">
            <span />
            <span />
            <span />
          </div>
        </div>
      </template>

      <div
        v-else-if="store.sessions.length === 0"
        name="codingAgentSessions__empty"
        class="coding-agent-sessions__empty"
      >
        <IconTerminal2 :size="30" stroke-width="1.5" aria-hidden="true" />
        <h2>{{ i18nHelper.codingAgentSessions.messages.emptyTitle }}</h2>
        <p>{{ i18nHelper.codingAgentSessions.messages.emptyBody }}</p>
        <div class="coding-agent-sessions__empty-actions">
          <a-button size="mini" :loading="store.refreshing" @click="store.refresh()">
            {{ i18nHelper.codingAgentSessions.actions.refresh }}
          </a-button>
          <a-button type="primary" size="mini" @click="store.openAddDialog()">
            {{ i18nHelper.codingAgentSessions.actions.addSession }}
          </a-button>
        </div>
      </div>

      <div
        v-else-if="store.visibleSessions.length === 0"
        name="codingAgentSessions__filterEmpty"
        class="coding-agent-sessions__empty"
      >
        <IconFilterOff :size="28" stroke-width="1.5" aria-hidden="true" />
        <h2>{{ i18nHelper.codingAgentSessions.messages.noMatchesTitle }}</h2>
        <p>{{ i18nHelper.codingAgentSessions.messages.noMatchesBody }}</p>
      </div>

      <template v-else>
        <CodingAgentSessionRow
          v-for="session in store.visibleSessions"
          :key="session.id"
          :session="session"
        />
      </template>
    </main>

    <CodingAgentSessionDialog />
    <CodingAgentIntegrationDrawer />
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted } from 'vue';
import {
  IconAlertTriangle,
  IconFilterOff,
  IconInfoCircle,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconTerminal2
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { CodingAgentProvider } from '@shared/codingAgent/codingAgentSession.type';
import CodingAgentSessionRow from './components/CodingAgentSessionRow/CodingAgentSessionRow.vue';
import CodingAgentSessionDialog from './components/CodingAgentSessionDialog/CodingAgentSessionDialog.vue';
import CodingAgentIntegrationDrawer from './components/CodingAgentIntegrationDrawer/CodingAgentIntegrationDrawer.vue';
import { codingAgentSessionStore as store } from './codingAgentSession.store';

type FilterLabel = 'all' | 'needsInput' | 'working' | 'unknown';

const filterLabel = (filter: FilterLabel, count: number): string => {
  return i18nHelper.codingAgentSessions.filters[filter].replace('{count}', String(count));
};

const providerUnavailable = (provider: CodingAgentProvider): string => {
  const name = i18nHelper.codingAgentSessions.providers[provider];
  return i18nHelper.codingAgentSessions.messages.providerUnavailable.replace('{provider}', name);
};

const providerNotices = computed(() => {
  return (['codex', 'claude'] as CodingAgentProvider[]).flatMap((provider) => {
    const issue = store.discoveryIssues.find((item) => item.provider === provider);
    return issue ? [{ provider, message: issue.message }] : [];
  });
});

const errorHeading = computed(() => {
  if (store.loadError) return i18nHelper.codingAgentSessions.messages.listError;
  if (store.copyError) return i18nHelper.codingAgentSessions.messages.copyFailed;
  return i18nHelper.codingAgentSessions.messages.refreshError;
});

const retryError = async (): Promise<void> => {
  if (store.copyError) {
    store.clearCopyError();
  } else if (store.refreshError) {
    await store.refresh();
  } else {
    await store.reloadCanonical();
  }
};

onMounted(async () => {
  store.setPageVisible(true);
  await store.initialize();
});
onActivated(() => store.setPageVisible(true));
onDeactivated(() => store.setPageVisible(false));
onUnmounted(() => store.setPageVisible(false));
</script>

<style lang="less">
@import './CodingAgentSessions.less';
</style>
