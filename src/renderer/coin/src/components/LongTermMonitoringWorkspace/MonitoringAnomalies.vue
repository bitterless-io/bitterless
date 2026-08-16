<template>
  <section name="monitoring__anomalies" class="monitoring-anomalies">
    <div name="monitoring__anomaly__filters" class="monitoring-anomalies__filters">
      <a-select
        name="monitoring__anomaly__config-id"
        size="small"
        :model-value="store.anomalyConfigId || undefined"
        :placeholder="t('trench.monitoring.anomalies.allWatches')"
        :aria-label="t('trench.monitoring.anomalies.watchFilterLabel')"
        allow-clear
        @change="changeConfig(String($event ?? ''))"
        @clear="changeConfig('')"
      >
        <a-option
          v-for="watch in store.anomalyWatchOptions"
          :key="watch.config_id"
          :value="watch.config_id"
        >
          {{ watch.name }} · {{ shortAddress(watch.token_address) }}
        </a-option>
      </a-select>
      <a-select
        name="monitoring__anomaly__states"
        size="small"
        multiple
        allow-clear
        :model-value="store.anomalyStates"
        :placeholder="t('trench.monitoring.anomalies.allExceptions')"
        :aria-label="t('trench.monitoring.anomalies.stateFilterLabel')"
        @change="changeStates($event)"
        @clear="changeStates([])"
      >
        <a-option v-for="state in states" :key="state" :value="state">{{
          stateLabel(state)
        }}</a-option>
      </a-select>
      <a-button
        name="monitoring__anomaly__retry"
        size="small"
        :loading="store.anomalyLoading || store.anomalyOptionsLoading"
        :disabled="store.anomalyLoading || store.anomalyOptionsLoading"
        @click="store.initializeAnomalies()"
        >{{ t('trench.monitoring.actions.retry') }}</a-button
      >
    </div>

    <div v-if="store.errors.anomalyOptions" class="monitoring-anomalies__error" role="alert">
      {{
        t('trench.monitoring.anomalies.optionsUnavailable', { code: store.errors.anomalyOptions })
      }}
    </div>
    <div v-if="store.errors.anomalies" class="monitoring-anomalies__error" role="alert">
      {{ errorText(store.errors.anomalies) }}
      <span v-if="store.anomalies.length && store.anomaliesStaleSince">
        ·
        {{
          t('trench.monitoring.watches.stale', {
            time: utcInstant(store.anomaliesStaleSince)
          })
        }}
      </span>
    </div>
    <div name="monitoring__anomaly__list" class="monitoring-anomalies__list">
      <table v-if="store.anomalyViewState.showRows" class="monitoring-anomalies__table">
        <thead>
          <tr>
            <th>{{ t('trench.monitoring.evidence.bucket') }}</th>
            <th>{{ t('trench.monitoring.anomalies.watch') }}</th>
            <th>{{ t('trench.monitoring.anomalies.evidence') }}</th>
            <th>{{ t('trench.monitoring.evidence.z') }}</th>
            <th>{{ t('trench.monitoring.evidence.state') }}</th>
            <th>{{ t('trench.monitoring.evidence.regions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in store.anomalyDisplays"
            :key="`${item.sample.config_id}:${item.sample.config_revision}:${item.sample.bucket_sequence}`"
            name="monitoring__anomaly__row"
            :aria-selected="store.selectedAnomaly === item.sample"
          >
            <td :data-label="t('trench.monitoring.evidence.bucket')">
              <button
                name="monitoring__anomaly__open-detail"
                class="monitoring-anomalies__row-trigger"
                type="button"
                @click="openDrawer(item.sample, $event)"
              >
                {{ utcRange(item.sample.bucket_start, item.sample.bucket_end) }}
              </button>
            </td>
            <td :data-label="t('trench.monitoring.anomalies.watch')">
              <strong>{{ item.sample.name }}</strong
              ><code>{{ shortAddress(item.sample.asset_key) }}</code>
            </td>
            <td :data-label="t('trench.monitoring.anomalies.evidence')">
              {{
                item.evidence.verifiedZero
                  ? t('trench.monitoring.watches.verifiedZero')
                  : item.evidence.count === null
                    ? t('trench.monitoring.watches.unknown')
                    : t('trench.monitoring.detail.transferEvents', { count: item.evidence.count })
              }}
            </td>
            <td :data-label="t('trench.monitoring.evidence.z')">
              <code>{{
                item.aggregateZ ??
                (item.evidence.unconfirmed ? t('trench.monitoring.watches.unknown') : '—')
              }}</code>
            </td>
            <td :data-label="t('trench.monitoring.evidence.state')">
              <strong :class="`monitoring-tone--${tone(item.sample.state)}`">{{
                stateLabel(item.sample.state)
              }}</strong>
              <small>{{ item.sample.reason_code }}</small>
            </td>
            <td :data-label="t('trench.monitoring.evidence.regions')">
              {{ agreementLabel(item.sample.agreement) }} ·
              {{ t(`trench.monitoring.evidence.${item.evidence.confirmation}`) }}
            </td>
          </tr>
        </tbody>
      </table>
      <div
        v-else-if="store.anomalyViewState.mode === 'loading'"
        class="monitoring-anomalies__empty"
        aria-live="polite"
      >
        <a-spin size="small" />
        {{ t('trench.monitoring.anomalies.loading') }}
      </div>
      <div v-else-if="store.anomalyViewState.showEmpty" class="monitoring-anomalies__empty">
        {{ t('trench.monitoring.anomalies.empty') }}
      </div>
    </div>
    <footer v-if="store.anomalyViewState.showRows" class="monitoring-anomalies__cursor">
      <a-button
        v-if="store.anomalyFailedCursor"
        name="monitoring__anomaly__retry-older"
        size="small"
        :loading="store.anomalyLoading"
        :disabled="store.anomalyLoading"
        @click="store.retryAnomalies()"
        >{{ t('trench.monitoring.actions.retry') }}</a-button
      >
      <a-button
        v-else-if="store.anomalyCursor"
        name="monitoring__anomaly__load-older"
        size="small"
        :loading="store.anomalyLoading"
        @click="store.loadOlderAnomalies()"
        >{{ t('trench.monitoring.actions.loadOlder') }}</a-button
      >
      <span v-else-if="store.anomalies.length">{{ t('trench.monitoring.anomalies.end') }}</span>
    </footer>

    <a-drawer
      :visible="!!store.selectedAnomaly"
      name="monitoring__anomaly__drawer"
      :title="t('trench.monitoring.anomalies.details')"
      :width="'min(430px, 100%)'"
      :footer="false"
      :closable="false"
      popup-container=".monitoring-workspace"
      @cancel="closeDrawer"
      @close="restoreDrawerFocus"
    >
      <template #title>
        <div class="monitoring-drawer-title">
          <span>{{ t('trench.monitoring.anomalies.details') }}</span>
          <a-button
            name="monitoring__anomaly__close-drawer"
            type="text"
            size="mini"
            :aria-label="t('trench.monitoring.actions.close')"
            @click="closeDrawer"
          >
            <IconX :size="16" aria-hidden="true" />
          </a-button>
        </div>
      </template>
      <template v-if="selectedDisplay">
        <div
          v-if="selectedDisplay.sample.agreement !== 'MATCHED'"
          class="monitoring-anomalies__warning"
          role="alert"
        >
          {{ t('trench.monitoring.anomalies.mismatchWarning') }}
        </div>
        <dl class="monitoring-anomalies__drawer-facts">
          <div>
            <dt>{{ t('trench.monitoring.anomalies.configRevision') }}</dt>
            <dd>
              {{ selectedDisplay.sample.config_id }} / r{{ selectedDisplay.sample.config_revision }}
            </dd>
          </div>
          <div>
            <dt>{{ t('trench.monitoring.anomalies.asset') }}</dt>
            <dd>{{ selectedDisplay.sample.asset_key }}</dd>
          </div>
          <div>
            <dt>{{ t('trench.monitoring.evidence.bucket') }}</dt>
            <dd>
              {{ utcRange(selectedDisplay.sample.bucket_start, selectedDisplay.sample.bucket_end) }}
            </dd>
          </div>
          <div>
            <dt>{{ t('trench.monitoring.anomalies.blockRange') }}</dt>
            <dd>{{ selectedDisplay.blockRange ?? '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('trench.monitoring.anomalies.aggregateCount') }}</dt>
            <dd>{{ selectedDisplay.evidence.count ?? t('trench.monitoring.watches.unknown') }}</dd>
          </div>
          <div>
            <dt>{{ t('trench.monitoring.anomalies.aggregateZ') }}</dt>
            <dd>
              {{
                selectedDisplay.aggregateZ ??
                (selectedDisplay.evidence.unconfirmed
                  ? t('trench.monitoring.watches.unknown')
                  : '—')
              }}
            </dd>
          </div>
          <div>
            <dt>{{ t('trench.monitoring.anomalies.baselineCount') }}</dt>
            <dd>
              {{
                selectedDisplay.baselineCount ??
                (selectedDisplay.evidence.unconfirmed
                  ? t('trench.monitoring.watches.unknown')
                  : '—')
              }}
            </dd>
          </div>
          <div>
            <dt>{{ t('trench.monitoring.anomalies.baselineMean') }}</dt>
            <dd>{{ selectedDisplay.baselineMean ?? t('trench.monitoring.watches.unknown') }}</dd>
          </div>
          <div>
            <dt>{{ t('trench.monitoring.anomalies.baselineStddev') }}</dt>
            <dd>{{ selectedDisplay.baselineStddev ?? t('trench.monitoring.watches.unknown') }}</dd>
          </div>
          <div>
            <dt>{{ t('trench.monitoring.anomalies.state') }}</dt>
            <dd>
              {{ stateLabel(selectedDisplay.sample.state) }} ·
              {{ selectedDisplay.sample.reason_code }}
            </dd>
          </div>
          <div>
            <dt>{{ t('trench.monitoring.evidence.agreement') }}</dt>
            <dd>
              {{ agreementLabel(selectedDisplay.sample.agreement) }} ·
              {{ t(`trench.monitoring.evidence.${selectedDisplay.evidence.confirmation}`) }}
            </dd>
          </div>
          <div>
            <dt>{{ t('trench.monitoring.anomalies.threshold') }}</dt>
            <dd>±{{ selectedDisplay.sample.zscore_threshold.toFixed(2) }}</dd>
          </div>
          <div>
            <dt>{{ t('trench.monitoring.anomalies.componentRelease') }}</dt>
            <dd>
              {{ selectedDisplay.releaseIdentity.componentId }}@{{
                selectedDisplay.releaseIdentity.componentVersion
              }}
            </dd>
          </div>
          <div>
            <dt>{{ t('trench.monitoring.anomalies.schemaHash') }}</dt>
            <dd>{{ selectedDisplay.releaseIdentity.schemaHash }}</dd>
          </div>
          <div>
            <dt>{{ t('trench.monitoring.anomalies.metricDetector') }}</dt>
            <dd>
              {{ selectedDisplay.releaseIdentity.metricKind }} ·
              {{ selectedDisplay.releaseIdentity.detectorVersion }}
            </dd>
          </div>
          <div
            v-for="region in selectedDisplay.regionDiagnostics"
            :key="region.region"
            name="monitoring__anomaly__evidence-region"
          >
            <dt>
              {{
                t('trench.monitoring.anomalies.regionalDiagnostic', {
                  region: region.region.toUpperCase()
                })
              }}
            </dt>
            <dd>
              {{ stateLabel(region.state) }}<br />
              {{ t('trench.monitoring.anomalies.regionalCount') }}: {{ region.count ?? '—' }} ·
              {{ t('trench.monitoring.anomalies.regionalZ') }}: {{ region.zScore ?? '—' }}<br />
              {{ t('trench.monitoring.anomalies.regionalBaseline') }}: {{ region.baselineCount }} /
              {{ region.baselineMean ?? '—' }} / {{ region.baselineStddev ?? '—' }}<br />
              {{ t('trench.monitoring.anomalies.regionalBlocks') }}: {{ region.blockRange }} ·
              {{ t('trench.monitoring.anomalies.regionalCompleteness') }}: {{ region.completeness
              }}<br />
              {{ t('trench.monitoring.anomalies.regionalReason') }}: {{ region.reason }}<br />
              {{ t('trench.monitoring.anomalies.regionalEndHash') }}: {{ region.endHash ?? '—'
              }}<br />
              {{ t('trench.monitoring.anomalies.regionalFingerprint') }}:
              {{ region.fingerprint }}
            </dd>
          </div>
        </dl>
      </template>
    </a-drawer>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconX } from '@tabler/icons-vue';
import type {
  MonitoringAnomalyFilterState,
  MonitoringProjectedState,
  MonitoringSampleProjection
} from '@shared/monitoring/monitoringBridge.type';
import { monitoringStore as store } from '../../views/monitoring/monitoring.runtime';
import {
  monitoringStateTone,
  monitoringUtcInstant,
  monitoringUtcRange,
  shortMonitoringAddress
} from '../../views/monitoring/monitoringPresentation.service';

const { t } = useI18n();
const states: MonitoringAnomalyFilterState[] = [
  'WARMING',
  'BASELINE_FLAT',
  'HIGH',
  'LOW',
  'INCOMPLETE_RANGE',
  'REGION_MISMATCH',
  'SINGLE_REGION'
];
const selectedDisplay = computed(() => store.selectedAnomalyDisplay);
const shortAddress = shortMonitoringAddress;
const utcRange = monitoringUtcRange;
const utcInstant = (value: string | null): string => monitoringUtcInstant(value) ?? '—';
const tone = monitoringStateTone;
const stateLabel = (state: MonitoringProjectedState): string =>
  t(`trench.monitoring.states.${state}`);
const agreementLabel = (agreement: MonitoringSampleProjection['agreement']): string =>
  t(`trench.monitoring.agreements.${agreement}`);
const errorText = (code: string): string => t('trench.monitoring.errors.generic', { code });
const changeConfig = (configId: string): void => {
  void store.setAnomalyFilter(configId, store.anomalyStates);
};
const changeStates = (value: unknown): void => {
  const selectedStates = Array.isArray(value)
    ? value
        .map(String)
        .filter((state): state is MonitoringAnomalyFilterState =>
          states.includes(state as MonitoringAnomalyFilterState)
        )
    : [];
  void store.setAnomalyFilter(store.anomalyConfigId, selectedStates);
};
let drawerInvoker: HTMLElement | null = null;
const openDrawer = (row: MonitoringSampleProjection, event: Event): void => {
  drawerInvoker = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  store.selectAnomaly(row);
};
const closeDrawer = (): void => {
  store.selectAnomaly(null);
};
const restoreDrawerFocus = (): void => {
  drawerInvoker?.focus();
  drawerInvoker = null;
};
</script>
