<template>
  <div name="trench__sniping__configuration" class="sniping-configuration">
    <div v-if="store.isMonitoring" class="sniping-configuration__notice" role="status">
      {{ t('trench.sniping.configuration.stopToEdit') }}
    </div>
    <div v-if="store.revisionConflict" class="sniping-configuration__conflict" role="alert">
      {{ t('trench.sniping.configuration.revisionConflict') }}
    </div>
    <label class="sniping-configuration__name">
      <span>{{ t('trench.sniping.configuration.name') }}</span>
      <a-input
        :model-value="store.detail?.name"
        :disabled="!store.editable"
        size="small"
        @update:model-value="store.setName(String($event))"
      />
    </label>

    <SnipingGeneratedConfigForm
      v-if="store.form.supported"
      :form="store.form"
      :value="store.draft.value"
      :stored-value-source="store.detail?.config || {}"
      :issues="allIssues"
      :disabled="!store.editable"
      :derived-pending="store.draft.changed || store.detail?.config_id === '0'"
      @change="store.setField"
    />
    <div v-else class="sniping-configuration__unsupported" role="status">
      <strong>{{ t('trench.sniping.configuration.advancedRequired') }}</strong>
      <span>{{ t('trench.sniping.configuration.advancedRequiredDescription') }}</span>
    </div>

    <section name="trench__sniping__readiness" class="sniping-readiness">
      <header>{{ t('trench.sniping.readiness.title') }}</header>
      <div class="sniping-readiness__grid">
        <div v-for="runtime in store.runtimes" :key="runtime.region" name="trench__sniping__runtime">
          <span class="sniping-readiness__dot" :class="`sniping-readiness__dot--${runtime.observed_state}`" />
          <strong>{{ runtime.region.toUpperCase() }}</strong>
          <span>{{ runtime.observed_state }}</span>
          <small>{{ runtime.last_error_code || t('trench.sniping.readiness.noError') }}</small>
        </div>
        <div v-if="!store.runtimes.length" class="sniping-readiness__empty">
          {{ t('trench.sniping.readiness.noRuntime') }}
        </div>
      </div>
      <div v-if="store.detail?.credential_status.length" class="sniping-readiness__credentials">
        <span
          v-for="credential in store.detail.credential_status"
          :key="credential.slot"
          name="trench__sniping__credential-status"
        >
          {{ credential.slot }} · {{ credential.configured
            ? t('trench.sniping.readiness.configured')
            : t('trench.sniping.readiness.missing') }}
        </span>
      </div>
      <p v-else class="sniping-readiness__no-secrets">{{ t('trench.sniping.readiness.noSecrets') }}</p>
    </section>

    <section v-if="store.advancedOpen || !store.form.supported" class="sniping-configuration__advanced">
      <header>
        <strong>{{ t('trench.sniping.configuration.advancedJson') }}</strong>
        <span>{{ t('trench.sniping.configuration.sameDraft') }}</span>
      </header>
      <a-textarea
        name="trench__sniping__advanced-json"
        :model-value="store.draft.json"
        :disabled="!store.editable"
        :auto-size="{ minRows: 10, maxRows: 22 }"
        @update:model-value="store.setAdvancedJson(String($event))"
      />
      <p v-if="store.draft.jsonError" class="sniping-configuration__error" role="alert">
        {{ t('trench.sniping.configuration.invalidJson') }}
      </p>
    </section>

    <div v-if="store.productsErrorCode" class="sniping-configuration__error" role="alert">
      <code>{{ store.productsErrorCode }}</code>
    </div>
    <div v-if="store.validationHash" class="sniping-configuration__validated" role="status">
      {{ t('trench.sniping.configuration.validated') }} ·
      <code>{{ store.validationHash.slice(0, 12) }}…</code>
    </div>
    <div name="trench__sniping__configuration-actions" class="sniping-configuration__actions">
      <a-button
        v-if="store.isMonitoring"
        name="trench__sniping__stop-monitoring"
        type="primary"
        status="warning"
        size="small"
        :disabled="!store.remoteReady || store.pendingAction !== null"
        :loading="store.pendingAction === 'stop'"
        @click="store.setMonitoring(false)"
      >{{ t('trench.sniping.actions.stopMonitoring') }}</a-button>
      <a-button
        v-else-if="store.detail?.config_id !== '0'"
        name="trench__sniping__start-monitoring"
        type="primary"
        size="small"
        :disabled="!store.canStartMonitoring"
        :loading="store.pendingAction === 'start'"
        @click="store.setMonitoring(true)"
      >{{ t('trench.sniping.actions.startMonitoring') }}</a-button>
      <a-button
        name="trench__sniping__save"
        size="small"
        :disabled="!store.editable || !store.detail?.name.trim() || !!store.draft.jsonError || !!store.draftIssues.length"
        :loading="store.pendingAction === 'save'"
        @click="store.save()"
      >{{ t('trench.sniping.actions.save') }}</a-button>
      <a-button
        name="trench__sniping__validate"
        size="small"
        :disabled="!store.editable || !!store.draft.jsonError || !!store.draftIssues.length"
        :loading="store.pendingAction === 'validate'"
        @click="store.validate()"
      >{{ t('trench.sniping.actions.validate') }}</a-button>
      <a-button
        name="trench__sniping__advanced-toggle"
        size="small"
        @click="store.setAdvancedOpen(!store.advancedOpen)"
      >{{ t('trench.sniping.configuration.advancedJson') }}</a-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SnipingGeneratedConfigForm from './SnipingGeneratedConfigForm.vue';
import { snipingStore as store } from '../../views/sniping/sniping.runtime';

const { t } = useI18n();
const allIssues = computed(() => [...store.draftIssues, ...store.serverIssues]);
</script>
