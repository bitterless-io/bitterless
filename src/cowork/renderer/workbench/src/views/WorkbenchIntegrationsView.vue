<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Button, Empty, InputNumber, Message, Switch as ArcoSwitch } from '@arco-design/web-vue'
import { IconChecklist, IconClock, IconDatabase, IconPlayerPlay, IconRefresh, IconTransfer, IconTrash, IconWand } from '@tabler/icons-vue'
import type { IntegrationEndpointContract, IntegrationRunSummary, IntegrationTargetSummary } from '@cowork-shared/coach.api'
import { workbenchStore as store } from '../workbench.store'

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
  if (endpoint.role === 'write') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (endpoint.role === 'read') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-gray-200 bg-gray-50 text-gray-600'
}

const statusTone = (target: IntegrationTargetSummary): string => {
  if (target.status === 'dry-run-ok') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (target.status === 'error') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-sky-200 bg-sky-50 text-sky-700'
}

const runTone = (run?: IntegrationRunSummary): string => {
  if (!run) return 'text-gray-500'
  if (run.status === 'success') return 'text-emerald-700'
  if (run.status === 'failed') return 'text-rose-700'
  return 'text-amber-700'
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
  <section name="integrations" class="flex h-full min-h-0 flex-col bg-white">
    <div name="integrations__toolbar" class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-1 pb-3">
      <div name="integrations__title" class="flex min-w-0 items-center gap-2">
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#eef4ff] text-[#165dff]">
          <IconDatabase :size="17" stroke="1.8" />
        </span>
        <div class="min-w-0">
          <div class="truncate text-[13px] font-semibold text-gray-900">Integration Targets</div>
          <div class="text-[11px] font-medium text-gray-500">{{ subtitle }}</div>
        </div>
      </div>

      <div name="integrations__actions" class="flex min-w-0 flex-wrap items-center gap-2">
        <Button name="integrations__create" size="small" type="primary" :loading="store.integrationCreating" @click="createFromCapture">
          <template #icon><IconWand :size="15" /></template>
          From Capture
        </Button>
        <Button name="integrations__refresh" size="small" :loading="store.integrationLoading" title="Refresh integration targets" @click="store.refreshIntegrationTargets()">
          <template #icon><IconRefresh :size="15" /></template>
        </Button>
      </div>
    </div>

    <div name="integrations__body" class="grid min-h-0 flex-1 gap-3 pt-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div name="integrations__list__scroll" class="min-h-0 overflow-auto px-1 pr-1">
        <Empty v-if="!store.integrationLoading && !targets.length" class="mt-12" description="No integration targets" />
        <div v-else name="integrations__list" class="grid gap-2">
          <article
            v-for="target in targets"
            :key="target.id"
            name="integrations__target"
            class="grid gap-3 rounded-md border px-3 py-3 text-[12px] shadow-[0_1px_0_rgba(15,23,42,0.03)]"
            :class="store.selectedIntegrationTargetId === target.id ? 'border-blue-200 bg-[#f8fbff]' : 'border-gray-200 bg-[#fbfcfe]'"
            @click="store.selectIntegrationTarget(target.id)"
          >
            <div name="integrations__target__header" class="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <span class="max-w-full truncate text-[12px] font-semibold text-gray-900">{{ target.name }}</span>
                  <span class="inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase" :class="statusTone(target)">
                    {{ target.status }}
                  </span>
                </div>
                <div class="mt-1 font-mono text-[11px] text-gray-500">{{ target.domain || '-' }}</div>
              </div>

              <div name="integrations__target__actions" class="flex shrink-0 items-center gap-1">
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

            <div name="integrations__target__meta" class="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-gray-500">
              <span>{{ target.endpointCount }} endpoints</span>
              <span>{{ target.readCount }} read</span>
              <span>{{ target.writeCount }} write</span>
              <span>{{ target.scheduleEnabled ? `every ${target.scheduleIntervalMinutes || 60}m` : 'schedule off' }}</span>
              <span v-if="target.scheduleNextRunAt">next {{ formatTime(target.scheduleNextRunAt) }}</span>
              <span>updated {{ formatTime(target.updatedAt) }}</span>
            </div>

            <div name="integrations__target__entities" class="flex min-w-0 flex-wrap gap-1.5">
              <span
                v-for="entity in target.entities"
                :key="entity"
                class="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-600 ring-1 ring-gray-200"
              >
                {{ entity }}
              </span>
              <span v-if="!target.entities.length" class="text-[11px] text-gray-400">no entity mapping</span>
            </div>
          </article>
        </div>
      </div>

      <aside name="integrations__detail" class="flex min-h-[220px] min-w-0 flex-col overflow-hidden rounded-md border border-gray-200 bg-[#f8fafc]">
        <div name="integrations__detail__header" class="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2">
          <div class="min-w-0">
            <div class="truncate text-[12px] font-semibold text-gray-900">{{ detail?.name || 'Target Detail' }}</div>
            <div class="truncate text-[11px] text-gray-500">{{ detail?.source.domain || 'Select a target' }}</div>
          </div>
        </div>

          <div v-if="detail" name="integrations__detail__body" class="min-h-0 flex-1 overflow-auto p-3">
          <div v-if="detail.source.kind === 'recorded-site'" name="integrations__detail__apply" class="mb-3 rounded-md border border-gray-200 bg-white px-2 py-2">
            <div class="flex min-w-0 items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="text-[11px] font-semibold uppercase text-gray-500">Apply</div>
                <div class="mt-1 truncate text-[12px] font-semibold text-gray-800">
                  {{ applyAllowUpdates ? 'creates and linked updates' : 'creates only' }}
                </div>
              </div>
              <label class="flex shrink-0 items-center gap-2 text-[11px] font-semibold text-gray-600">
                <ArcoSwitch v-model="applyAllowUpdates" size="small" name="integrations__apply__updates" />
                Linked updates
              </label>
            </div>
          </div>

          <div name="integrations__detail__schedule" class="mb-3 rounded-md border border-gray-200 bg-white px-2 py-2">
            <div class="flex min-w-0 items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="text-[11px] font-semibold uppercase text-gray-500">Schedule</div>
                <div class="mt-1 truncate text-[12px] font-semibold text-gray-800">
                  {{ detail.schedule.enabled ? `every ${detail.schedule.intervalMinutes || 60}m` : 'off' }}
                  <span v-if="detail.schedule.nextRunAt" class="font-normal text-gray-500"> · next {{ formatTime(detail.schedule.nextRunAt) }}</span>
                </div>
              </div>
              <span class="shrink-0 rounded border border-sky-100 bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-700">
                {{ scheduleKindLabel(detail.schedule.runKind) }}
              </span>
            </div>
            <div class="mt-2 flex min-w-0 flex-wrap items-center gap-2">
              <InputNumber
                v-model="scheduleIntervalMinutes"
                size="small"
                :min="1"
                :max="1440"
                :step="5"
                class="w-[112px]"
                name="integrations__schedule__interval"
              />
              <span class="text-[11px] font-medium text-gray-500">min</span>
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

          <div name="integrations__detail__run" class="mb-3 rounded-md border border-gray-200 bg-white px-2 py-2">
            <div class="text-[11px] font-semibold uppercase text-gray-500">Last Run</div>
            <div class="mt-1 text-[12px] font-semibold" :class="runTone(detail.state.lastRun)">{{ runLabel(detail.state.lastRun) }}</div>
            <div v-if="detail.state.lastRun?.missing?.length" class="mt-2 grid gap-1">
              <div v-for="item in detail.state.lastRun.missing" :key="item" class="text-[11px] leading-4 text-amber-700">Missing: {{ item }}</div>
            </div>
            <div v-if="detail.state.lastRun?.outputs?.length" class="mt-2 grid gap-1">
              <div
                v-for="output in detail.state.lastRun.outputs"
                :key="`${output.name}-${output.durationMs}`"
                class="rounded border border-gray-100 bg-gray-50 px-1.5 py-1 text-[10px] leading-4 text-gray-600"
              >
                <span class="font-semibold" :class="output.ok ? 'text-emerald-700' : 'text-rose-700'">{{ output.name }}</span>
                <span v-if="output.summary"> · {{ output.summary }}</span>
                <span v-if="output.error"> · {{ output.error }}</span>
              </div>
            </div>
          </div>

          <div v-if="detail.source.migration" name="integrations__detail__migration" class="mb-3 rounded-md border border-gray-200 bg-white px-2 py-2">
            <div class="text-[11px] font-semibold uppercase text-gray-500">Migration</div>
            <div class="mt-1 grid gap-1 font-mono text-[11px] text-gray-600">
              <div>source: {{ detail.source.migration.source }}</div>
              <div>target: {{ detail.source.migration.target }}</div>
            </div>
            <div class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="domain in detail.source.migration.domains"
                :key="domain"
                class="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-600 ring-1 ring-gray-200"
              >
                {{ domain }}
              </span>
            </div>
          </div>

          <div name="integrations__detail__mappings" class="mb-3 rounded-md border border-gray-200 bg-white px-2 py-2">
            <div class="flex min-w-0 items-center justify-between gap-2">
              <div class="text-[11px] font-semibold uppercase text-gray-500">Source Map</div>
              <div class="text-[11px] font-semibold text-gray-600">
                {{ mappingSummary?.total || 0 }} links
              </div>
            </div>
            <div v-if="mappingEntityRows.length" class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="item in mappingEntityRows"
                :key="item.entity"
                class="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-600 ring-1 ring-gray-200"
              >
                {{ item.entity }} {{ item.count }}
              </span>
            </div>
            <div v-if="mappingStatusRows.length" class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="item in mappingStatusRows"
                :key="item.status"
                class="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-700 ring-1 ring-sky-100"
              >
                {{ item.status }} {{ item.count }}
              </span>
            </div>
            <div v-if="mappingRows.length" class="mt-2 grid gap-1">
              <div
                v-for="mapping in mappingRows.slice(0, 5)"
                :key="mapping.id"
                class="rounded border border-gray-100 bg-gray-50 px-1.5 py-1 text-[10px] leading-4 text-gray-600"
              >
                <span class="font-semibold uppercase text-gray-700">{{ mapping.entity }}</span>
                <span> · {{ mapping.sourceKey }}</span>
                <span v-if="mapping.aiCrmsId"> -> {{ mapping.aiCrmsId }}</span>
                <span> · {{ mapping.status }}</span>
              </div>
            </div>
            <div v-else class="mt-2 text-[11px] text-gray-400">
              no source-target links
            </div>
          </div>

          <div name="integrations__detail__endpoints" class="grid gap-2">
            <div class="text-[11px] font-semibold uppercase text-gray-500">Endpoints</div>
            <div
              v-for="endpoint in detail.endpoints"
              :key="endpoint.id"
              name="integrations__endpoint"
              class="rounded-md border border-gray-200 bg-white px-2 py-2"
            >
              <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                <span class="inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase" :class="endpointTone(endpoint)">
                  {{ endpoint.role }}
                </span>
                <span class="font-mono text-[11px] font-semibold text-gray-900">{{ endpoint.method }}</span>
                <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-700">{{ endpoint.path }}</span>
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-gray-500">
                <span>{{ endpoint.count }}x</span>
                <span>{{ endpoint.safety }}</span>
                <span v-if="endpoint.sampleStatus">HTTP {{ endpoint.sampleStatus }}</span>
                <span v-if="endpoint.requestBodyKind">{{ endpoint.requestBodyKind }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-else name="integrations__detail__empty" class="grid min-h-0 flex-1 place-items-center p-6">
          <Empty description="No target selected" />
        </div>
      </aside>
    </div>
  </section>
</template>
