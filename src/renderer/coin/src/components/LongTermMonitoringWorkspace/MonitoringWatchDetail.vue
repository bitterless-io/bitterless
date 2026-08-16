<template>
  <article name="monitoring__watch__detail" class="monitoring-watch-detail">
    <a-button
      name="monitoring__watch__back"
      class="monitoring-watch-detail__back"
      size="mini"
      @click="store.backToWatches()"
      >{{ t('trench.monitoring.actions.back') }}</a-button
    >

    <div
      v-if="store.detailLoading && !detail"
      class="monitoring-watch-detail__empty"
      aria-live="polite"
    >
      <a-spin size="small" />
      <strong>{{ t('trench.monitoring.detail.loading') }}</strong>
    </div>
    <div
      v-else-if="store.errors.detail && !detail"
      class="monitoring-watch-detail__empty"
      role="alert"
    >
      <strong>{{ t('trench.monitoring.detail.loadFailed', { watch: selectedWatchLabel }) }}</strong>
      <span>{{ errorText(store.errors.detail) }}</span>
      <a-button
        name="monitoring__watch__retry-missing-detail"
        size="mini"
        :loading="store.detailLoading"
        @click="retryDetail"
      >
        {{ t('trench.monitoring.actions.retry') }}
      </a-button>
    </div>
    <div v-else-if="!detail" class="monitoring-watch-detail__empty">
      <strong>{{ t('trench.monitoring.watches.selectTitle') }}</strong>
      <span>{{ t('trench.monitoring.watches.selectDescription') }}</span>
    </div>
    <template v-else>
      <header class="monitoring-watch-detail__header">
        <div class="monitoring-watch-detail__identity">
          <span class="monitoring-watch-detail__chain">BSC · eip155:56</span>
          <h1>{{ detail.name }}</h1>
          <code>{{ detail.asset_key }}</code>
        </div>
        <div class="monitoring-watch-detail__actions">
          <a-button
            v-if="store.isMonitoring"
            name="monitoring__watch__stop"
            status="danger"
            size="small"
            :loading="store.pendingAction === 'stop'"
            :disabled="!store.canMutate"
            @click="store.setMonitoring(false)"
            >{{ t('trench.monitoring.actions.stop') }}</a-button
          >
          <a-button
            v-else
            name="monitoring__watch__start"
            type="primary"
            size="small"
            :loading="store.pendingAction === 'start'"
            :disabled="!store.canMutate"
            @click="store.setMonitoring(true)"
            >{{ t('trench.monitoring.actions.start') }}</a-button
          >
          <a-tooltip
            :content="store.isMonitoring ? t('trench.monitoring.detail.stopToEdit') : ''"
            mini
          >
            <span
              :tabindex="store.isMonitoring ? 0 : -1"
              :aria-label="
                store.isMonitoring ? t('trench.monitoring.detail.stopToEdit') : undefined
              "
            >
              <a-button
                name="monitoring__watch__edit"
                size="small"
                :disabled="!store.canEdit"
                @click="store.openEdit()"
                >{{ t('trench.monitoring.actions.edit') }}</a-button
              >
            </span>
          </a-tooltip>
        </div>
      </header>

      <div v-if="store.detailStaleSince" class="monitoring-watch-detail__notice" role="alert">
        <span>{{
          t('trench.monitoring.watches.stale', { time: utcInstant(store.detailStaleSince) })
        }}</span>
        <a-button
          name="monitoring__watch__retry-detail"
          size="mini"
          @click="store.selectWatch(detail.config_id, false)"
        >
          {{ t('trench.monitoring.actions.retry') }}
        </a-button>
      </div>
      <div
        v-if="store.revisionConflict"
        class="monitoring-watch-detail__notice monitoring-watch-detail__notice--danger"
        role="alert"
      >
        <span>{{ t('trench.monitoring.detail.conflict') }}</span>
        <a-button
          name="monitoring__watch__reload-detail"
          size="mini"
          @click="store.reloadServerVersion()"
        >
          {{ t('trench.monitoring.actions.reloadVersion') }}
        </a-button>
      </div>
      <div
        v-else-if="store.errors.action"
        class="monitoring-watch-detail__notice monitoring-watch-detail__notice--danger"
        role="alert"
      >
        {{ errorText(store.errors.action) }}
      </div>

      <div name="monitoring__watch__facts" class="monitoring-watch-detail__facts">
        <div>
          <span>{{ t('trench.monitoring.detail.latestBucket') }}</span>
          <strong>{{ countLabel }}</strong>
          <small>{{
            display.currentSample
              ? utcRange(display.currentSample.bucket_start, display.currentSample.bucket_end)
              : t('trench.monitoring.detail.noEvidence')
          }}</small>
          <small v-if="display.staleRuntime">{{
            t('trench.monitoring.detail.lastVerifiedStale')
          }}</small>
        </div>
        <div>
          <span>{{ t('trench.monitoring.detail.zScore') }}</span>
          <strong :class="`monitoring-tone--${tone(display.evidence.state)}`">{{
            display.evidence.zScore ?? t('trench.monitoring.watches.unknown')
          }}</strong>
          <small>{{
            display.evidenceIdentity
              ? t('trench.monitoring.detail.threshold', {
                  value: display.evidenceIdentity.zscoreThreshold.toFixed(2)
                })
              : t('trench.monitoring.detail.thresholdUnknown')
          }}</small>
        </div>
        <div>
          <span>{{ t('trench.monitoring.detail.baseline') }}</span>
          <strong>{{
            display.baselineCount === null
              ? t('trench.monitoring.watches.unknown')
              : display.baselineState === 'WARMING'
                ? stateLabel('WARMING') +
                  ' ' +
                  display.baselineCount +
                  ' / ' +
                  display.baselineMinimumCount
                : display.baselineCount + ' / ' + (display.baselineMinimumCount ?? 288)
          }}</strong>
          <small>{{ t('trench.monitoring.detail.latestExcluded') }}</small>
        </div>
        <div>
          <span>{{ t('trench.monitoring.detail.regions') }}</span>
          <strong :class="`monitoring-tone--${tone(display.evidence.state)}`">{{
            display.currentSample
              ? agreementLabel(display.currentSample.agreement)
              : t('trench.monitoring.watches.unknown')
          }}</strong>
          <small>{{
            display.evidence.confirmation === 'unknown'
              ? t('trench.monitoring.evidence.noEvidenceStatus')
              : t(`trench.monitoring.evidence.${display.evidence.confirmation}`)
          }}</small>
        </div>
        <div>
          <span>{{ t('trench.monitoring.detail.revision') }}</span>
          <strong>r{{ store.samplesRevision }}</strong>
          <small>{{
            display.evidenceIdentity?.detectorVersion ?? t('trench.monitoring.watches.unknown')
          }}</small>
        </div>
      </div>

      <div class="monitoring-watch-detail__scroll">
        <section name="monitoring__watch__series" class="monitoring-panel">
          <header class="monitoring-panel__header">
            <div>
              <h2>{{ t('trench.monitoring.detector.title') }}</h2>
              <p>{{ t('trench.monitoring.detector.range') }}</p>
              <code class="monitoring-panel__asset">{{
                display.evidenceIdentity?.assetKey ?? t('trench.monitoring.watches.unknown')
              }}</code>
            </div>
            <label class="monitoring-panel__revision">
              <span>{{ t('trench.monitoring.detector.revision') }}</span>
              <a-select
                name="monitoring__watch__revision"
                size="small"
                :model-value="store.samplesRevision ?? undefined"
                @change="store.setSamplesRevision(Number($event))"
              >
                <a-option
                  v-for="revision in detail.available_revisions"
                  :key="revision.revision"
                  :value="revision.revision"
                  >r{{ revision.revision }} ·
                  {{
                    revision.desired_state === 'armed'
                      ? t('trench.monitoring.watches.monitoring')
                      : t('trench.monitoring.watches.stopped')
                  }}</a-option
                >
              </a-select>
            </label>
          </header>
          <div
            v-if="store.sampleViewState.mode === 'loading'"
            class="monitoring-panel__state"
            aria-live="polite"
          >
            <a-spin size="small" />
            <span>{{ t('trench.monitoring.detector.loading') }}</span>
          </div>
          <div
            v-else-if="store.sampleViewState.mode === 'error'"
            class="monitoring-panel__state monitoring-panel__partial"
            role="alert"
          >
            <span>{{ errorText(store.errors.samples ?? 'MONITORING_UNAVAILABLE') }}</span>
            <a-button
              name="monitoring__watch__retry-empty-series"
              size="small"
              :loading="store.samplesLoading"
              @click="store.retrySamples()"
              >{{ t('trench.monitoring.actions.retry') }}</a-button
            >
          </div>
          <MonitoringChart
            v-else
            :samples="store.samples.slice(0, 500)"
            :threshold="display.evidenceIdentity?.zscoreThreshold ?? null"
          />
          <div
            v-if="store.samples.length && store.samplesLoading"
            class="monitoring-panel__partial"
            aria-live="polite"
          >
            <a-spin size="small" />
            {{
              t(
                store.samplesPendingOperation === 'older'
                  ? 'trench.monitoring.detector.loadingOlder'
                  : 'trench.monitoring.detector.refreshing',
                { count: store.samples.length }
              )
            }}
          </div>
          <div
            v-else-if="store.samples.length && store.samplesInitialPartial"
            class="monitoring-panel__partial"
            role="alert"
          >
            {{ t('trench.monitoring.detector.partial', { count: store.samples.length }) }}
            <template v-if="store.samplesStaleSince">
              ·
              {{
                t('trench.monitoring.watches.stale', {
                  time: utcInstant(store.samplesStaleSince)
                })
              }}
            </template>
          </div>
          <div
            v-else-if="store.samples.length && store.errors.samples"
            class="monitoring-panel__partial"
            role="alert"
          >
            {{ errorText(store.errors.samples) }}
            <template v-if="store.samplesStaleSince">
              ·
              {{
                t('trench.monitoring.watches.stale', {
                  time: utcInstant(store.samplesStaleSince)
                })
              }}
            </template>
          </div>
          <div v-if="store.sampleViewState.showFooter" class="monitoring-panel__cursor">
            <a-button
              v-if="store.errors.samples"
              name="monitoring__watch__retry-series"
              size="small"
              :loading="store.samplesLoading"
              :disabled="store.samplesLoading"
              @click="store.retrySamples()"
              >{{ t('trench.monitoring.actions.retry') }}</a-button
            >
            <a-button
              v-else-if="store.samplesCursor"
              name="monitoring__watch__load-older"
              size="small"
              :loading="store.samplesLoading"
              :disabled="store.samplesLoading"
              @click="store.loadOlderSamples()"
              >{{ t('trench.monitoring.actions.loadOlder') }}</a-button
            >
            <span v-else-if="store.samples.length">{{ t('trench.monitoring.detector.end') }}</span>
            <span>{{
              t('trench.monitoring.detector.loaded', { count: store.samples.length })
            }}</span>
            <span>{{ t('trench.monitoring.detector.retained') }}</span>
          </div>
          <p class="monitoring-panel__disclaimer">
            {{ t('trench.monitoring.detector.disclaimer') }}
          </p>
        </section>

        <section name="monitoring__watch__regional-truth" class="monitoring-panel">
          <header class="monitoring-panel__header">
            <div>
              <h2>{{ t('trench.monitoring.evidence.regionalTruth') }}</h2>
              <p>{{ t('trench.monitoring.evidence.runtimeEvidenceBoundary') }}</p>
            </div>
          </header>
          <div class="monitoring-region-rail">
            <article
              v-for="region in display.regions"
              :key="region.region"
              name="monitoring__watch__region"
              class="monitoring-region-rail__card"
            >
              <span
                >{{ region.region.toUpperCase() }} ·
                {{ t('trench.monitoring.evidence.currentRuntime') }}</span
              >
              <strong>{{ runtimeStateLabel(region.runtimeObservedState) }}</strong>
              <small>{{
                region.runtimeLagBlocks === null
                  ? t('trench.monitoring.evidence.noCursor')
                  : t('trench.monitoring.evidence.lag', { count: region.runtimeLagBlocks })
              }}</small>
              <small>{{
                region.runtimeBlockNumber === null || region.runtimeSlot === null
                  ? t('trench.monitoring.evidence.noCursorPosition')
                  : t('trench.monitoring.evidence.cursorPosition', {
                      block: region.runtimeBlockNumber,
                      slot: region.runtimeSlot
                    })
              }}</small>
              <small>{{
                region.runtimeHeartbeat
                  ? t('trench.monitoring.evidence.heartbeat', {
                      time: utcInstant(region.runtimeHeartbeat)
                    })
                  : t('trench.monitoring.evidence.noHeartbeat')
              }}</small>
              <small>{{
                region.runtimeLastErrorCode
                  ? t('trench.monitoring.evidence.lastError', {
                      code: region.runtimeLastErrorCode
                    })
                  : t('trench.monitoring.evidence.noLastError')
              }}</small>
              <span>{{
                t('trench.monitoring.evidence.selectedRevision', {
                  revision: store.samplesRevision ?? '—'
                })
              }}</span>
              <strong>{{
                region.evidenceState
                  ? stateLabel(region.evidenceState)
                  : t('trench.monitoring.watches.unknown')
              }}</strong>
              <code>{{
                region.evidenceFingerprint
                  ? `${region.evidenceFingerprint.slice(0, 10)}…${region.evidenceFingerprint.slice(-8)}`
                  : t('trench.monitoring.evidence.noSelectedEvidence')
              }}</code>
            </article>
            <div
              class="monitoring-region-rail__link"
              :class="{
                'monitoring-region-rail__link--matched':
                  display.currentSample?.agreement === 'MATCHED'
              }"
              aria-hidden="true"
            />
          </div>
        </section>

        <section
          v-if="store.sampleViewState.showRows || store.sampleViewState.showEmpty"
          name="monitoring__watch__evidence"
          class="monitoring-panel monitoring-panel--table"
        >
          <header class="monitoring-panel__header">
            <div>
              <h2>{{ t('trench.monitoring.evidence.title') }}</h2>
              <p>{{ t('trench.monitoring.detector.loaded', { count: store.samples.length }) }}</p>
            </div>
          </header>
          <div class="monitoring-evidence-table__region">
            <table
              v-if="store.sampleViewState.showRows"
              name="monitoring__watch__evidence-table"
              class="monitoring-evidence-table"
            >
              <thead>
                <tr>
                  <th>{{ t('trench.monitoring.evidence.bucket') }}</th>
                  <th>{{ t('trench.monitoring.evidence.count') }}</th>
                  <th>{{ t('trench.monitoring.evidence.state') }}</th>
                  <th>{{ t('trench.monitoring.evidence.z') }}</th>
                  <th>{{ t('trench.monitoring.evidence.blocks') }}</th>
                  <th>{{ t('trench.monitoring.evidence.details') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in store.sampleDisplays"
                  :key="item.sample.bucket_sequence"
                  name="monitoring__watch__evidence-row"
                >
                  <td :data-label="t('trench.monitoring.evidence.bucket')">
                    <code>{{ utcRange(item.sample.bucket_start, item.sample.bucket_end) }}</code>
                  </td>
                  <td :data-label="t('trench.monitoring.evidence.count')">
                    {{
                      item.evidence.verifiedZero
                        ? t('trench.monitoring.watches.verifiedZero')
                        : (item.evidence.count ?? t('trench.monitoring.watches.unknown'))
                    }}
                  </td>
                  <td :data-label="t('trench.monitoring.evidence.state')">
                    <strong :class="`monitoring-tone--${tone(item.sample.state)}`">{{
                      stateLabel(item.sample.state)
                    }}</strong>
                    <small>{{ item.sample.reason_code }}</small>
                  </td>
                  <td :data-label="t('trench.monitoring.evidence.z')">
                    <code>{{
                      item.aggregateZ ??
                      (item.evidence.unconfirmed ? t('trench.monitoring.watches.unknown') : '—')
                    }}</code>
                  </td>
                  <td :data-label="t('trench.monitoring.evidence.blocks')">
                    <code>{{ item.blockRange ?? '—' }}</code>
                  </td>
                  <td :data-label="t('trench.monitoring.evidence.details')">
                    <a-button
                      name="monitoring__watch__open-evidence-detail"
                      :aria-label="
                        t('trench.monitoring.evidence.openDetailsFor', {
                          bucket: utcRange(item.sample.bucket_start, item.sample.bucket_end)
                        })
                      "
                      size="mini"
                      @click="openEvidence(item, $event)"
                    >
                      {{ t('trench.monitoring.evidence.openDetails') }}
                    </a-button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div
              v-else-if="store.sampleViewState.showEmpty"
              class="monitoring-evidence-table__empty"
            >
              {{ t('trench.monitoring.detail.noEvidence') }}
            </div>
          </div>
        </section>
        <p class="monitoring-watch-detail__reset-note">
          {{ t('trench.monitoring.detail.startReset') }}
        </p>
      </div>
      <MonitoringSampleDrawer
        :display="selectedEvidence"
        @close="selectedEvidence = null"
        @closed="restoreEvidenceFocus"
      />
    </template>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  MonitoringProjectedState,
  MonitoringSampleProjection
} from '@shared/monitoring/monitoringBridge.type';
import MonitoringChart from './MonitoringChart.vue';
import MonitoringSampleDrawer from './MonitoringSampleDrawer.vue';
import { monitoringStore as store } from '../../views/monitoring/monitoring.runtime';
import {
  monitoringStateTone,
  type MonitoringSampleDisplay,
  monitoringUtcInstant,
  monitoringUtcRange
} from '../../views/monitoring/monitoringPresentation.service';

const { t } = useI18n();
const detail = computed(() => store.selectedDetail);
const display = computed(() => store.watchDisplay);
const selectedWatchLabel = computed(
  () =>
    store.selectedWatch?.name ?? store.selectedConfigId ?? t('trench.monitoring.watches.unknown')
);
const agreementLabel = (agreement: MonitoringSampleProjection['agreement']): string =>
  t(`trench.monitoring.agreements.${agreement}`);
const countLabel = computed(() => {
  if (display.value.evidence.verifiedZero) return t('trench.monitoring.watches.verifiedZero');
  if (display.value.evidence.count === null) return t('trench.monitoring.watches.unknown');
  return t('trench.monitoring.detail.transferEvents', { count: display.value.evidence.count });
});
const tone = monitoringStateTone;
const utcRange = monitoringUtcRange;
const utcInstant = (value: string): string => monitoringUtcInstant(value) ?? '—';
const stateLabel = (state: MonitoringProjectedState): string =>
  t(`trench.monitoring.states.${state}`);
const runtimeStateLabel = (state: string): string => t(`trench.monitoring.runtimeStates.${state}`);
const errorText = (code: string): string => t('trench.monitoring.errors.generic', { code });
const selectedEvidence = ref<MonitoringSampleDisplay | null>(null);
let evidenceInvoker: HTMLElement | null = null;
const openEvidence = (display: MonitoringSampleDisplay, event: Event): void => {
  evidenceInvoker = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  selectedEvidence.value = display;
};
const restoreEvidenceFocus = (): void => {
  evidenceInvoker?.focus();
  evidenceInvoker = null;
};
const retryDetail = (): void => {
  if (store.selectedConfigId) void store.selectWatch(store.selectedConfigId, false);
};
</script>
