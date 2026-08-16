<template>
  <main name="trench__index" class="trench-index">
    <section name="trench__index__actions" class="trench-index__actions">
      <div class="trench-index__action-buttons">
        <a-button
          name="trench__index__add-ca"
          size="small"
          type="primary"
          :disabled="running || unavailable"
          @click="openAddDialog"
        >
          <template #icon><IconPlus aria-hidden="true" /></template>
          {{ t('trench.indexWorkspace.addCa') }}
        </a-button>
        <a-button
          name="trench__index__reanalyze"
          size="small"
          :loading="reanalyzePending"
          :disabled="running || unavailable || allTargetCount === 0"
          @click="reanalyze"
        >
          <template #icon><IconRefresh aria-hidden="true" /></template>
          {{ t('trench.indexWorkspace.reanalyzeAll') }}
        </a-button>
      </div>
      <div class="trench-index__run-status" aria-live="polite">
        {{ runStatus }}
      </div>
    </section>

    <div
      v-if="store.commandError && !unavailable"
      class="trench-index__action-error"
      role="alert"
    >
      <span>{{ localizedError(store.commandError) }}</span>
      <a-button
        v-if="store.commandError.code === 'PROVIDER_UNAVAILABLE'"
        name="trench__index__configure-gmgn"
        size="mini"
        @click="trenchGmgnSettingsStore.open()"
      >{{ t('trench.gmgnSettings.configure') }}</a-button>
    </div>

    <div v-if="unavailable" class="trench-index__repository-error" role="alert">
      <span>{{ store.commandError ? localizedError(store.commandError) : t('trench.indexWorkspace.storageUnavailable') }}</span>
      <a-button name="trench__index__retry" size="mini" @click="store.refresh()">{{ t('trench.indexWorkspace.retry') }}</a-button>
    </div>

    <div
      v-else
      id="trench-index-chain-panel"
      name="trench__index__columns"
      class="trench-index__columns"
      :aria-label="t('trench.indexWorkspace.indexForChain', { chain: chainLabel(selectedChain) })"
      :class="`trench-index__columns--${selectedChain}`"
    >
      <section name="trench__index__targets" class="trench-index__column trench-index__targets">
        <header class="trench-index__column-header">{{ t('trench.indexWorkspace.targetCasForChain', { chain: chainLabel(selectedChain) }) }}</header>
        <div v-if="!activeProjection?.targets.length" class="trench-index__empty">
          <strong>{{ t('trench.indexWorkspace.emptyTargetTitle') }}</strong>
          <span>{{ t('trench.indexWorkspace.emptyTargetDescription') }}</span>
          <a-button size="small" type="primary" @click="openAddDialog">{{ t('trench.indexWorkspace.addCa') }}</a-button>
        </div>
        <div v-else class="trench-index__list">
          <article
            v-for="target in activeProjection?.targets"
            :key="target.targetId"
            name="trench__index__target-row"
            class="trench-index__target-row"
          >
            <div class="trench-index__identity-line">
              <strong>{{ target.name || t('trench.indexWorkspace.unknownToken') }}</strong>
              <span v-if="target.symbol" class="trench-index__symbol">{{ target.symbol }}</span>
            </div>
            <button
              class="trench-index__address"
              type="button"
              :title="t('trench.indexWorkspace.copyAddress', { address: target.contractAddress })"
              :aria-label="t('trench.indexWorkspace.copyContractAddress', { address: target.contractAddress })"
              @click="copy(target.contractAddress)"
            >{{ target.contractAddress }}</button>
            <dl class="trench-index__metrics">
              <div><dt>{{ t('trench.indexWorkspace.currentMc') }}</dt><dd>{{ money(target.currentMarketCapUsd) }}</dd></div>
              <div><dt>{{ highestLabel(target.highestMarketCapKind) }}</dt><dd>{{ money(target.highestMarketCapUsd) }}</dd></div>
            </dl>
            <div class="trench-index__row-status" :class="`trench-index__row-status--${target.state}`">
              <span v-if="target.state === 'analyzing'">{{ t('trench.indexWorkspace.analyzing') }}</span>
              <span v-else-if="target.errorCode" :title="target.errorMessage || undefined">{{ localizedError({ code: target.errorCode, message: target.errorMessage || '' }) }}</span>
              <span v-else-if="target.lastSuccessAt">{{ t('trench.indexWorkspace.updatedAt', { time: dateTime(target.lastSuccessAt) }) }}</span>
              <span v-else>{{ t('trench.indexWorkspace.waitingFirstAnalysis') }}</span>
            </div>
          </article>
        </div>
      </section>

      <section name="trench__index__wallets" class="trench-index__column trench-index__wallets">
        <header class="trench-index__column-header">{{ t('trench.indexWorkspace.indexWalletsForChain', { chain: chainLabel(selectedChain) }) }}</header>
        <div v-if="running && !snapshot?.currentRun" class="trench-index__empty" aria-live="polite">
          <strong>{{ t('trench.indexWorkspace.firstRunTitle') }}</strong>
          <span>{{ t('trench.indexWorkspace.firstRunDescription') }}</span>
        </div>
        <div v-else-if="!activeProjection?.wallets.length" class="trench-index__empty">
          <strong>{{ t('trench.indexWorkspace.emptyIndexTitle') }}</strong>
          <span>{{ t('trench.indexWorkspace.emptyIndexDescription') }}</span>
        </div>
        <div v-else class="trench-index__list">
          <article
            v-for="wallet in activeProjection?.wallets"
            :key="wallet.walletId"
            name="trench__index__wallet-row"
            class="trench-index__wallet-row"
          >
            <span class="trench-index__rank">#{{ String(wallet.chainRank).padStart(3, '0') }}</span>
            <span
              v-if="wallet.avatarUrl"
              name="trench__index__wallet-avatar"
              class="trench-index__avatar"
              aria-hidden="true"
            >
              <span class="trench-index__avatar-fallback">{{ trenchWalletAvatarInitial(wallet.name, wallet.canonicalAddress) }}</span>
              <img
                v-if="hasTrenchWalletAvatarImage(wallet.avatarUrl, failedAvatarUrls)"
                name="trench__index__wallet-avatar-image"
                class="trench-index__avatar-image"
                :src="wallet.avatarUrl"
                alt=""
                referrerpolicy="no-referrer"
                @error="onAvatarError(wallet.avatarUrl)"
              />
            </span>
            <div class="trench-index__wallet-body">
              <div class="trench-index__identity-line">
                <strong v-if="wallet.name">{{ wallet.name }}</strong>
              </div>
              <button
                class="trench-index__address"
                type="button"
                :title="t('trench.indexWorkspace.copyAddress', { address: wallet.address })"
                :aria-label="t('trench.indexWorkspace.copyWalletAddress', { address: wallet.address })"
                @click="copy(wallet.address)"
              >{{ wallet.address }}</button>
              <div class="trench-index__wallet-profit">{{ t('trench.indexWorkspace.totalProfit', { value: money(wallet.totalProfitUsd) }) }}</div>
              <div class="trench-index__wallet-meta">
                {{ t('trench.indexWorkspace.walletSources', { count: wallet.sourceCaCount, rank: wallet.bestSourceRank }) }}
              </div>
              <p v-if="wallet.note" class="trench-index__note">{{ wallet.note }}</p>
            </div>
          </article>
        </div>
      </section>
    </div>

    <a-modal
      v-model:visible="addDialogVisible"
      :title="t('trench.indexWorkspace.dialogTitleForChain', { chain: chainLabel(selectedChain) })"
      :ok-text="t('trench.indexWorkspace.addAndAnalyze')"
      :ok-loading="addPending"
      :mask-closable="!addPending"
      :closable="!addPending"
      :on-before-ok="submitAdd"
      @cancel="closeAddDialog"
    >
      <label class="trench-index__field-label" for="trench-index-ca-input">{{ t('trench.indexWorkspace.contractAddress') }}</label>
      <a-textarea
        id="trench-index-ca-input"
        ref="caInput"
        v-model="caText"
        name="trench__index__ca-input"
        :placeholder="t('trench.indexWorkspace.caBatchPlaceholderForChain', { chain: chainLabel(selectedChain) })"
        :disabled="addPending"
        :auto-size="{ minRows: 4, maxRows: 10 }"
        @input="clearDialogError"
      />
      <p v-if="addPartition.ignoredCount" class="trench-index__dialog-warning" role="status">
        {{ t(addPartition.ignoredChain === 'solana' ? 'trench.indexWorkspace.ignoredSolana' : 'trench.indexWorkspace.ignoredBsc', { count: addPartition.ignoredCount }) }}
      </p>
      <div v-if="dialogError" class="trench-index__dialog-error" role="alert">
        <span>{{ dialogError }}</span>
        <a-button
          v-if="dialogErrorCode === 'PROVIDER_UNAVAILABLE'"
          name="trench__index__dialog-configure-gmgn"
          size="mini"
          @click="trenchGmgnSettingsStore.open()"
        >{{ t('trench.gmgnSettings.configure') }}</a-button>
      </div>
    </a-modal>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconPlus, IconRefresh } from '@tabler/icons-vue';
