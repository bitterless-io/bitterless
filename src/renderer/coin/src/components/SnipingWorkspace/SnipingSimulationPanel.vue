<template>
  <div name="trench__sniping__simulation" class="sniping-simulation">
    <section name="trench__sniping__exact" class="sniping-simulation__section">
      <header class="sniping-simulation__section-header">
        <div>
          <span class="sniping-simulation__eyebrow">{{ t('trench.sniping.exact.eyebrow') }}</span>
          <h3>{{ t('trench.sniping.exact.title') }}</h3>
        </div>
        <span class="sniping-simulation__simulated">SIMULATED</span>
      </header>
      <p>{{ t('trench.sniping.exact.description') }}</p>
      <div v-if="store.events.length" class="sniping-simulation__event-list">
        <div
          v-for="(event, index) in store.events"
          :key="event.canonical_event_key"
          name="trench__sniping__eligible-event"
          class="sniping-simulation__event"
          :class="{ 'sniping-simulation__event--selected': store.selectedEventKey === event.canonical_event_key }"
        >
          <input
            :id="`sniping-event-${index}`"
            :checked="store.selectedEventKey === event.canonical_event_key"
            type="radio"
            :value="event.canonical_event_key"
            name="sniping-event"
            @change="store.selectEvent(event.canonical_event_key)"
          />
          <label :for="`sniping-event-${index}`">
            <strong>{{ shortAddress(event.token_address) }} → {{ shortAddress(event.quote_token_address) }}</strong>
            <small>#{{ event.block_number }} · {{ shortHash(event.block_hash) }}</small>
            <small>{{ dateTime(event.observed_at) }} → {{ dateTime(event.finalized_at) }}</small>
          </label>
          <code :title="event.canonical_event_key">{{ event.canonical_event_key }}</code>
          <span class="sniping-simulation__copy-actions">
            <a-button size="mini" type="text" @click="copyExact(event.token_address)">
              {{ t('trench.sniping.exact.copyToken') }}
            </a-button>
            <a-button size="mini" type="text" @click="copyExact(event.quote_token_address)">
              {{ t('trench.sniping.exact.copyQuote') }}
            </a-button>
            <a-button size="mini" type="text" @click="copyExact(event.canonical_event_key)">
              {{ t('trench.sniping.exact.copyEvent') }}
            </a-button>
          </span>
        </div>
      </div>
      <div v-else class="sniping-simulation__empty">{{ t('trench.sniping.exact.noEvents') }}</div>
      <div class="sniping-simulation__actions">
        <a-button
          name="trench__sniping__request-exact"
          type="primary"
          size="small"
          :disabled="!store.selectedEventKey || !store.canRequestSimulation"
          :loading="store.pendingAction === 'exact'"
          @click="store.requestExact()"
        >{{ t('trench.sniping.exact.run') }}</a-button>
        <PageButtons
          :page="store.eventPage"
          :total="store.eventTotal"
          :page-size="20"
          @change="setEventPage"
        />
      </div>
      <SimulationRunList
        :runs="store.exactRuns"
        kind="exact"
        :current-revision="store.detail?.config_revision || 0"
      />
      <PageButtons
        :page="store.exactPage"
        :total="store.exactTotal"
        :page-size="20"
        @change="setExactPage"
      />
    </section>

    <section name="trench__sniping__shadow" class="sniping-simulation__section">
      <header class="sniping-simulation__section-header">
        <div>
          <span class="sniping-simulation__eyebrow">{{ t('trench.sniping.shadow.eyebrow') }}</span>
          <h3>{{ t('trench.sniping.shadow.title') }}</h3>
        </div>
        <span class="sniping-simulation__simulated">SIMULATED</span>
      </header>
      <p>{{ t('trench.sniping.shadow.description') }}</p>
      <div class="sniping-simulation__policy">
        <label>
          <span>{{ t('trench.sniping.shadow.maxEvents') }}</span>
          <a-input
            :model-value="store.shadowPolicy.maxEvents"
            size="small"
            placeholder="1–500"
            @update:model-value="store.setShadowPolicyField('maxEvents', String($event))"
          />
        </label>
        <label>
          <span>{{ t('trench.sniping.shadow.checkpoints') }}</span>
          <a-input
            :model-value="store.shadowPolicy.checkpointBlocks"
            size="small"
            :placeholder="t('trench.sniping.shadow.checkpointsPlaceholder')"
            @update:model-value="store.setShadowPolicyField('checkpointBlocks', String($event))"
          />
        </label>
        <label>
          <span>{{ t('trench.sniping.shadow.ttl') }}</span>
          <a-input
            :model-value="store.shadowPolicy.evidenceTtlSeconds"
            size="small"
            placeholder="60–86400"
            @update:model-value="store.setShadowPolicyField('evidenceTtlSeconds', String($event))"
          />
        </label>
      </div>
      <p v-if="store.shadowRequestId" class="sniping-simulation__request-id">
        {{ t('trench.sniping.shadow.requestId') }} <code>{{ store.shadowRequestId }}</code>
      </p>
      <div class="sniping-simulation__actions">
        <a-button
          name="trench__sniping__new-shadow"
          type="primary"
          size="small"
          :disabled="!store.shadowPolicyValue() || !store.canRequestSimulation"
          :loading="store.pendingAction === 'shadow'"
          @click="store.requestNewShadow()"
        >{{ t('trench.sniping.shadow.newRun') }}</a-button>
        <a-button
          v-if="store.shadowRetryAvailable"
          name="trench__sniping__retry-shadow"
          size="small"
          :disabled="!store.shadowPolicyValue() || !!store.pendingAction"
          @click="store.retryShadow()"
        >{{ t('trench.sniping.shadow.retry') }}</a-button>
      </div>
      <SimulationRunList
        :runs="store.shadowRuns"
        kind="shadow"
        :current-revision="store.detail?.config_revision || 0"
      />
      <PageButtons
        :page="store.shadowPage"
        :total="store.shadowTotal"
        :page-size="20"
        @change="setShadowPage"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import PageButtons from './SnipingPageButtons.vue';
import SimulationRunList from './SnipingSimulationRunList.vue';
import { snipingStore as store } from '../../views/sniping/sniping.runtime';

const { locale, t } = useI18n();
const shortAddress = (value: string): string => `${value.slice(0, 8)}…${value.slice(-6)}`;
const shortHash = (value: string): string => `${value.slice(0, 10)}…${value.slice(-8)}`;
const dateTime = (value: string): string => new Intl.DateTimeFormat(locale.value, {
  dateStyle: 'short', timeStyle: 'medium',
}).format(new Date(value));
const copyExact = (value: string): void => { void navigator.clipboard.writeText(value); };
const setEventPage = (page: number): void => { void store.setEventPage(page); };
const setExactPage = (page: number): void => { void store.setExactPage(page); };
const setShadowPage = (page: number): void => { void store.setShadowPage(page); };
</script>

<style lang="less">
@import './SnipingSimulationPanel.less';
</style>
