<template>
  <a-modal
    :visible="store.dialogOpen"
    :footer="false"
    :width="'min(520px, calc(100vw - 24px))'"
    :mask-closable="!store.pendingAction"
    :esc-to-close="!store.pendingAction"
    :closable="false"
    :unmount-on-close="true"
    modal-class="monitoring-watch-dialog"
    @before-open="rememberFocus"
    @close="restoreFocus"
    @cancel="store.closeDialog()"
  >
    <template #title>
      <div class="monitoring-dialog-title">
        <span>{{
          t(
            store.dialogMode === 'create'
              ? 'trench.monitoring.dialog.addTitle'
              : 'trench.monitoring.dialog.editTitle'
          )
        }}</span>
        <a-button
          v-if="!store.pendingAction"
          name="monitoring__watch__close-dialog"
          type="text"
          size="mini"
          :aria-label="t('trench.monitoring.actions.close')"
          @click="store.closeDialog()"
        >
          <IconX :size="16" aria-hidden="true" />
        </a-button>
      </div>
    </template>
    <div name="monitoring__watch__dialog" class="monitoring-watch-dialog__body">
      <label class="monitoring-watch-dialog__field">
        <span>{{ t('trench.monitoring.dialog.chain') }}</span>
        <a-input
          name="monitoring__watch__chain"
          :model-value="t('trench.monitoring.dialog.chainValue')"
          disabled
        />
      </label>
      <label class="monitoring-watch-dialog__field">
        <span>{{ t('trench.monitoring.dialog.observers') }}</span>
        <a-input
          name="monitoring__watch__regions"
          :model-value="t('trench.monitoring.dialog.observersValue')"
          disabled
        />
      </label>
      <label class="monitoring-watch-dialog__field monitoring-watch-dialog__field--wide">
        <span>{{ t('trench.monitoring.dialog.address') }}</span>
        <a-input
          name="monitoring__watch__address"
          :model-value="store.draft.tokenAddress"
          :placeholder="t('trench.monitoring.dialog.addressPlaceholder')"
          autocomplete="off"
          :disabled="store.pendingAction === 'save'"
          @input="store.setDraft('tokenAddress', String($event ?? ''))"
        />
      </label>
      <label class="monitoring-watch-dialog__field">
        <span>{{ t('trench.monitoring.dialog.label') }}</span>
        <a-input
          name="monitoring__watch__label"
          :model-value="store.draft.name"
          :placeholder="t('trench.monitoring.dialog.labelPlaceholder')"
          :disabled="store.pendingAction === 'save'"
          @input="store.setDraft('name', String($event ?? ''))"
        />
      </label>
      <label class="monitoring-watch-dialog__field">
        <span>{{ t('trench.monitoring.dialog.threshold') }}</span>
        <a-input
          name="monitoring__watch__threshold"
          :model-value="store.draft.threshold"
          inputmode="decimal"
          :disabled="store.pendingAction === 'save'"
          @input="store.setDraft('threshold', String($event ?? ''))"
        />
        <small>{{ t('trench.monitoring.dialog.thresholdHint') }}</small>
      </label>
      <div v-if="store.draftError" class="monitoring-watch-dialog__error" role="alert">
        {{ draftError }}
      </div>
      <div v-if="store.duplicateExistingId" class="monitoring-watch-dialog__notice" role="status">
        <span>{{ t('trench.monitoring.dialog.duplicate') }}</span>
        <a-button
          name="monitoring__watch__open-existing"
          size="mini"
          @click="store.openExistingDuplicate()"
        >
          {{ t('trench.monitoring.actions.openExisting') }}
        </a-button>
      </div>
      <div
        v-else-if="store.dialogRevisionConflict"
        class="monitoring-watch-dialog__error"
        role="alert"
      >
        <span>{{ t('trench.monitoring.dialog.conflict') }}</span>
        <a-button
          name="monitoring__watch__reload-version"
          size="mini"
          @click="store.reloadServerVersion()"
        >
          {{ t('trench.monitoring.actions.reloadVersion') }}
        </a-button>
      </div>
      <div v-else-if="store.dialogActionError" class="monitoring-watch-dialog__error" role="alert">
        {{ t('trench.monitoring.errors.generic', { code: store.dialogActionError }) }}
      </div>
    </div>
    <footer class="monitoring-watch-dialog__actions">
      <a-button
        name="monitoring__watch__cancel"
        :disabled="store.pendingAction === 'save'"
        @click="store.closeDialog()"
      >
        {{ t('trench.monitoring.actions.cancel') }}
      </a-button>
      <a-button
        name="monitoring__watch__save"
        type="primary"
        :loading="store.pendingAction === 'save'"
        @click="store.saveDraft()"
        >{{
          t(
            store.dialogMode === 'create'
              ? 'trench.monitoring.actions.create'
              : 'trench.monitoring.actions.save'
          )
        }}</a-button
      >
    </footer>
  </a-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconX } from '@tabler/icons-vue';
import { monitoringStore as store } from '../../views/monitoring/monitoring.runtime';

const { t } = useI18n();
let returnFocus: HTMLElement | null = null;
const rememberFocus = (): void => {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
};
const restoreFocus = (): void => {
  returnFocus?.focus();
  returnFocus = null;
};
const draftError = computed(() => {
  if (store.draftError === 'MONITORING_ADDRESS_INVALID')
    return t('trench.monitoring.errors.address');
  if (store.draftError === 'MONITORING_THRESHOLD_INVALID')
    return t('trench.monitoring.errors.threshold');
  return t('trench.monitoring.errors.name');
});
</script>