import type { TrenchChain } from '@shared/trench/trench.type';
import type { TrenchHighestMarketCapKind, TrenchIndexError } from '@shared/trench/trenchIndex.type';
import { trenchGmgnSettingsStore } from '../TrenchGmgnSettings/trenchGmgnSettings.runtime';
import { trenchIndexStore as store } from '../../views/index/trenchIndex.runtime';
import {
  buildTrenchIndexAddTargetInput,
  partitionTrenchIndexAddInput,
} from '../../views/index/trenchIndexAddInput';
import {
  hasTrenchWalletAvatarImage,
  markTrenchWalletAvatarFailed,
  trenchWalletAvatarInitial,
} from './trenchIndexAvatar';

const props = defineProps<{
  selectedChain: TrenchChain;
}>();

const addDialogVisible = ref(false);
const { locale, t } = useI18n();
const addPending = ref(false);
const reanalyzePending = ref(false);
const caText = ref('');
const selectedChain = computed(() => props.selectedChain);
const dialogError = ref<string | null>(null);
const dialogErrorCode = ref<TrenchIndexError['code'] | null>(null);
const caInput = ref<{ focus(): void } | null>(null);
const failedAvatarUrls = ref<ReadonlySet<string>>(new Set());
const snapshot = computed(() => store.snapshot);
const activeProjection = computed(() => snapshot.value?.chainProjections
  .find(({ chain }) => chain === selectedChain.value));
