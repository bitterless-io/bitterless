<template>
  <a-modal
    :visible="store.visible"
    :footer="false"
    :width="520"
    :mask-closable="!store.pending"
    :esc-to-close="!store.pending"
    :closable="!store.pending"
    :unmount-on-close="true"
    title-align="start"
    modal-class="trench-gmgn-settings-modal"
    @before-open="rememberReturnFocus"
    @open="focusNativeClose"
    @close="restoreFocus"
    @cancel="store.close()"
  >
    <template #title>
      <div class="trench-gmgn-settings__title">
        <div class="trench-gmgn-settings__eyebrow">{{ t('trench.gmgnSettings.eyebrow') }}</div>
        <h2 class="trench-gmgn-settings__heading">{{ t('trench.gmgnSettings.title') }}</h2>
      </div>
    </template>

    <div name="trench__gmgn-settings" class="trench-gmgn-settings">
      <p class="trench-gmgn-settings__summary">{{ t('trench.gmgnSettings.summary') }}</p>

      <div v-if="store.operation === 'load' && !status" class="trench-gmgn-settings__loading" role="status">
        <a-spin />
        <span>{{ t('trench.gmgnSettings.loading') }}</span>
      </div>

      <template v-else>
        <dl class="trench-gmgn-settings__status">
          <div name="trench__gmgn-settings__cli">
            <dt>{{ t('trench.gmgnSettings.cli') }}</dt>
            <dd>
              <strong :class="statusTone(cliReady)">{{ cliLabel }}</strong>
              <span>{{ cliDetail }}</span>
            </dd>
          </div>
          <div name="trench__gmgn-settings__key">
            <dt>{{ t('trench.gmgnSettings.apiKey') }}</dt>
            <dd>
              <strong :class="statusTone(keyReady)">{{ keyLabel }}</strong>
              <span>{{ keyDetail }}</span>
            </dd>
          </div>
          <div name="trench__gmgn-settings__probe">
            <dt>{{ t('trench.gmgnSettings.lastProbe') }}</dt>
            <dd>
              <strong :class="statusTone(probeReady)">{{ probeLabel }}</strong>
              <span>{{ probeDetail }}</span>
            </dd>
          </div>
        </dl>

        <div class="trench-gmgn-settings__tools">
          <a-button
            name="trench__gmgn-settings__recheck"
            size="small"
            :loading="store.operation === 'recheck'"
            :disabled="store.pending"
            @click="store.recheck()"
          >{{ t('trench.gmgnSettings.recheck') }}</a-button>
          <a-button
            name="trench__gmgn-settings__verify-existing"
            size="small"
            :loading="store.operation === 'verify'"
            :disabled="!canVerify"
            @click="store.verifyExisting()"
          >{{ t('trench.gmgnSettings.verifyExisting') }}</a-button>
          <a-button
            name="trench__gmgn-settings__get-key"
            size="small"
            :disabled="store.pending"
            @click="store.openApiKeyPage()"
          >{{ t('trench.gmgnSettings.getApiKey') }}</a-button>
        </div>

        <section name="trench__gmgn-settings__replacement" class="trench-gmgn-settings__replacement">
          <label for="trench-gmgn-api-key">{{ t('trench.gmgnSettings.replacementLabel') }}</label>
          <a-input
            v-model="store.apiKey"
            name="trench__gmgn-settings__api-key"
            type="password"
            autocomplete="off"
            :input-attrs="{ id: 'trench-gmgn-api-key' }"
            :disabled="store.pending"
            :placeholder="t('trench.gmgnSettings.replacementPlaceholder')"
            @press-enter="store.saveAndVerify()"
          />
          <p>{{ t('trench.gmgnSettings.storageBoundary') }}</p>
          <a-button
            name="trench__gmgn-settings__save-verify"
            type="primary"
            :loading="store.operation === 'save-verify'"
            :disabled="store.pending || !store.apiKey.trim()"
            @click="store.saveAndVerify()"
          >{{ t('trench.gmgnSettings.saveAndVerify') }}</a-button>
        </section>

        <div
          v-if="feedbackText"
          name="trench__gmgn-settings__feedback"
        >
          <a-alert
            class="trench-gmgn-settings__feedback"
            :type="store.feedback?.tone === 'success' ? 'success' : 'error'"
            show-icon
            :title="feedbackText"
          />
        </div>

        <div class="trench-gmgn-settings__footer">
          <a-button
            name="trench__gmgn-settings__close"
            size="small"
            :disabled="store.pending"
            @click="store.close()"
          >
            {{ t('trench.gmgnSettings.close') }}
          </a-button>
        </div>
      </template>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CoinGmgnProbeCode } from '@shared/coin/coinResource.type';
