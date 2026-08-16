<template>
  <section name="trench__trenchers__person-detail" class="trenchers__person-detail">
    <a-button
      v-if="store.detailPaneRequested"
      name="trench__trenchers__back"
      class="trenchers__back"
      size="mini"
      type="text"
      @click="store.closePersonDetail()"
    >{{ t('trench.trenchers.backToTraders') }}</a-button>
    <div v-if="store.detailError && !store.detail" class="trenchers__detail-state" role="alert">
      <strong>{{ errorText(store.detailError) }}</strong>
      <a-button
        v-if="store.selectedPersonId"
        name="trench__trenchers__retry-detail"
        size="mini"
        @click="store.selectPerson(store.selectedPersonId)"
      >{{ t('trench.indexWorkspace.retry') }}</a-button>
    </div>
    <div v-else-if="!store.detail" class="trenchers__detail-state">
      <span>{{ t('trench.trenchers.selectPerson') }}</span>
    </div>
    <template v-else>
      <div v-if="store.detailError" class="trenchers__detail-warning" role="alert">
        <span>{{ errorText(store.detailError) }}</span>
        <a-button
          name="trench__trenchers__retry-detail-refresh"
          size="mini"
          @click="store.refresh(true)"
        >{{ t('trench.indexWorkspace.retry') }}</a-button>
      </div>
      <header name="trench__trenchers__profile" class="trenchers__profile">
        <span name="trench__trenchers__avatar" class="trenchers__avatar" aria-hidden="true">
          <span>{{ trenchWalletAvatarInitial(store.detail.displayName, store.detail.personId) }}</span>
          <img
            v-if="store.detail.avatarUrl && hasTrenchWalletAvatarImage(store.detail.avatarUrl, failedAvatarUrls)"
            :src="store.detail.avatarUrl"
            alt=""
            referrerpolicy="no-referrer"
            @error="onAvatarError(store.detail.avatarUrl)"
          />
        </span>
        <div class="trenchers__profile-body">
          <span class="trenchers__eyebrow">{{ t('trench.trenchers.personProfile') }}</span>
          <h1>{{ store.detail.displayName || t('trench.trenchers.anonymous') }}</h1>
          <p v-if="store.detail.note">{{ store.detail.note }}</p>
          <p v-else class="trenchers__muted">{{ t('trench.trenchers.noPersonNote') }}</p>
        </div>
        <a-button name="trench__trenchers__edit-profile" size="small" @click="openEdit">
          {{ t('trench.trenchers.editProfile') }}
        </a-button>
      </header>

      <div name="trench__trenchers__profile-evidence" class="trenchers__profile-evidence">
        <div>
          <span>{{ t('trench.trenchers.xIdentity') }}</span>
          <strong v-if="xIdentity">@{{ xIdentity.canonicalValue }}</strong>
          <strong v-else>—</strong>
          <small v-if="xIdentity">{{ sourceLabel(xIdentity.source) }} · {{ dateTime(xIdentity.updatedAt) }}</small>
        </div>
        <div>
          <span>{{ t('trench.trenchers.profileProvenance') }}</span>
          <strong>{{ t('trench.trenchers.profileSources', {
            name: sourceLabel(store.detail.displayNameSource),
            avatar: sourceLabel(store.detail.avatarSource),
            note: sourceLabel(store.detail.noteSource),
          }) }}</strong>
          <small>{{ t('trench.trenchers.updatedAt', { time: dateTime(store.detail.updatedAt) }) }}</small>
        </div>
        <div>
          <span>{{ t('trench.trenchers.walletAggregate') }}</span>
          <strong>{{ aggregateMoney }}</strong>
          <small>{{ t('trench.trenchers.rankedWalletCount', { count: store.detail.profit.rankedWalletCount }) }}</small>
        </div>
      </div>

      <div name="trench__trenchers__wallet-heading" class="trenchers__wallet-heading">
        <div>
          <strong>{{ t('trench.trenchers.wallets') }}</strong>
          <span>{{ t('trench.trenchers.walletAggregateDisclaimer') }}</span>
        </div>
        <a-button name="trench__trenchers__move-wallet" size="small" @click="openMove">
          {{ t('trench.trenchers.moveWallet') }}
        </a-button>
      </div>

      <div name="trench__trenchers__wallet-list" class="trenchers__wallet-list">
        <article
          v-for="wallet in store.detail.wallets"
          :key="wallet.walletId"
          name="trench__trenchers__wallet-row"
          class="trenchers__wallet-row"
        >
          <div class="trenchers__wallet-identity">
            <strong>{{ wallet.name || t('trench.trenchers.unnamedWallet') }}</strong>
            <span>{{ t('trench.trenchers.membershipSource', { source: linkSourceLabel(wallet.membershipSource) }) }}</span>
          </div>
          <button
            name="trench__trenchers__wallet-address"
            class="trenchers__address"
            type="button"
            :title="t('trench.indexWorkspace.copyAddress', { address: wallet.address })"
            :aria-label="t('trench.indexWorkspace.copyWalletAddress', { address: wallet.address })"
            @click="copy(wallet.address)"
          >{{ wallet.address }}</button>
          <p v-if="wallet.note" class="trenchers__wallet-note">{{ wallet.note }}</p>
          <div class="trenchers__account-list">
            <div
              v-for="account in wallet.accounts"
              :key="account.walletAccountId"
              name="trench__trenchers__wallet-account"
              class="trenchers__wallet-account"
            >
              <span class="trenchers__chain-badge" :class="`trenchers__chain-badge--${account.chain}`">
                {{ chainLabel(account.chain) }}
              </span>
              <span>{{ account.currentChainRank ? `#${String(account.currentChainRank).padStart(3, '0')}` : '—' }}</span>
              <strong>{{ nullableMoney(account.currentTotalProfitUsd) }}</strong>
              <span>{{ t('trench.trenchers.lastSeen', { time: dateTime(account.lastSeenAt) }) }}</span>
            </div>
          </div>
        </article>
      </div>
      <div v-if="store.detailPhase === 'refreshing'" class="trenchers__detail-refresh" aria-live="polite">
        {{ t('trench.trenchers.refreshing') }}
      </div>
    </template>

    <a-modal
      v-model:visible="editVisible"
      name="trench__trenchers__edit-modal"
      :title="t('trench.trenchers.editProfile')"
      :ok-text="t('trench.trenchers.saveProfile')"
      :ok-loading="store.profileSubmitPending"
      :mask-closable="!store.profileSubmitPending"
      :closable="!store.profileSubmitPending"
      :esc-to-close="!store.profileSubmitPending"
      :on-before-ok="saveProfile"
      :on-before-cancel="allowProfileCancel"
      @cancel="closeEdit"
    >
      <label class="trenchers__field-label" for="trench-person-display-name">{{ t('trench.trenchers.displayName') }}</label>
      <a-input id="trench-person-display-name" v-model="store.profileDraftDisplayName" name="trench__trenchers__display-name" :disabled="store.profileSubmitPending" />
      <label class="trenchers__field-label" for="trench-person-avatar-url">{{ t('trench.trenchers.avatarUrl') }}</label>
      <a-input id="trench-person-avatar-url" v-model="store.profileDraftAvatarUrl" name="trench__trenchers__avatar-url" :disabled="store.profileSubmitPending" placeholder="https://" />
      <label class="trenchers__field-label" for="trench-person-note">{{ t('trench.trenchers.personNote') }}</label>
      <a-textarea id="trench-person-note" v-model="store.profileDraftNote" name="trench__trenchers__note" :disabled="store.profileSubmitPending" :auto-size="{ minRows: 4, maxRows: 8 }" />
      <p class="trenchers__field-hint">{{ t('trench.trenchers.blankClears') }}</p>
      <p v-if="store.mutationError" class="trenchers__modal-error" role="alert">{{ errorText(store.mutationError) }}</p>
    </a-modal>

    <a-modal
      v-model:visible="moveVisible"
      name="trench__trenchers__move-modal"
      :title="t('trench.trenchers.moveWallet')"
      :ok-text="moveOkText"
      :ok-loading="store.movePending"
      :mask-closable="!store.movePending"
      :closable="!store.movePending"
      :esc-to-close="!store.movePending"
      :on-before-ok="advanceMove"
      :on-before-cancel="allowMoveCancel"
      @cancel="closeMove"
    >
      <p class="trenchers__move-intro">{{ t('trench.trenchers.moveWalletDescription') }}</p>
      <label class="trenchers__field-label" for="trench-wallet-chain">{{ t('trench.trenchers.chain') }}</label>
      <a-select
        id="trench-wallet-chain"
        v-model="moveChain"
        name="trench__trenchers__move-chain"
        :disabled="store.movePending"
      >
        <a-option value="solana">SOL</a-option>
        <a-option value="bsc">BSC</a-option>
        <a-option value="robinhood">{{ t('trench.navigation.robinhood') }}</a-option>
      </a-select>
      <label class="trenchers__field-label" for="trench-wallet-address">{{ t('trench.trenchers.walletAddress') }}</label>
      <a-input
        id="trench-wallet-address"
        v-model="moveAddress"
        name="trench__trenchers__move-address"
        :disabled="store.movePending"
      />
      <div v-if="store.moveCandidate" name="trench__trenchers__move-confirmation" class="trenchers__move-confirmation">
        <strong>{{ t('trench.trenchers.confirmMoveTitle') }}</strong>
        <dl>
          <div><dt>{{ t('trench.trenchers.fromPerson') }}</dt><dd>{{ store.moveCandidate.sourceDisplayName || t('trench.trenchers.anonymous') }}</dd></div>
          <div><dt>{{ t('trench.trenchers.personId') }}</dt><dd :title="store.moveCandidate.sourcePersonId">{{ store.moveCandidate.sourcePersonId }}</dd></div>
          <div><dt>{{ t('trench.trenchers.currentMembership') }}</dt><dd>{{ linkSourceLabel(store.moveCandidate.wallet.membershipSource) }}</dd></div>
          <div><dt>{{ t('trench.trenchers.toPerson') }}</dt><dd>{{ store.detail?.displayName || t('trench.trenchers.anonymous') }}</dd></div>
          <div><dt>{{ t('trench.trenchers.walletAddress') }}</dt><dd>{{ store.moveCandidate.wallet.address }}</dd></div>
        </dl>
        <p>{{ t('trench.trenchers.moveConfirmationWarning') }}</p>
      </div>
      <p v-if="store.mutationError" class="trenchers__modal-error" role="alert">{{ errorText(store.mutationError) }}</p>
    </a-modal>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TrenchChain } from '@shared/trench/trench.type';
