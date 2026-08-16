<template>
  <div v-if="runs.length" name="trench__sniping__run-list" class="sniping-run-list">
    <article
      v-for="run in displayRuns"
      :key="run.requestId"
      name="trench__sniping__run-row"
      class="sniping-run-list__row"
      :class="{ 'sniping-run-list__row--stale': !run.currentEvidence }"
    >
      <header>
        <div>
          <strong>{{ run.kind === 'exact' ? t('trench.sniping.exact.result') : t('trench.sniping.shadow.result') }}</strong>
          <code>{{ run.requestId }}</code>
          <small>
            {{ t('trench.sniping.simulation.simulated') }} ·
            r{{ run.configRevision }} · {{ run.currentEvidence
              ? t('trench.sniping.simulation.currentEvidence')
              : t('trench.sniping.simulation.historicalEvidence') }}
          </small>
        </div>
        <span class="sniping-run-list__state" :class="`sniping-run-list__state--${run.state}`">
          {{ run.state }}
        </span>
      </header>
      <div v-if="run.latestAttempt" class="sniping-run-list__evidence">
        <span>{{ run.latestAttempt.outcome || '—' }}</span>
        <code>{{ run.latestAttempt.reason_code }}</code>
        <span>{{ t('trench.sniping.simulation.expires') }} {{ run.evidenceExpired
          ? t('trench.sniping.simulation.expired')
          : run.evidenceExpiresAt ?? '—' }}</span>
      </div>
      <dl v-if="run.report" class="sniping-run-list__report">
        <div><dt>{{ t('trench.sniping.simulation.reason') }}</dt><dd>{{ run.report.reasonCode }}</dd></div>
        <div><dt>{{ t('trench.sniping.simulation.expected') }}</dt><dd>{{ run.report.expectedOutputAtomic }}</dd></div>
        <div><dt>{{ t('trench.sniping.simulation.minimum') }}</dt><dd>{{ run.report.minimumOutputAtomic }}</dd></div>
        <div><dt>{{ t('trench.sniping.simulation.gas') }}</dt><dd>{{ run.report.estimatedGas }}</dd></div>
        <div v-for="field in run.report.detailFields" :key="field.key">
          <dt>{{ t(`trench.sniping.simulation.${field.key}`) }}</dt><dd :title="field.value">{{ field.value }}</dd>
        </div>
        <div v-if="run.shadowPolicySummary"><dt>{{ t('trench.sniping.simulation.policy') }}</dt>
          <dd>{{ run.shadowPolicySummary }}</dd></div>
      </dl>
      <div v-if="kind === 'shadow' && run.hasPositionsProjection" class="sniping-run-list__positions">
        <strong>{{ run.hasReportedEvidence
          ? t('trench.sniping.shadow.positions', { count: run.positionCount })
          : t('trench.sniping.evidence.positionUnknown') }}</strong>
        <span>{{ run.outcomeSummary }}</span>
        <dl v-for="position in run.positions" :key="position.canonicalEventKey" class="sniping-run-list__position">
          <div><dt>{{ t('trench.sniping.simulation.evidenceClass') }}</dt><dd>{{ t('trench.sniping.simulation.simulated') }}</dd></div>
          <div><dt>{{ t('trench.sniping.simulation.eventBlock') }}</dt><dd>{{ position.blockNumber }}</dd></div>
          <div><dt>{{ t('trench.sniping.activity.outcome') }}</dt><dd>{{ position.outcome }} · {{ position.reasonCode }}</dd></div>
          <div><dt>{{ t('trench.sniping.simulation.gross') }}</dt><dd>{{ position.virtualGrossAtomic }}</dd></div>
          <div><dt>{{ t('trench.sniping.simulation.net') }}</dt><dd>{{ position.virtualNetAtomic }}</dd></div>
          <div><dt>{{ t('trench.sniping.simulation.latency') }}</dt><dd>{{ position.observationToActionMs }}</dd></div>
          <div><dt>{{ t('trench.sniping.simulation.checkpoints') }}</dt><dd>{{ position.checkpointSummary }}</dd></div>
        </dl>
      </div>
    </article>
  </div>
  <div v-else class="sniping-simulation__empty">{{ t('trench.sniping.simulation.noRuns') }}</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SnipingSimulationRequestProjection } from '@shared/sniping/snipingBridge.type';
import { buildSnipingSimulationRunDisplay } from '../../views/sniping/snipingReport.service';

const props = defineProps<{
  runs: SnipingSimulationRequestProjection[];
  kind: 'exact' | 'shadow';
  currentRevision: number;
}>();
const { t } = useI18n();
const displayRuns = computed(() => props.runs.map((run) =>
  buildSnipingSimulationRunDisplay(run, props.currentRevision)));
</script>
