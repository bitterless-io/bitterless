<template>
  <section
    name="coin__resourcesPage"
    class="coin-resources-page"
    aria-labelledby="coin-resources-title"
  >
    <header name="coin__resources__header" class="coin-resources-page__header">
      <div class="coin-resources-page__heading">
        <h1 id="coin-resources-title">{{ i18nHelper.coin.resourcePage.title }}</h1>
        <p>{{ i18nHelper.coin.resourcePage.subtitle }}</p>
      </div>
      <div class="coin-resources-page__header-actions">
        <span class="coin-resources-page__summary" :class="summaryClass">
          <IconCircleCheck v-if="readyCount === totalCount" :size="15" aria-hidden="true" />
          <IconAlertCircle v-else :size="15" aria-hidden="true" />
          {{ summaryText }}
        </span>
        <a-button
          size="mini"
          :loading="store.statusLoading"
          :disabled="store.statusLoading"
          @click="store.refreshAll()"
        >
          <template #icon><IconRefresh :size="14" /></template>
          {{ i18nHelper.coin.resourcePage.refresh }}
        </a-button>
      </div>
    </header>

    <div name="coin__resources__body" class="coin-resources-page__body" data-overlay-scrollbar>
      <div v-if="store.statusError" class="coin-resources-page__error" role="alert">
        <IconAlertTriangle :size="16" aria-hidden="true" />
        <span>{{ store.statusError }}</span>
      </div>

      <section name="coin__resources__ai" class="coin-resource-section">
        <header class="coin-resource-section__header">
          <IconBrandOpenai :size="17" aria-hidden="true" />
          <h2>{{ i18nHelper.coin.resourcePage.sections.ai }}</h2>
        </header>
        <div class="coin-resource-list">
          <div name="coin__resources__codex" class="coin-resource-row">
            <span class="coin-resource-row__icon">
              <IconBrandOpenai :size="18" aria-hidden="true" />
            </span>
            <div class="coin-resource-row__content">
              <div class="coin-resource-row__heading">
                <strong>{{ i18nHelper.coin.resourcePage.codex.name }}</strong>
                <span class="coin-resource-state" :class="codexStateClass">
                  {{ codexStateLabel }}
                </span>
              </div>
              <span class="coin-resource-row__detail">
                {{ codexDetail }}
              </span>
              <div name="coin__resources__codexPreferences" class="coin-resource-ai-preferences">
                <label>
                  <span>{{ i18nHelper.coin.resourcePage.codex.model }}</span>
                  <a-select
                    v-model="workspace.data.ai.model"
                    size="mini"
                    :disabled="workspace.aiLoading || workspace.stateSaving"
                    @change="workspace.updateAiPreference()"
                  >
                    <a-option v-for="model in modelOptions" :key="model" :value="model">{{ model }}</a-option>
                  </a-select>
                </label>
                <label>
                  <span>{{ i18nHelper.coin.resourcePage.codex.effort }}</span>
                  <a-select
                    v-model="workspace.data.ai.effort"
                    size="mini"
                    :disabled="workspace.aiLoading || workspace.stateSaving"
                    @change="workspace.updateAiPreference()"
                  >
                    <a-option v-for="effort in effortOptions" :key="effort" :value="effort">
                      {{ i18nHelper.coin.resourcePage.codex.efforts[effort] }}
                    </a-option>
                  </a-select>
                </label>
              </div>
              <span class="coin-resource-row__notice">
                {{ i18nHelper.coin.resourcePage.codex.appWide }}
              </span>
            </div>
            <div class="coin-resource-row__actions">
              <template v-if="status?.codex.connected">
                <a-popconfirm
                  :content="i18nHelper.coin.resourcePage.codex.disconnectConfirm"
                  @ok="store.disconnectCodex()"
                >
                  <a-button
                    size="mini"
                    status="danger"
                    :loading="store.codexLoading"
                    :disabled="store.codexLoading"
                  >
                    <template #icon><IconLogout :size="14" /></template>
                    {{ i18nHelper.coin.resourcePage.codex.disconnect }}
                  </a-button>
                </a-popconfirm>
              </template>
              <template v-else>
                <a-button
                  type="primary"
                  size="mini"
                  :loading="store.codexLoading"
                  :disabled="store.codexLoading"
                  @click="store.connectCodex('browser')"
                >
                  <template #icon><IconLogin :size="14" /></template>
                  {{ i18nHelper.coin.resourcePage.codex.connect }}
                </a-button>
                <a-dropdown trigger="click" :popup-max-height="false">
                  <a-tooltip :content="i18nHelper.coin.resourcePage.codex.moreMethods">
                    <a-button
                      size="mini"
                      :loading="store.codexLoading"
                      :disabled="store.codexLoading"
                      :aria-label="i18nHelper.coin.resourcePage.codex.moreMethods"
                    >
                      <template #icon><IconDotsVertical :size="14" /></template>
                    </a-button>
                  </a-tooltip>
                  <template #content>
                    <a-doption @click="store.connectCodex('device_code')">
                      <IconDeviceDesktop :size="14" />
                      {{ i18nHelper.coin.resourcePage.codex.deviceMethod }}
                    </a-doption>
                  </template>
                </a-dropdown>
              </template>
            </div>
          </div>
        </div>
      </section>

      <section name="coin__resources__gmgn" class="coin-resource-section">
        <header class="coin-resource-section__header">
          <IconTerminal2 :size="17" aria-hidden="true" />
          <h2>{{ i18nHelper.coin.resourcePage.sections.localData }}</h2>
        </header>
        <div class="coin-resource-list">
          <div name="coin__resources__gmgnCli" class="coin-resource-row">
            <span class="coin-resource-row__icon">
              <IconTerminal2 :size="18" aria-hidden="true" />
            </span>
            <div class="coin-resource-row__content">
              <div class="coin-resource-row__heading">
                <strong>{{ i18nHelper.coin.resourcePage.gmgn.cliName }}</strong>
                <span class="coin-resource-state" :class="gmgnCliStateClass">
                  {{ gmgnCliStateLabel }}
                </span>
              </div>
              <span class="coin-resource-row__detail">{{ gmgnCliDetail }}</span>
              <div v-if="!status?.gmgn.installed" class="coin-resource-command">
                <span>{{ i18nHelper.coin.resourcePage.gmgn.installCommand }}</span>
                <code>yarn global add gmgn-cli</code>
              </div>
            </div>
            <div class="coin-resource-row__actions">
              <a-button
                v-if="!status?.gmgn.installed"
                size="mini"
                :loading="store.copyLoading"
                :disabled="store.copyLoading"
                @click="store.copyInstallCommand()"
              >
                <template #icon><IconCopy :size="14" /></template>
                {{ i18nHelper.coin.resourcePage.gmgn.copy }}
              </a-button>
              <a-button
                size="mini"
                :loading="store.gmgnDetecting"
                :disabled="store.gmgnDetecting"
                @click="store.recheckGmgn()"
              >
                <template #icon><IconRefresh :size="14" /></template>
                {{ i18nHelper.coin.resourcePage.gmgn.recheck }}
              </a-button>
              <a-button size="mini" @click="store.gmgnGuideVisible = true">
                <template #icon><IconBook2 :size="14" /></template>
                {{ i18nHelper.coin.resourcePage.gmgn.guide }}
              </a-button>
            </div>
          </div>

          <div name="coin__resources__gmgnKey" class="coin-resource-row">
            <span class="coin-resource-row__icon">
              <IconKey :size="18" aria-hidden="true" />
            </span>
            <div class="coin-resource-row__content">
              <div class="coin-resource-row__heading">
                <strong>{{ i18nHelper.coin.resourcePage.gmgn.apiKey }}</strong>
                <span class="coin-resource-state" :class="gmgnKeyStateClass">
                  {{ gmgnKeyStateLabel }}
                </span>
              </div>
              <span class="coin-resource-row__detail">{{ gmgnKeyDetail }}</span>
              <span class="coin-resource-row__notice">
                {{ i18nHelper.coin.resourcePage.gmgn.privateKeyExcluded }}
              </span>
            </div>
            <div class="coin-resource-row__actions">
              <a-button size="mini" @click="store.openGmgnKey()">
                <template #icon><IconKey :size="14" /></template>
                {{ status?.gmgn.apiKeyConfigured ? i18nHelper.coin.resourcePage.replace : i18nHelper.coin.resourcePage.configure }}
              </a-button>
              <a-button
                v-if="!store.gmgnVerifying"
                type="primary"
                size="mini"
                :loading="store.gmgnVerifying"
                :disabled="!gmgnCanVerify || store.gmgnVerifying"
                @click="store.verifyGmgn()"
              >
                <template #icon><IconShieldCheck :size="14" /></template>
                {{ i18nHelper.coin.resourcePage.gmgn.verify }}
              </a-button>
              <a-button
                v-else
                status="warning"
                size="mini"
                :loading="store.gmgnCancelling"
                :disabled="store.gmgnCancelling"
                @click="store.cancelGmgnVerify()"
              >
                <template #icon><IconPlayerStop :size="14" /></template>
                {{ i18nHelper.coin.resourcePage.gmgn.stop }}
              </a-button>
            </div>
          </div>
        </div>
      </section>

      <section name="coin__resources__services" class="coin-resource-section">
        <header class="coin-resource-section__header">
          <IconServer :size="17" aria-hidden="true" />
          <h2>{{ i18nHelper.coin.resourcePage.sections.services }}</h2>
        </header>
        <div class="coin-resource-list">
          <div
            v-for="service in serviceRows"
            :key="service.service"
            name="coin__resources__serviceRow"
            class="coin-resource-row"
          >
            <span class="coin-resource-row__icon">
              <IconServer :size="18" aria-hidden="true" />
            </span>
            <div class="coin-resource-row__content">
              <div class="coin-resource-row__heading">
                <strong>{{ serviceName(service.service) }}</strong>
                <span class="coin-resource-state" :class="serviceStateClass(service)">
                  {{ serviceStateLabel(service) }}
                </span>
              </div>
              <span class="coin-resource-row__detail">{{ serviceDetail(service) }}</span>
            </div>
            <div class="coin-resource-row__actions">
              <a-button size="mini" @click="store.openService(service.service)">
                <template #icon><IconSettings :size="14" /></template>
                {{ service.configured ? i18nHelper.coin.resourcePage.replace : i18nHelper.coin.resourcePage.configure }}
              </a-button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <a-modal
      v-model:visible="store.gmgnKeyVisible"
      :title="i18nHelper.coin.resourcePage.keyModal.title"
      :mask-closable="!store.gmgnSaving"
      :esc-to-close="!store.gmgnSaving"
      :closable="!store.gmgnSaving"
      :footer="false"
      width="520px"
      unmount-on-close
      @cancel="store.closeGmgnKey()"
    >
      <div name="coin__resources__gmgnKeyModal" class="coin-resource-modal">
        <label class="coin-resource-field">
          <span>{{ i18nHelper.coin.resourcePage.keyModal.label }}</span>
          <a-input-password
            v-model="store.gmgnApiKey"
            size="small"
            :placeholder="i18nHelper.coin.resourcePage.keyModal.placeholder"
            autocomplete="off"
            allow-clear
          />
        </label>
        <p>{{ i18nHelper.coin.resourcePage.keyModal.storage }}</p>
        <p>{{ i18nHelper.coin.resourcePage.gmgn.privateKeyExcluded }}</p>
        <div class="coin-resource-modal__footer">
          <a-button size="mini" :disabled="store.gmgnSaving" @click="store.closeGmgnKey()">
            {{ i18nHelper.coin.resourcePage.cancel }}
          </a-button>
          <a-button
            type="primary"
            size="mini"
            :loading="store.gmgnSaving"
            :disabled="store.gmgnSaving"
            @click="store.saveGmgnKey()"
          >
            {{ i18nHelper.coin.resourcePage.save }}
          </a-button>
        </div>
      </div>
    </a-modal>

    <a-modal
      v-model:visible="store.gmgnGuideVisible"
      :title="i18nHelper.coin.resourcePage.guideModal.title"
      :footer="false"
      width="620px"
      unmount-on-close
    >
      <div name="coin__resources__gmgnGuideModal" class="coin-resource-guide">
        <ol>
          <li>{{ i18nHelper.coin.resourcePage.guideModal.prerequisite }}</li>
          <li>{{ i18nHelper.coin.resourcePage.guideModal.install }}</li>
          <li>{{ i18nHelper.coin.resourcePage.guideModal.key }}</li>
        </ol>
        <div class="coin-resource-guide__command">
          <code>yarn global add gmgn-cli</code>
          <a-button
            size="mini"
            :loading="store.copyLoading"
            :disabled="store.copyLoading"
            @click="store.copyInstallCommand()"
          >
            <template #icon><IconCopy :size="14" /></template>
            {{ i18nHelper.coin.resourcePage.gmgn.copy }}
          </a-button>
        </div>
        <div class="coin-resource-guide__links">
          <a-button
            size="mini"
            :loading="store.officialLinkLoading === 'repository'"
            :disabled="!!store.officialLinkLoading"
            @click="store.openOfficialLink('repository')"
          >
            <template #icon><IconExternalLink :size="14" /></template>
            {{ i18nHelper.coin.resourcePage.guideModal.repository }}
          </a-button>
          <a-button
            size="mini"
            :loading="store.officialLinkLoading === 'cliDocs'"
            :disabled="!!store.officialLinkLoading"
            @click="store.openOfficialLink('cliDocs')"
          >
            <template #icon><IconExternalLink :size="14" /></template>
            {{ i18nHelper.coin.resourcePage.guideModal.cliDocs }}
          </a-button>
          <a-button
            size="mini"
            :loading="store.officialLinkLoading === 'apiKey'"
            :disabled="!!store.officialLinkLoading"
            @click="store.openOfficialLink('apiKey')"
          >
            <template #icon><IconExternalLink :size="14" /></template>
            {{ i18nHelper.coin.resourcePage.guideModal.apiKeyPage }}
          </a-button>
        </div>
        <div class="coin-resource-modal__footer">
          <a-button size="mini" @click="store.gmgnGuideVisible = false">
            {{ i18nHelper.coin.resourcePage.close }}
          </a-button>
        </div>
      </div>
    </a-modal>

    <a-modal
      :visible="!!store.serviceModal"
      :title="serviceModalTitle"
      :mask-closable="!store.serviceSaving"
      :esc-to-close="!store.serviceSaving"
      :closable="!store.serviceSaving"
      :footer="false"
      width="580px"
      unmount-on-close
      @cancel="store.closeService()"
    >
      <div name="coin__resources__serviceModal" class="coin-resource-modal">
        <label class="coin-resource-field">
          <span>{{ i18nHelper.coin.resourcePage.httpBase }}</span>
          <a-input
            v-model="store.serviceHttpUrl"
            size="small"
            :placeholder="i18nHelper.coin.resourcePage.serviceModal.httpPlaceholder"
            autocomplete="off"
            allow-clear
          />
        </label>
        <label v-if="store.serviceModal === 'monitor'" class="coin-resource-field">
          <span>{{ i18nHelper.coin.resourcePage.wsBase }}</span>
          <a-input
            v-model="store.serviceWsUrl"
            size="small"
            :placeholder="i18nHelper.coin.resourcePage.serviceModal.wsPlaceholder"
            autocomplete="off"
            allow-clear
          />
        </label>
        <p>{{ i18nHelper.coin.resourcePage.serviceModal.validation }}</p>
        <div class="coin-resource-modal__footer">
          <a-button size="mini" :disabled="!!store.serviceSaving" @click="store.closeService()">
            {{ i18nHelper.coin.resourcePage.cancel }}
          </a-button>
          <a-button
            type="primary"
            size="mini"
            :loading="!!store.serviceSaving"
            :disabled="!!store.serviceSaving"
            @click="store.saveService()"
          >
            {{ i18nHelper.coin.resourcePage.save }}
          </a-button>
        </div>
      </div>
    </a-modal>

    <a-modal
      :visible="!!store.deviceNotice"
      :title="i18nHelper.coin.resourcePage.device.title"
      :footer="false"
      width="460px"
      unmount-on-close
      @cancel="store.deviceNotice = null"
    >
      <div v-if="store.deviceNotice" name="coin__resources__deviceModal" class="coin-device-code">
        <p>{{ deviceBody }}</p>
        <span>{{ i18nHelper.coin.resourcePage.device.code }}</span>
        <code>{{ store.deviceNotice.userCode }}</code>
        <div class="coin-resource-modal__footer">
          <a-button size="mini" @click="store.deviceNotice = null">
            {{ i18nHelper.coin.resourcePage.close }}
          </a-button>
        </div>
      </div>
    </a-modal>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import dayjs from 'dayjs';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconBook2,
  IconBrandOpenai,
  IconCircleCheck,
  IconCopy,
  IconDeviceDesktop,
  IconDotsVertical,
  IconExternalLink,
  IconKey,
  IconLogin,
  IconLogout,
  IconPlayerStop,
  IconRefresh,
  IconServer,
  IconSettings,
  IconShieldCheck,
  IconTerminal2,
} from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { COIN_AI_EFFORTS, COIN_AI_MODELS } from '@shared/coin/coinAnalysis.type';
import { COIN_SERVICE_IDS } from '@shared/coin/coinResource.type';
import type {
  CoinServiceId,
  CoinServiceStatus,
} from '@shared/coin/coinResource.type';
import { coinWorkspaceStore as workspace } from '../analysis/coinWorkspace.store';
import { coinResourcesStore as store } from './coinResources.store';