import type { TrenchIndexError } from '@shared/trench/trenchIndex.type';
import type {
  TrenchPersonProfileSource,
  TrenchPersonWalletLinkSource,
} from '@shared/trench/trenchPerson.type';
import {
  hasTrenchWalletAvatarImage,
  markTrenchWalletAvatarFailed,
  trenchWalletAvatarInitial,
} from '../TrenchIndexWorkspace/trenchIndexAvatar';
import { trenchPersonStore as store } from '../../views/trenchers/trenchPerson.runtime';

const { locale, t } = useI18n();
const failedAvatarUrls = ref<ReadonlySet<string>>(new Set());
const editVisible = ref(false);
const moveVisible = ref(false);
const moveChain = computed<TrenchChain>({
  get: () => store.moveChain,
  set: (value) => store.setMoveChain(value),
});
const moveAddress = computed<string>({
  get: () => store.moveAddress,
  set: (value) => store.setMoveAddress(value),
});
const xIdentity = computed(() => store.detail?.externalIdentities.find(({ provider }) => provider === 'x') ?? null);
const money = (value: number): string => new Intl.NumberFormat(locale.value, {
  style: 'currency',
  currency: 'USD',
  notation: Math.abs(value) >= 1_000_000 ? 'compact' : 'standard',
  maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
}).format(value);
const aggregateMoney = computed(() => store.detail && store.detail.profit.rankedWalletCount > 0
  ? money(store.detail.profit.totalProfitUsd)
  : '—');
