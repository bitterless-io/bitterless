<template>
  <a-drawer
    :visible="store.integrationDrawerVisible"
    :width="'min(760px, 100%)'"
    placement="right"
    :footer="false"
    :mask-closable="true"
    unmount-on-close
    @cancel="store.closeIntegrations()"
  >
    <template #title>
      <div name="codingAgentSessions__integrationTitle" class="coding-agent-integration__title">
        <IconPlugConnected :size="18" aria-hidden="true" />
        <span>{{ i18nHelper.codingAgentSessions.integration.title }}</span>
      </div>
    </template>

    <div name="codingAgentSessions__integrationDrawer" class="coding-agent-integration">
      <p class="coding-agent-integration__subtitle">
        {{ i18nHelper.codingAgentSessions.integration.subtitle }}
      </p>

      <div class="coding-agent-integration__header" aria-hidden="true">
        <span>{{ i18nHelper.codingAgentSessions.labels.provider }}</span>
        <span>{{ i18nHelper.codingAgentSessions.labels.discovery }}</span>
        <span>{{ i18nHelper.codingAgentSessions.labels.statusBridge }}</span>
        <span />
      </div>

      <section
        v-for="provider in providers"
        :key="provider"
        name="codingAgentSessions__integrationRow"
        class="coding-agent-integration__row"
      >
        <div class="coding-agent-integration__provider">
          <strong>{{ providerName(provider) }}</strong>
          <code>{{ settingsPath(provider) }}</code>
        </div>

        <div class="coding-agent-integration__discovery">
          <span
            class="coding-agent-integration__badge"
            :class="`coding-agent-integration__badge--${store.discoveryAvailability[provider]}`"
          >
            {{ discoveryLabel(provider) }}
          </span>
          <small>{{ i18nHelper.codingAgentSessions.labels.settingsPath }}</small>
        </div>

        <div class="coding-agent-integration__status">
          <template v-if="status(provider)">
            <span
              class="coding-agent-integration__badge"
              :class="`coding-agent-integration__badge--${status(provider)?.configuration}`"
            >
              {{ configurationLabel(provider) }}
            </span>
            <span>
              {{ i18nHelper.codingAgentSessions.labels.bridge }} ·
              {{
                status(provider)?.bridgeListening
                  ? i18nHelper.codingAgentSessions.messages.bridgeListening
                  : i18nHelper.codingAgentSessions.messages.bridgeStopped
              }}
            </span>
            <span>
              {{ i18nHelper.codingAgentSessions.labels.lastEvent }} ·
              {{ eventFreshness(provider) }}
            </span>
          </template>
          <a-spin v-else :loading="store.integrationLoading.has(provider)" />
        </div>

        <div class="coding-agent-integration__actions">
          <a-button
            v-if="!status(provider) || status(provider)?.configuration === 'invalid'"
            size="mini"
            :loading="store.integrationLoading.has(provider)"
            :disabled="store.integrationLoading.has(provider)"
            @click="store.loadIntegrationStatus(provider)"
          >
            {{ i18nHelper.codingAgentSessions.actions.refreshStatus }}
          </a-button>
          <a-button
            v-else-if="status(provider)?.configuration === 'configured'"
            size="mini"
            :loading="store.integrationLoading.has(provider)"
            :disabled="store.integrationLoading.has(provider)"
            @click="store.removeIntegration(provider)"
          >
            {{ i18nHelper.codingAgentSessions.actions.removeBridge }}
          </a-button>
          <a-button
            v-else
            type="primary"
            size="mini"
            :loading="store.integrationLoading.has(provider)"
            :disabled="store.integrationLoading.has(provider)"
            @click="store.installIntegration(provider)"
          >
            {{
              status(provider)?.configuration === 'drifted'
                ? i18nHelper.codingAgentSessions.actions.repair
                : i18nHelper.codingAgentSessions.actions.install
            }}
          </a-button>
        </div>

        <div
          v-if="status(provider)?.message || store.integrationErrors[provider]"
          class="coding-agent-integration__detail"
          :class="{
            'coding-agent-integration__detail--danger': Boolean(store.integrationErrors[provider])
          }"
          role="status"
        >
          <IconInfoCircle :size="14" aria-hidden="true" />
          <span>{{ store.integrationErrors[provider] || status(provider)?.message }}</span>
        </div>

        <div
          v-if="status(provider)?.configuration === 'drifted'"
          class="coding-agent-integration__guidance"
        >
          {{ i18nHelper.codingAgentSessions.messages.driftDetail }}
        </div>
        <div
          v-else-if="provider === 'codex' && status(provider)?.requiresTrust"
          class="coding-agent-integration__guidance"
        >
          {{ i18nHelper.codingAgentSessions.messages.codexTrust }}
        </div>
        <div v-else-if="provider === 'claude'" class="coding-agent-integration__guidance">
          {{ i18nHelper.codingAgentSessions.messages.claudeMetadata }}
        </div>
      </section>

      <footer class="coding-agent-integration__footer">
        <a-button size="mini" @click="store.closeIntegrations()">
          {{ i18nHelper.codingAgentSessions.actions.close }}
        </a-button>
      </footer>
    </div>
  </a-drawer>
</template>

<script setup lang="ts">
import { IconInfoCircle, IconPlugConnected } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type {
  CodingAgentIntegrationConfiguration,
  CodingAgentProvider
} from '@shared/codingAgent/codingAgentSession.type';
import { codingAgentSessionStore as store } from '../../codingAgentSession.store';

const providers: CodingAgentProvider[] = ['codex', 'claude'];

const status = (provider: CodingAgentProvider) => store.integrationStatuses[provider];
const providerName = (provider: CodingAgentProvider): string => {
  return i18nHelper.codingAgentSessions.providers[provider];
};
const settingsPath = (provider: CodingAgentProvider): string => {
  return provider === 'codex'
    ? i18nHelper.codingAgentSessions.integration.codexPath
    : i18nHelper.codingAgentSessions.integration.claudePath;
};
const discoveryLabel = (provider: CodingAgentProvider): string => {
  const availability = store.discoveryAvailability[provider];
  if (availability === 'available')
    return i18nHelper.codingAgentSessions.messages.discoveryAvailable;
  if (availability === 'unavailable')
    return i18nHelper.codingAgentSessions.messages.discoveryUnavailable;
  return i18nHelper.codingAgentSessions.messages.discoveryUnknown;
};
const configurationLabel = (provider: CodingAgentProvider): string => {
  const configuration = status(provider)?.configuration;
  const labels: Record<CodingAgentIntegrationConfiguration, string> = {
    'not-installed': i18nHelper.codingAgentSessions.integration.notInstalled,
    configured: i18nHelper.codingAgentSessions.integration.configured,
    drifted: i18nHelper.codingAgentSessions.integration.drifted,
    invalid: i18nHelper.codingAgentSessions.integration.invalid
  };
  return configuration
    ? labels[configuration]
    : i18nHelper.codingAgentSessions.messages.discoveryUnknown;
};
const eventFreshness = (provider: CodingAgentProvider): string => {
  const freshness = store.freshness(status(provider)?.lastEventAt ?? null);
  const template = i18nHelper.codingAgentSessions.freshness[freshness.kind];
  return freshness.kind === 'never'
    ? i18nHelper.codingAgentSessions.messages.noEvents
    : template.replace('{count}', String(freshness.value));
};
</script>

<style lang="less">
@import './CodingAgentIntegrationDrawer.less';
</style>