const allTargetCount = computed(() => snapshot.value?.chainProjections
  .reduce((count, projection) => count + projection.targets.length, 0) ?? 0);
const addPartition = computed(() => partitionTrenchIndexAddInput(caText.value, selectedChain.value));
const running = computed(() => snapshot.value?.jobState === 'running');
const unavailable = computed(() => store.phase === 'unavailable');
const runStatus = computed(() => {
  if (running.value) return t('trench.indexWorkspace.runningTargets', {
    count: snapshot.value?.activeRun?.targetCount ?? 0,
  });
  if (snapshot.value?.lastFailedRun &&
    (!snapshot.value.currentRun || snapshot.value.lastFailedRun.startedAt > snapshot.value.currentRun.startedAt)) {
    return t('trench.indexWorkspace.lastRunFailed', {
      time: dateTime(snapshot.value.lastFailedRun.completedAt),
    });
  }
  if (snapshot.value?.currentRun?.completedAt) {
    return t('trench.indexWorkspace.lastSuccessful', {
      time: dateTime(snapshot.value.currentRun.completedAt),
    });
  }
  return t('trench.indexWorkspace.noSuccessfulAnalysis');
});

const chainLabel = (value: TrenchChain): string => value === 'solana'
  ? 'SOL'
  : value === 'robinhood'
    ? 'RHC'
    : 'BSC';
const dateTime = (value: number | null): string => value
  ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
  : '—';
const money = (value: number | null): string => value === null
  ? '—'
  : new Intl.NumberFormat(locale.value, {
      style: 'currency',
      currency: 'USD',
      notation: Math.abs(value) >= 1_000_000 ? 'compact' : 'standard',
      maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    }).format(value);
const highestLabel = (kind: TrenchHighestMarketCapKind): string => ({
  'provider-ath': t('trench.indexWorkspace.highestMc'),
  'estimated-ath': t('trench.indexWorkspace.estimatedHighest'),
  observed: t('trench.indexWorkspace.highestObserved'),
  unavailable: t('trench.indexWorkspace.highestMc'),
})[kind];
const localizedError = (error: TrenchIndexError): string => t(
  `trench.indexWorkspace.errors.${error.code}`,
);
const copy = async (value: string): Promise<void> => {
  await navigator.clipboard.writeText(value);
};
const onAvatarError = (avatarUrl: string): void => {
  failedAvatarUrls.value = markTrenchWalletAvatarFailed(failedAvatarUrls.value, avatarUrl);
};
const openAddDialog = (): void => {
  store.clearCommandError();
  addDialogVisible.value = true;
  dialogError.value = null;
  dialogErrorCode.value = null;
  void nextTick(() => caInput.value?.focus());
};
const clearDialogError = (): void => {
  dialogError.value = null;
  dialogErrorCode.value = null;
};
const closeAddDialog = (): void => {
  if (addPending.value) return;
  addDialogVisible.value = false;
  caText.value = '';
  dialogError.value = null;
  dialogErrorCode.value = null;
};
const submitAdd = async (done: (closed: boolean) => void): Promise<void> => {
  const partition = addPartition.value;
  if (partition.enteredCount < 1 || partition.enteredCount > 1_000 || partition.invalidCount > 0) {
    dialogError.value = t('trench.indexWorkspace.addressBatchRequiredForChain', { chain: chainLabel(selectedChain.value) });
    dialogErrorCode.value = 'INVALID_INPUT';
    done(false);
    await nextTick(() => caInput.value?.focus());
    return;
  }
  if (partition.retained.length === 0) {
    dialogError.value = t('trench.indexWorkspace.noValidForChain', { chain: chainLabel(selectedChain.value) });
    dialogErrorCode.value = 'INVALID_INPUT';
    done(false);
    await nextTick(() => caInput.value?.focus());
    return;
  }
  addPending.value = true;
  const request = buildTrenchIndexAddTargetInput(
    partition,
    selectedChain.value,
    window.crypto.randomUUID(),
  );
  if (!request) throw new Error('validated Trench INDEX Add input became empty');
  const ok = await store.addTarget(request);
  addPending.value = false;
  if (!ok) {
    dialogErrorCode.value = store.commandError?.code ?? null;
    dialogError.value = store.commandError
      ? localizedError(store.commandError)
      : t('trench.indexWorkspace.addFailed');
    done(false);
    await nextTick(() => caInput.value?.focus());
    return;
  }
  done(true);
  closeAddDialog();
};
const reanalyze = async (): Promise<void> => {
  reanalyzePending.value = true;
  await store.reanalyze();
  reanalyzePending.value = false;
};
</script>

<style lang="less">
@import './TrenchIndexWorkspace.less';
</style>
