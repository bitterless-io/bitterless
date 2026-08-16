<template>
  <a-drawer
    :visible="!!display"
    name="monitoring__watch__evidence-drawer"
    :title="t('trench.monitoring.evidence.details')"
    :width="'min(430px, 100%)'"
    :footer="false"
    :closable="false"
    popup-container=".monitoring-workspace"
    @cancel="$emit('close')"
    @close="$emit('closed')"
  >
    <template #title>
      <div class="monitoring-drawer-title">
        <span>{{ t('trench.monitoring.evidence.details') }}</span>
        <a-button
          name="monitoring__watch__close-evidence"
          type="text"
          size="mini"
          :aria-label="t('trench.monitoring.actions.close')"
          @click="$emit('close')"
        >
          <IconX :size="16" aria-hidden="true" />
        </a-button>
      </div>
    </template>
    <dl v-if="display" class="monitoring-anomalies__drawer-facts">
      <div>
        <dt>{{ t('trench.monitoring.anomalies.configRevision') }}</dt>
        <dd>{{ display.sample.config_id }} / r{{ display.sample.config_revision }}</dd>
      </div>
      <div>
        <dt>{{ t('trench.monitoring.anomalies.asset') }}</dt>
        <dd>{{ display.sample.asset_key }}</dd>
      </div>
      <div>
        <dt>{{ t('trench.monitoring.evidence.bucket') }}</dt>
        <dd>{{ utcRange(display.sample.bucket_start, display.sample.bucket_end) }}</dd>
      </div>
      <div>
        <dt>{{ t('trench.monitoring.anomalies.blockRange') }}</dt>
        <dd>{{ display.blockRange ?? unknown }}</dd>
      </div>
      <div>
        <dt>{{ t('trench.monitoring.evidence.endHash') }}</dt>
        <dd>{{ display.sample.end_block_hash ?? unknown }}</dd>
      </div>
      <div>
        <dt>{{ t('trench.monitoring.evidence.releaseIdentity') }}</dt>
        <dd>
          {{ display.releaseIdentity.componentId }}@{{ display.releaseIdentity.componentVersion }} ·
          {{ display.releaseIdentity.metricKind }} · {{ display.releaseIdentity.detectorVersion }} ·
          {{ display.releaseIdentity.schemaHash }}
        </dd>
      </div>
      <div>
        <dt>{{ t('trench.monitoring.anomalies.threshold') }}</dt>
        <dd>±{{ display.sample.zscore_threshold.toFixed(2) }}</dd>
      </div>
      <div>
        <dt>{{ t('trench.monitoring.evidence.agreement') }}</dt>
        <dd>
          {{ agreementLabel(display.sample.agreement) }} ·
          {{ t(`trench.monitoring.evidence.${display.evidence.confirmation}`) }}
        </dd>
      </div>
      <div>
        <dt>{{ t('trench.monitoring.evidence.aggregate') }}</dt>
        <dd>
          {{ display.evidence.count ?? unknown }} / {{ display.baselineCount ?? unknown }} /
          {{ display.baselineMean ?? unknown }} / {{ display.baselineStddev ?? unknown }} / Z
          {{ display.aggregateZ ?? unknown }} · {{ display.sample.reason_code }}
        </dd>
      </div>
      <div
        v-for="region in display.regionDiagnostics"
        :key="region.region"
        name="monitoring__watch__evidence-region"
      >
        <dt>
          {{ region.region.toUpperCase() }} · {{ t('trench.monitoring.evidence.fingerprint') }}
        </dt>
        <dd>
          {{ stateLabel(region.state) }} · {{ t('trench.monitoring.anomalies.regionalCount') }}:
          {{ region.count ?? unknown }} · {{ t('trench.monitoring.anomalies.regionalZ') }}:
          {{ region.zScore ?? unknown }}<br />
          {{ t('trench.monitoring.anomalies.regionalBaseline') }}: {{ region.baselineCount }} /
          {{ region.baselineMean ?? unknown }} / {{ region.baselineStddev ?? unknown }}<br />
          {{ t('trench.monitoring.anomalies.regionalBlocks') }}: {{ region.blockRange }} ·
          {{ t('trench.monitoring.anomalies.regionalCompleteness') }}: {{ region.completeness
          }}<br />
          {{ t('trench.monitoring.anomalies.regionalEndHash') }}: {{ region.endHash ?? unknown }} ·
          {{ t('trench.monitoring.anomalies.regionalReason') }}: {{ region.reason }}<br />
          {{ region.fingerprint }}
        </dd>
      </div>
    </dl>
  </a-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconX } from '@tabler/icons-vue';
import type {
  MonitoringAgreement,
  MonitoringProjectedState
} from '@shared/monitoring/monitoringBridge.type';
import type { MonitoringSampleDisplay } from '../../views/monitoring/monitoringPresentation.service';
import { monitoringUtcRange } from '../../views/monitoring/monitoringPresentation.service';

defineProps<{ display: MonitoringSampleDisplay | null }>();
defineEmits<{ close: []; closed: [] }>();
const { t } = useI18n();
const utcRange = monitoringUtcRange;
const unknown = computed(() => t('trench.monitoring.watches.unknown'));
const agreementLabel = (agreement: MonitoringAgreement): string =>
  t(`trench.monitoring.agreements.${agreement}`);
const stateLabel = (state: MonitoringProjectedState): string =>
  t(`trench.monitoring.states.${state}`);
</script>