const modelOptions = COIN_AI_MODELS;
const effortOptions = COIN_AI_EFFORTS;
const status = computed(() => store.status);
const serviceRows = computed<CoinServiceStatus[]>(() =>
  status.value?.services ??
  COIN_SERVICE_IDS.map((service) => ({
    service,
    state: 'missing',
    configured: false,
    httpHost: null,
    wsHost: null,
    source: null,
  })),
);
const totalCount = 5;
const readyCount = computed(() => {
  if (!status.value) return 0;
  return [
    status.value.codex.connected,
    status.value.gmgn.installed &&
      status.value.gmgn.apiKeyConfigured &&
      Boolean(status.value.gmgn.lastProbe?.ok),
    ...status.value.services.map((item) => item.configured),
  ].filter(Boolean).length;
});
const summaryText = computed(() =>
  i18nHelper.coin.resourcePage.setupSummary
    .replace('{ready}', String(readyCount.value))
    .replace('{total}', String(totalCount)),
);
const summaryClass = computed(() => ({
  'coin-resources-page__summary--ready': readyCount.value === totalCount,
}));
const codexStateClass = computed(() => ({
  'coin-resource-state--ready': Boolean(status.value?.codex.connected),
  'coin-resource-state--danger': Boolean(status.value?.codex.errorCode),
  'coin-resource-state--warning': !status.value?.codex.connected && !status.value?.codex.errorCode,
}));
const codexStateLabel = computed(() => {
  if (status.value?.codex.errorCode) return i18nHelper.coin.resourcePage.codex.statusUnavailable;
  if (status.value?.codex.connected) return i18nHelper.coin.resourcePage.connected;
  return i18nHelper.coin.resourcePage.codex.status;
});
const codexDetail = computed(() => {
  const codex = status.value?.codex;
  return [
    codex?.provider ?? 'openai-codex',
    `${i18nHelper.coin.resourcePage.codex.verified} ${formatTime(codex?.lastVerifiedAt)}`,
  ].join(' · ');
});
const gmgnCliStateClass = computed(() => ({
  'coin-resource-state--ready': Boolean(status.value?.gmgn.installed && status.value.gmgn.version),
  'coin-resource-state--danger': Boolean(status.value?.gmgn.errorCode),
  'coin-resource-state--warning': !status.value?.gmgn.installed,
}));
const gmgnCliStateLabel = computed(() => {
  if (status.value?.gmgn.errorCode) return i18nHelper.coin.resourcePage.invalid;
  if (status.value?.gmgn.installed) return i18nHelper.coin.resourcePage.gmgn.cliInstalled;
  return i18nHelper.coin.resourcePage.notConfigured;
});
const gmgnCliDetail = computed(() => {
  const gmgn = status.value?.gmgn;
  if (!gmgn?.installed) return i18nHelper.coin.resourcePage.gmgn.cliMissing;
  if (gmgn.errorCode) return i18nHelper.coin.resourcePage.gmgn.cliDetectFailed;
  return [
    `${i18nHelper.coin.resourcePage.gmgn.version} ${gmgn.version ?? '-'}`,
    `${i18nHelper.coin.resourcePage.gmgn.path} ${gmgn.displayPath ?? '-'}`,
  ].join(' · ');
});
const gmgnKeyStateClass = computed(() => ({
  'coin-resource-state--ready': Boolean(status.value?.gmgn.apiKeyConfigured && !status.value.gmgn.privateKeyDetected),
  'coin-resource-state--danger': Boolean(status.value?.gmgn.privateKeyDetected),
  'coin-resource-state--warning': !status.value?.gmgn.apiKeyConfigured,
}));
const gmgnKeyStateLabel = computed(() => {
  if (status.value?.gmgn.privateKeyDetected) return i18nHelper.coin.resourcePage.invalid;
  if (status.value?.gmgn.apiKeyConfigured) return i18nHelper.coin.resourcePage.configured;
  return i18nHelper.coin.resourcePage.notConfigured;
});
const gmgnKeyDetail = computed(() => {
  const gmgn = status.value?.gmgn;
  if (gmgn?.privateKeyDetected) return i18nHelper.coin.resourcePage.gmgn.privateKeyDetected;
  if (!gmgn?.apiKeyConfigured) return i18nHelper.coin.resourcePage.gmgn.keyMissing;
  const probe = gmgn.lastProbe;
  return `${i18nHelper.coin.resourcePage.gmgn.keyConfigured} · ${i18nHelper.coin.resourcePage.gmgn.lastProbe} ${probe ? formatTime(probe.completedAt) : i18nHelper.coin.resourcePage.gmgn.noProbe}`;
});
const gmgnCanVerify = computed(() =>
  Boolean(
    status.value?.gmgn.installed &&
      status.value.gmgn.apiKeyConfigured &&
      !status.value.gmgn.privateKeyDetected,
  ),
);
const serviceModalTitle = computed(() =>
  i18nHelper.coin.resourcePage.serviceModal.title.replace(
    '{service}',
    store.serviceModal ? serviceName(store.serviceModal) : '',
  ),
);
const deviceBody = computed(() =>
  i18nHelper.coin.resourcePage.device.body.replace(
    '{host}',
    store.deviceNotice?.verificationHost ?? '',
  ),
);

