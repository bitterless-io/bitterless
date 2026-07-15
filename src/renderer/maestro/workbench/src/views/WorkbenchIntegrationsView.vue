<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Button, Empty, InputNumber, Message, Switch as ArcoSwitch } from '@arco-design/web-vue'
import { IconChecklist, IconClock, IconDatabase, IconPlayerPlay, IconRefresh, IconTransfer, IconTrash, IconWand } from '@tabler/icons-vue'
import type { IntegrationEndpointContract, IntegrationRunSummary, IntegrationTargetSummary } from '@maestro-shared/coach.api'
import { workbenchStore as store } from '../workbench.store'
import './WorkbenchIntegrationsView.less'

const targets = computed(() => store.integrationTargets)
const detail = computed(() => store.integrationTargetDetail)
const subtitle = computed(() => `${targets.value.length} target${targets.value.length === 1 ? '' : 's'}`)
const mappingSummary = computed(() => store.integrationMappingSummary)
const mappingRows = computed(() => store.integrationMappings)
const scheduleIntervalMinutes = ref(60)
const applyAllowUpdates = ref(false)

watch(
  detail,
  (target) => {
    scheduleIntervalMinutes.value = target?.schedule.intervalMinutes || 60
  },
  { immediate: true }
)

const formatTime = (ts: number): string => {
  if (!ts) return '-'
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const endpointTone = (endpoint: IntegrationEndpointContract): string => {
  if (endpoint.role === 'write') return 'workbench-integrations__badge--write'
  if (endpoint.role === 'read') return 'workbench-integrations__badge--read'
  return 'workbench-integrations__badge--neutral'
}

const statusTone = (target: IntegrationTargetSummary): string => {
  if (target.status === 'dry-run-ok') return 'workbench-integrations__badge--success'
  if (target.status === 'error') return 'workbench-integrations__badge--error'
  return 'workbench-integrations__badge--info'
}

const runTone = (run?: IntegrationRunSummary): string => {
  if (!run) return 'workbench-integrations__run-status--idle'
  if (run.status === 'success') return 'workbench-integrations__run-status--success'
  if (run.status === 'failed') return 'workbench-integrations__run-status--failed'
  return 'workbench-integrations__run-status--pending'
}

const runLabel = (run?: IntegrationRunSummary): string => {
  if (!run) return 'no run'
  return `${run.mode} · ${run.status} · ${run.endpointCount} endpoints`
}

const scheduleKindLabel = (kind?: string): string => {
  if (kind === 'migration-dry-run') return 'migration dry-run'
  if (kind === 'report-readiness') return 'readiness'
  if (kind === 'recorded-site-dry-run') return 'source dry-run'
  return 'safe'
}

const targetScheduleKind = (): 'migration-dry-run' | 'recorded-site-dry-run' =>
  detail.value?.source.kind === 'ai-crms-migration' ? 'migration-dry-run' : 'recorded-site-dry-run'

const mappingEntityRows = computed(() =>
  Object.entries(mappingSummary.value?.byEntity || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([entity, count]) => ({ entity, count }))
)

const mappingStatusRows = computed(() =>
  Object.entries(mappingSummary.value?.byStatus || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([status, count]) => ({ status, count }))
)

const createFromCapture = async (): Promise<void> => {
  const result = await store.createIntegrationTargetFromCapture()
  if (result.ok) Message.success(result.message)
  else Message.error(result.message || 'Could not create integration target')
}

const runDryRun = async (target: IntegrationTargetSummary): Promise<void> => {
  const result = await store.runIntegrationTargetDryRun(target.id)
  if (result.ok) Message.success(result.message)
  else Message.error(result.message || 'Dry-run failed')
}

const runRecordedSiteDryRun = async (target: IntegrationTargetSummary): Promise<void> => {
  const result = await store.runIntegrationRecordedSiteDryRun(target.id)
  if (result.ok) Message.success(result.message)
  else Message.error(result.message || 'Source dry-run failed')
}

const runRecordedSitePlan = async (target: IntegrationTargetSummary): Promise<void> => {
  const result = await store.runIntegrationRecordedSitePlan(target.id)
  if (result.ok) Message.success(result.message)
  else Message.error(result.message || 'Source plan failed')
}

const runRecordedSiteApply = async (target: IntegrationTargetSummary): Promise<void> => {
  const result = await store.runIntegrationRecordedSiteApply(target.id, applyAllowUpdates.value)
  if (result.ok) Message.success(result.message)
  else Message.error(result.message || 'Source apply failed')
}

const runMigrationDryRun = async (target: IntegrationTargetSummary): Promise<void> => {
  const result = await store.runIntegrationMigrationDryRun(target.id)
  if (result.ok) Message.success(result.message)
  else Message.error(result.message || 'Migration dry-run failed')
}

const runReadiness = async (target: IntegrationTargetSummary): Promise<void> => {
  const result = await store.runIntegrationReportReadiness(target.id)
  if (result.ok) Message.success(result.message)
  else Message.error(result.message || 'Readiness check failed')
}

const setSchedule = async (enabled: boolean): Promise<void> => {
  if (!detail.value) return
  const result = await store.setIntegrationTargetSchedule(detail.value.id, {
    enabled,
    intervalMinutes: scheduleIntervalMinutes.value,
    runKind: targetScheduleKind()
  })
  if (result.ok) Message.success(result.message)
  else Message.error(result.message || 'Schedule update failed')
}

const deleteTarget = async (target: IntegrationTargetSummary): Promise<void> => {
  const result = await store.deleteIntegrationTarget(target.id)
  if (result.ok) Message.success(result.message)
  else Message.error(result.message || 'Could not delete integration target')
}

onMounted(() => {
  void store.refreshIntegrationTargets()
})
</script>

<template>
  <section name="integrations" class="workbench-integrations">
    <div name="integrations__toolbar" class="workbench-integrations__toolbar">
      <div name="integrations__title" class="workbench-integrations__title">
        <span class="workbench-integrations__title__icon">
          <IconDatabase :size="17" stroke="1.8" />
        </span>
        <div class="workbench-integrations__title__body">
          <div class="workbench-integrations__title__heading">Integration Targets</div>
          <div class="workbench-integrations__title__subtitle">{{ subtitle }}</div>
        </div>
      </div>

      <div name="integrations__actions" class="workbench-integrations__actions">
        <Button name="integrations__create" size="small" type="primary" :loading="store.integrationCreating" @click="createFromCapture">
          <template #icon><IconWand :size="15" /></template>
          From Capture
        </Button>
        <Button name="integrations__refresh" size="small" :loading="store.integrationLoading" title="Refresh integration targets" @click="store.refreshIntegrationTargets()">
          <template #icon><IconRefresh :size="15" /></template>
        </Button>
      </div>
    </div>

    <div name="integrations__body" class="workbench-integrations__body">
      <div name="integrations__list__scroll" class="workbench-integrations__list__scroll">
        <Empty v-if="!store.integrationLoading && !targets.length" class="workbench-integrations__empty" description="No integration targets" />
        <div v-else name="integrations__list" class="workbench-integrations__list">
          <article
            v-for="target in targets"
            :key="target.id"
            name="integrations__target"
            class="workbench-integrations__target"
            :class="{ 'workbench-integrations__target--selected': store.selectedIntegrationTargetId === target.id }"
            @click="store.selectIntegrationTarget(target.id)"
          >
            <div name="integrations__target__header" class="workbench-integrations__target__header">
              <div class="workbench-integrations__target__identity">
                <div class="workbench-integrations__target__name-row">
                  <span class="workbench-integrations__target__name">{{ target.name }}</span>
                  <span class="workbench-integrations__badge" :class="statusTone(target)">
                    {{ target.status }}
                  </span>
                </div>
                <div class="workbench-integrations__target__domain">{{ target.domain || '-' }}</div>
              </div>

              <div name="integrations__target__actions" class="workbench-integrations__target__actions">
                <Button
                  v-if="target.sourceKind === 'ai-crms-migration'"
                  size="mini"
                  :loading="store.integrationRunningTargetId === target.id"
                  :disabled="Boolean(store.integrationRunningTargetId && store.integrationRunningTargetId !== target.id)"
                  @click.stop="runMigrationDryRun(target)"
                >
                  <template #icon><IconTransfer :size="13" /></template>
                  Migration
                </Button>
                <Button
                  v-if="target.sourceKind === 'recorded-site'"
                  size="mini"
                  :loading="store.integrationRunningTargetId === target.id"
                  :disabled="Boolean(store.integrationRunningTargetId && store.integrationRunningTargetId !== target.id)"
                  @click.stop="runRecordedSiteDryRun(target)"
                >
                  <template #icon><IconDatabase :size="13" /></template>
                  Source Dry Run
                </Button>
                <Button
                  v-if="target.sourceKind === 'recorded-site'"
                  size="mini"
                  :loading="store.integrationRunningTargetId === target.id"
                  :disabled="Boolean(store.integrationRunningTargetId && store.integrationRunningTargetId !== target.id)"
                  @click.stop="runRecordedSitePlan(target)"
                >
                  <template #icon><IconChecklist :size="13" /></template>
                  Source Plan
                </Button>
                <Button
                  v-if="target.sourceKind === 'recorded-site'"
                  size="mini"
                  status="warning"
                  :loading="store.integrationRunningTargetId === target.id"
                  :disabled="Boolean(store.integrationRunningTargetId && store.integrationRunningTargetId !== target.id)"
                  @click.stop="runRecordedSiteApply(target)"
                >
                  <template #icon><IconTransfer :size="13" /></template>
                  Apply
                </Button>
                <Button
                  size="mini"
                  :loading="store.integrationRunningTargetId === target.id"
                  :disabled="Boolean(store.integrationRunningTargetId && store.integrationRunningTargetId !== target.id)"
                  @click.stop="runDryRun(target)"
                >
                  <template #icon><IconPlayerPlay :size="13" /></template>
                  Dry Run
                </Button>
                <Button
                  size="mini"
                  :loading="store.integrationRunningTargetId === target.id"
                  :disabled="Boolean(store.integrationRunningTargetId && store.integrationRunningTargetId !== target.id)"
                  @click.stop="runReadiness(target)"
                >
                  <template #icon><IconChecklist :size="13" /></template>
                  Readiness
                </Button>
                <Button
                  size="mini"
                  status="danger"
                  :loading="store.integrationDeletingTargetId === target.id"
                  :disabled="Boolean(store.integrationDeletingTargetId && store.integrationDeletingTargetId !== target.id)"
                  @click.stop="deleteTarget(target)"
                >
                  <template #icon><IconTrash :size="13" /></template>
                </Button>
              </div>
            </div>

            <div name="integrations__target__meta" class="workbench-integrations__target__meta">
              <span>{{ target.endpointCount }} endpoints</span>
              <span>{{ target.readCount }} read</span>
              <span>{{ target.writeCount }} write</span>
              <span>{{ target.scheduleEnabled ? `every ${target.scheduleIntervalMinutes || 60}m` : 'schedule off' }}</span>
              <span v-if="target.scheduleNextRunAt">next {{ formatTime(target.scheduleNextRunAt) }}</span>
              <span>updated {{ formatTime(target.updatedAt) }}</span>
            </div>

            <div name="integrations__target__entities" class="workbench-integrations__target__entities">
              <span
                v-for="entity in target.entities"
                :key="entity"
                class="workbench-integrations__entity"
              >
                {{ entity }}
              </span>
              <span v-if="!target.entities.length" class="workbench-integrations__target__empty">no entity mapping</span>
            </div>
          </article>
        </div>
      </div>

      <aside name="integrations__detail" class="workbench-integrations__detail">
        <div name="integrations__detail__header" class="workbench-integrations__detail__header">
          <div class="workbench-integrations__detail__heading">
            <div class="workbench-integrations__detail__title">{{ detail?.name || 'Target Detail' }}</div>
            <div class="workbench-integrations__detail__domain">{{ detail?.source.domain || 'Select a target' }}</div>
          </div>
        </div>

        <div v-if="detail" name="integrations__detail__body" class="workbench-integrations__detail__body">
          <div v-if="detail.source.kind === 'recorded-site'" name="integrations__detail__apply" class="workbench-integrations__card">
            <div class="workbench-integrations__card__row">
              <div class="workbench-integrations__card__heading">
                <div class="workbench-integrations__card__title">Apply</div>
                <div class="workbench-integrations__card__value">
                  {{ applyAllowUpdates ? 'creates and linked updates' : 'creates only' }}
                </div>
              </div>
              <label class="workbench-integrations__card__toggle">
                <ArcoSwitch v-model="applyAllowUpdates" size="small" name="integrations__apply__updates" />
                Linked updates
              </label>
            </div>
          </div>

          <div name="integrations__detail__schedule" class="workbench-integrations__card">
            <div class="workbench-integrations__card__row">
              <div class="workbench-integrations__card__heading">
                <div class="workbench-integrations__card__title">Schedule</div>
                <div class="workbench-integrations__card__value">
                  {{ detail.schedule.enabled ? `every ${detail.schedule.intervalMinutes || 60}m` : 'off' }}
                  <span v-if="detail.schedule.nextRunAt" class="workbench-integrations__card__hint"> · next {{ formatTime(detail.schedule.nextRunAt) }}</span>
                </div>
              </div>
              <span class="workbench-integrations__schedule-kind">
                {{ scheduleKindLabel(detail.schedule.runKind) }}
              </span>
            </div>
            <div class="workbench-integrations__schedule-controls">
              <InputNumber
                v-model="scheduleIntervalMinutes"
                size="small"
                :min="1"
                :max="1440"
                :step="5"
                class="workbench-integrations__schedule-interval"
                name="integrations__schedule__interval"
              />
              <span class="workbench-integrations__schedule-unit">min</span>
              <Button
                size="mini"
                type="primary"
                :loading="store.integrationSchedulingTargetId === detail.id"
                :disabled="Boolean(store.integrationSchedulingTargetId && store.integrationSchedulingTargetId !== detail.id)"
                @click="setSchedule(true)"
              >
                <template #icon><IconClock :size="13" /></template>
                {{ detail.schedule.enabled ? 'Save' : 'Enable' }}
              </Button>
              <Button
                v-if="detail.schedule.enabled"
                size="mini"
                :loading="store.integrationSchedulingTargetId === detail.id"
                :disabled="Boolean(store.integrationSchedulingTargetId && store.integrationSchedulingTargetId !== detail.id)"
                @click="setSchedule(false)"
              >
                Disable
              </Button>
            </div>
          </div>

          <div name="integrations__detail__run" class="workbench-integrations__card">
            <div class="workbench-integrations__card__title">Last Run</div>
            <div class="workbench-integrations__run-status" :class="runTone(detail.state.lastRun)">{{ runLabel(detail.state.lastRun) }}</div>
            <div v-if="detail.state.lastRun?.missing?.length" class="workbench-integrations__run-missing">
              <div v-for="item in detail.state.lastRun.missing" :key="item" class="workbench-integrations__run-missing__item">Missing: {{ item }}</div>
            </div>
            <div v-if="detail.state.lastRun?.outputs?.length" class="workbench-integrations__run-outputs">
              <div
                v-for="output in detail.state.lastRun.outputs"
                :key="`${output.name}-${output.durationMs}`"
                class="workbench-integrations__run-output"
              >
                <span class="workbench-integrations__run-output__name" :class="{ 'workbench-integrations__run-output__name--failed': !output.ok }">{{ output.name }}</span>
                <span v-if="output.summary"> · {{ output.summary }}</span>
                <span v-if="output.error"> · {{ output.error }}</span>
              </div>
            </div>
          </div>

          <div v-if="detail.source.migration" name="integrations__detail__migration" class="workbench-integrations__card">
            <div class="workbench-integrations__card__title">Migration</div>
            <div class="workbench-integrations__migration-data">
              <div>source: {{ detail.source.migration.source }}</div>
              <div>target: {{ detail.source.migration.target }}</div>
            </div>
            <div class="workbench-integrations__tags">
              <span
                v-for="domain in detail.source.migration.domains"
                :key="domain"
                class="workbench-integrations__entity"
              >
                {{ domain }}
              </span>
            </div>
          </div>

          <div name="integrations__detail__mappings" class="workbench-integrations__card">
            <div class="workbench-integrations__card__row">
              <div class="workbench-integrations__card__title">Source Map</div>
              <div class="workbench-integrations__mapping-count">
                {{ mappingSummary?.total || 0 }} links
              </div>
            </div>
            <div v-if="mappingEntityRows.length" class="workbench-integrations__tags">
              <span
                v-for="item in mappingEntityRows"
                :key="item.entity"
                class="workbench-integrations__entity"
              >
                {{ item.entity }} {{ item.count }}
              </span>
            </div>
            <div v-if="mappingStatusRows.length" class="workbench-integrations__tags">
              <span
                v-for="item in mappingStatusRows"
                :key="item.status"
                class="workbench-integrations__mapping-status"
              >
                {{ item.status }} {{ item.count }}
              </span>
            </div>
            <div v-if="mappingRows.length" class="workbench-integrations__mapping-list">
              <div
                v-for="mapping in mappingRows.slice(0, 5)"
                :key="mapping.id"
                class="workbench-integrations__mapping-item"
              >
                <span class="workbench-integrations__mapping-item__entity">{{ mapping.entity }}</span>
                <span> · {{ mapping.sourceKey }}</span>
                <span v-if="mapping.aiCrmsId"> -> {{ mapping.aiCrmsId }}</span>
                <span> · {{ mapping.status }}</span>
              </div>
            </div>
            <div v-else class="workbench-integrations__mapping-empty">
              no source-target links
            </div>
          </div>

          <div name="integrations__detail__endpoints" class="workbench-integrations__endpoints">
            <div class="workbench-integrations__endpoints__title">Endpoints</div>
            <div
              v-for="endpoint in detail.endpoints"
              :key="endpoint.id"
              name="integrations__endpoint"
              class="workbench-integrations__endpoint"
            >
              <div class="workbench-integrations__endpoint__header">
                <span class="workbench-integrations__badge" :class="endpointTone(endpoint)">
                  {{ endpoint.role }}
                </span>
                <span class="workbench-integrations__endpoint__method">{{ endpoint.method }}</span>
                <span class="workbench-integrations__endpoint__path">{{ endpoint.path }}</span>
              </div>
              <div class="workbench-integrations__endpoint__meta">
                <span>{{ endpoint.count }}x</span>
                <span>{{ endpoint.safety }}</span>
                <span v-if="endpoint.sampleStatus">HTTP {{ endpoint.sampleStatus }}</span>
                <span v-if="endpoint.requestBodyKind">{{ endpoint.requestBodyKind }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-else name="integrations__detail__empty" class="workbench-integrations__detail__empty">
          <Empty description="No target selected" />
        </div>
      </aside>
    </div>
  </section>
</template>