import { trenchGmgnSettingsStore as store } from './trenchGmgnSettings.runtime';

const { locale, t } = useI18n();
const status = computed(() => store.status);
const cliReady = computed(() => Boolean(status.value?.installed && !status.value.errorCode));
const keyReady = computed(() => Boolean(
  status.value?.apiKeyConfigured && !status.value.privateKeyDetected,
));
const probeReady = computed(() => status.value?.lastProbe?.ok === true);
const canVerify = computed(() => (
  !store.pending && cliReady.value && keyReady.value
));
const statusTone = (ready: boolean): string => ready
  ? 'trench-gmgn-settings__state--ready'
  : 'trench-gmgn-settings__state--attention';
const cliLabel = computed(() => {
  if (!status.value) return t('trench.gmgnSettings.unavailable');
  if (!status.value.installed) return t('trench.gmgnSettings.cliMissing');
  if (status.value.errorCode) return t('trench.gmgnSettings.cliInvalid');
  return t('trench.gmgnSettings.cliReady');
});
const cliDetail = computed(() => {
  if (!status.value?.installed) return t('trench.gmgnSettings.installHint');
  return [
    status.value.version ? `v${status.value.version}` : null,
    status.value.displayPath,
  ].filter(Boolean).join(' · ') || t('trench.gmgnSettings.cliInvalid');
});
const keyLabel = computed(() => {
  if (status.value?.privateKeyDetected) return t('trench.gmgnSettings.privateKeyBlocked');
  return status.value?.apiKeyConfigured
    ? t('trench.gmgnSettings.configured')
    : t('trench.gmgnSettings.notConfigured');
});
const keyDetail = computed(() => status.value?.privateKeyDetected
  ? t('trench.gmgnSettings.privateKeyGuidance')
  : t('trench.gmgnSettings.keyNotReturned'));
const probeLabel = computed(() => {
  const probe = status.value?.lastProbe;
  if (!probe) return t('trench.gmgnSettings.notVerified');
  return probe.ok
    ? t('trench.gmgnSettings.verified')
    : probeCodeText(probe.code);
});
const probeDetail = computed(() => {
  const probe = status.value?.lastProbe;
  if (!probe) return t('trench.gmgnSettings.runProbeHint');
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(probe.completedAt);
});
const probeCodeText = (code: CoinGmgnProbeCode): string => t(
  `trench.gmgnSettings.feedback.${code}`,
);
const feedbackText = computed(() => {
  const feedback = store.feedback;
  if (!feedback) return '';
  return t(`trench.gmgnSettings.feedback.${feedback.code}`);
});
let returnFocusTarget: HTMLElement | null = null;
const rememberReturnFocus = (): void => {
  returnFocusTarget = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
};
const focusNativeClose = (): void => {
  const close = document.querySelector('.trench-gmgn-settings-modal .arco-modal-close-btn');
  if (!(close instanceof HTMLElement)) return;
  close.tabIndex = 0;
  close.focus();
};
const restoreFocus = (): void => {
  if (returnFocusTarget?.isConnected) returnFocusTarget.focus();
  returnFocusTarget = null;
};
</script>

<style lang="less">
@import './TrenchGmgnSettings.less';
</style>