const formatTime = (value: number | null | undefined): string =>
  value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-';

const serviceName = (service: CoinServiceId): string =>
  i18nHelper.coin.resourcePage.services[service];

const serviceStateClass = (row: CoinServiceStatus): Record<string, boolean> => ({
  'coin-resource-state--ready': row.state === 'configured',
  'coin-resource-state--danger': row.state === 'invalid',
  'coin-resource-state--warning': row.state === 'missing',
});

const serviceStateLabel = (row: CoinServiceStatus): string => {
  if (row.state === 'configured') return i18nHelper.coin.resourcePage.configured;
  if (row.state === 'invalid') return i18nHelper.coin.resourcePage.invalid;
  return i18nHelper.coin.resourcePage.notConfigured;
};

const serviceDetail = (row: CoinServiceStatus): string => {
  if (row.state === 'invalid') return i18nHelper.coin.resourcePage.serviceInvalid;
  if (!row.configured) return i18nHelper.coin.resourcePage.serviceDetail;
  const source = row.source === 'override'
    ? i18nHelper.coin.resourcePage.serviceSourceOverride
    : i18nHelper.coin.resourcePage.serviceSourceRuntime;
  const ready = i18nHelper.coin.resourcePage.serviceConfigured.replace('{source}', source);
  return [ready, row.httpHost, row.wsHost].filter(Boolean).join(' · ');
};

onMounted(() => {
  void store.initialize();
});
</script>

<style lang="less">
@import './CoinResourcesView.less';
</style>