const nullableMoney = (value: number | null): string => value === null ? '—' : money(value);
const dateTime = (value: number): string => new Intl.DateTimeFormat(locale.value, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(value);
const chainLabel = (chain: TrenchChain): string => chain === 'solana'
  ? 'SOL'
  : chain === 'robinhood'
    ? 'RHC'
    : 'BSC';
const sourceLabel = (source: TrenchPersonProfileSource): string =>
  t(`trench.trenchers.profileSource.${source}`);
const linkSourceLabel = (source: TrenchPersonWalletLinkSource): string =>
  t(`trench.trenchers.linkSource.${source}`);
const errorText = (error: TrenchIndexError): string => t(`trench.trenchers.errors.${error.code}`);
const moveOkText = computed(() => store.moveCandidate
  ? t('trench.trenchers.confirmMove')
  : t('trench.trenchers.findWallet'));
const onAvatarError = (avatarUrl: string): void => {
  failedAvatarUrls.value = markTrenchWalletAvatarFailed(failedAvatarUrls.value, avatarUrl);
};
const copy = async (value: string): Promise<void> => {
  await navigator.clipboard.writeText(value);
};
const openEdit = (): void => {
  if (store.beginProfileEdit()) editVisible.value = true;
};
const closeEdit = (): void => {
  if (store.profileSubmitPending) return;
  editVisible.value = false;
  store.cancelProfileEdit();
};
const allowProfileCancel = (): boolean => !store.profileSubmitPending;
const saveProfile = async (done: (closed: boolean) => void): Promise<void> => {
  done(await store.submitProfileEdit());
};
const openMove = (): void => {
  store.beginMoveWallet();
  moveVisible.value = true;
};
const closeMove = (): void => {
  if (store.movePending) return;
  moveVisible.value = false;
  store.cancelMoveWallet();
};
const allowMoveCancel = (): boolean => !store.movePending;
const advanceMove = async (done: (closed: boolean) => void): Promise<void> => {
  done(await store.advanceMoveWallet() === 'moved');
};
</script>
