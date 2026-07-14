<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Button, Empty, Message, Option, Select } from '@arco-design/web-vue'
import { IconAlertTriangle, IconDownload, IconRefresh, IconSearch, IconShieldCheck, IconTool, IconTrash } from '@tabler/icons-vue'
import type { HostApprovalEvent, HostToolCatalogEntry, HostToolPolicyMode, HostToolRisk, HostToolScope } from '@cowork-shared/coach.api'
import { workbenchStore as store } from '../workbench.store'

const queryDraft = ref(store.hostToolQuery)

const scopes: { id: HostToolScope; label: string }[] = [
  { id: 'cowork', label: 'Cowork' },
  { id: 'trainer', label: 'Trainer' }
]

const title = computed(() => (store.hostToolScope === 'trainer' ? 'Trainer Tools' : 'Cowork Tools'))
const subtitle = computed(() => `${store.hostToolCatalog?.total || 0} tools`)
const approvalSubtitle = computed(() => `${store.hostApprovalEvents.length} recent`)

const riskLabel = (risk: HostToolRisk): string => {
  if (risk === 'destructive') return 'Destructive'
  if (risk === 'write') return 'Write'
  return 'Read'
}

const riskClass = (risk: HostToolRisk): string => {
  if (risk === 'destructive') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (risk === 'write') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-emerald-200 bg-emerald-50 text-emerald-700'
}

const policyMode = (tool: HostToolCatalogEntry): HostToolPolicyMode => tool.policy?.mode || 'bypass'

const policyClass = (tool: HostToolCatalogEntry): string => {
  if (policyMode(tool) === 'disabled') return 'border-gray-200 bg-gray-100 text-gray-500'
  if (policyMode(tool) === 'confirm') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-blue-200 bg-blue-50 text-blue-700'
}

const policyLabel = (tool: HostToolCatalogEntry): string => {
  if (policyMode(tool) === 'disabled') return 'Disabled'
  if (policyMode(tool) === 'confirm') return 'Confirm'
  return 'Bypass'
}

const setPolicy = (tool: HostToolCatalogEntry, value: unknown): void => {
  const mode = value === 'confirm' || value === 'disabled' ? value : 'bypass'
  void store.setHostToolPolicy(tool.name, mode)
}

const categoryClass = (tool: HostToolCatalogEntry): string => {
  if (tool.category === 'api') return 'bg-sky-50 text-sky-700'
  if (tool.category === 'skill') return 'bg-violet-50 text-violet-700'
  if (tool.category === 'integration') return 'bg-teal-50 text-teal-700'
  if (tool.category === 'training') return 'bg-fuchsia-50 text-fuchsia-700'
  if (tool.category === 'workspace' || tool.category === 'file') return 'bg-cyan-50 text-cyan-700'
  if (tool.category === 'act') return 'bg-amber-50 text-amber-700'
  return 'bg-slate-100 text-slate-600'
}

const setScope = (scope: HostToolScope): void => {
  void store.setHostToolScope(scope)
}

const setCategory = (value: unknown): void => {
  void store.setHostToolCategory(String(value || ''))
}

const approvalStatusLabel = (event: HostApprovalEvent): string => {
  if (event.status === 'approved') return 'Approved'
  if (event.status === 'denied') return 'Denied'
  if (event.status === 'blocked') return 'Blocked'
  return 'Pending'
}

const approvalStatusClass = (event: HostApprovalEvent): string => {
  if (event.status === 'approved') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (event.status === 'pending') return 'border-sky-200 bg-sky-50 text-sky-700'
  return 'border-rose-200 bg-rose-50 text-rose-700'
}

const approvalKindClass = (event: HostApprovalEvent): string => {
  if (event.kind === 'api') return 'bg-cyan-50 text-cyan-700'
  return 'bg-slate-100 text-slate-700'
}

const approvalTime = (ts: number): string => {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const approvalMeta = (event: HostApprovalEvent): string => {
  return [event.scope, event.reason, event.detail].filter(Boolean).join(' · ')
}

const applyQuery = (): void => {
  void store.setHostToolQuery(queryDraft.value)
}

const exportApprovals = async (): Promise<void> => {
  const result = await store.exportHostApprovalEvents()
  if (result.canceled) return
  if (result.ok) Message.success(`Exported ${result.count || 0} approval${result.count === 1 ? '' : 's'}`)
  else Message.error(result.error || 'Could not export approvals')
}

onMounted(() => {
  void store.refreshHostToolCatalog()
  void store.refreshHostApprovalEvents()
})
</script>

<template>
  <section name="tools" class="flex h-full min-h-0 flex-col bg-white">
    <div name="tools__toolbar" class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-1 pb-3">
      <div name="tools__title" class="flex min-w-0 items-center gap-2">
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#eef4ff] text-[#165dff]">
          <IconTool :size="17" stroke="1.8" />
        </span>
        <div class="min-w-0">
          <div class="truncate text-[13px] font-semibold text-gray-900">{{ title }}</div>
          <div class="text-[11px] font-medium text-gray-500">{{ subtitle }}</div>
        </div>
      </div>

      <div name="tools__controls" class="flex min-w-0 flex-wrap items-center gap-2">
        <div name="tools__scope" class="flex h-8 overflow-hidden rounded-md border border-gray-200 bg-gray-50 p-0.5">
          <button
            v-for="scope in scopes"
            :key="scope.id"
            type="button"
            class="h-7 px-2.5 text-[12px] font-semibold transition"
            :class="store.hostToolScope === scope.id ? 'rounded bg-white text-[#165dff] shadow-sm' : 'text-gray-500 hover:text-gray-800'"
            @click="setScope(scope.id)"
          >
            {{ scope.label }}
          </button>
        </div>

        <Select
          name="tools__category"
          :model-value="store.hostToolCategory"
          size="small"
          class="w-[136px]"
          :disabled="store.hostToolLoading"
          @change="setCategory"
        >
          <Option v-for="category in store.hostToolCategories" :key="category.key" :value="category.key">
            {{ category.label }}
          </Option>
        </Select>

        <label name="tools__search" class="flex h-8 w-[220px] min-w-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 focus-within:border-[#165dff]">
          <IconSearch :size="15" class="shrink-0 text-gray-400" stroke="1.8" />
          <input
            v-model="queryDraft"
            type="search"
            class="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-gray-800 outline-none placeholder:text-gray-400"
            placeholder="Search tools"
            @keydown.enter.prevent="applyQuery"
          />
        </label>

        <Button name="tools__search__button" size="small" :disabled="store.hostToolLoading" @click="applyQuery">
          <template #icon><IconSearch :size="15" /></template>
          Search
        </Button>
        <Button name="tools__refresh" size="small" :loading="store.hostToolLoading" title="Refresh tools" @click="store.refreshHostToolCatalog()">
          <template #icon><IconRefresh :size="15" /></template>
        </Button>
      </div>
    </div>

    <div name="tools__body" class="grid min-h-0 flex-1 gap-3 pt-3 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div name="tools__list__scroll" class="min-h-0 overflow-auto pr-1">
        <Empty v-if="!store.hostToolLoading && !store.hostTools.length" class="mt-10" description="No tools" />
        <div v-else name="tools__list" class="grid gap-2">
          <article
            v-for="tool in store.hostTools"
            :key="tool.name"
            name="tools__row"
            class="grid gap-3 rounded-md border border-gray-200 bg-[#fbfcfe] px-3 py-3 text-[12px] shadow-[0_1px_0_rgba(15,23,42,0.03)] md:grid-cols-[minmax(170px,230px)_minmax(0,1fr)]"
          >
            <div name="tools__row__identity" class="min-w-0">
              <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                <span class="truncate font-mono text-[12px] font-semibold text-gray-900">{{ tool.name }}</span>
                <span class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" :class="categoryClass(tool)">
                  {{ tool.category }}
                </span>
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-1.5">
                <span class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase" :class="riskClass(tool.risk)">
                  <IconAlertTriangle v-if="tool.risk === 'destructive'" :size="12" stroke="2" />
                  <IconShieldCheck v-else :size="12" stroke="2" />
                  {{ riskLabel(tool.risk) }}
                </span>
                <span class="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase" :class="policyClass(tool)">
                  {{ policyLabel(tool) }}
                </span>
                <span
                  v-for="scope in tool.scopes"
                  :key="scope"
                  class="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-500 ring-1 ring-gray-200"
                >
                  {{ scope }}
                </span>
              </div>
              <Select
                name="tools__policy"
                size="mini"
                class="mt-2 w-[132px]"
                :model-value="policyMode(tool)"
                :disabled="store.hostToolLoading"
                @change="(value) => setPolicy(tool, value)"
              >
                <Option value="bypass">Bypass</Option>
                <Option value="confirm">Confirm</Option>
                <Option value="disabled">Disabled</Option>
              </Select>
            </div>

            <div name="tools__row__content" class="min-w-0">
              <p class="m-0 text-[12px] leading-5 text-gray-800">{{ tool.summary }}</p>
              <div class="mt-2 grid gap-2 lg:grid-cols-2">
                <div class="min-w-0 rounded border border-gray-200 bg-white px-2 py-1.5">
                  <div class="text-[10px] font-bold uppercase text-gray-400">Use when</div>
                  <div class="mt-0.5 text-[12px] leading-5 text-gray-700">{{ tool.useWhen }}</div>
                </div>
                <div class="min-w-0 rounded border border-gray-200 bg-white px-2 py-1.5">
                  <div class="text-[10px] font-bold uppercase text-gray-400">Safety</div>
                  <div class="mt-0.5 text-[12px] leading-5 text-gray-700">{{ tool.safety }}</div>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>

      <aside name="tools__approval" class="flex min-h-[220px] min-w-0 flex-col overflow-hidden rounded-md border border-gray-200 bg-[#f8fafc]">
        <div name="tools__approval__header" class="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2">
          <div class="min-w-0">
            <div class="truncate text-[12px] font-semibold text-gray-900">Approval history</div>
            <div class="text-[10px] font-medium text-gray-500">{{ approvalSubtitle }}</div>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Button size="mini" :loading="store.hostApprovalLoading" title="Refresh approvals" @click="store.refreshHostApprovalEvents()">
              <template #icon><IconRefresh :size="13" /></template>
            </Button>
            <Button size="mini" :loading="store.hostApprovalExporting" :disabled="!store.hostApprovalEvents.length" title="Export approvals" @click="exportApprovals">
              <template #icon><IconDownload :size="13" /></template>
            </Button>
            <Button size="mini" :disabled="!store.hostApprovalEvents.length" title="Clear approvals" @click="store.clearHostApprovalEvents()">
              <template #icon><IconTrash :size="13" /></template>
            </Button>
          </div>
        </div>
        <div name="tools__approval__list" class="min-h-0 flex-1 overflow-auto p-2">
          <Empty v-if="!store.recentHostApprovalEvents.length" class="mt-8" description="No approvals" />
          <div v-else class="grid gap-1.5">
            <div
              v-for="event in store.recentHostApprovalEvents"
              :key="event.id"
              name="tools__approval__row"
              class="grid gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-2 text-[11px]"
            >
              <div class="flex min-w-0 items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-1.5">
                  <span class="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" :class="approvalKindClass(event)">
                    {{ event.kind }}
                  </span>
                  <span class="truncate font-mono font-semibold text-gray-900">{{ event.label }}</span>
                </div>
                <span class="shrink-0 text-[10px] font-medium text-gray-400">{{ approvalTime(event.resolvedAt || event.requestedAt) }}</span>
              </div>
              <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                <span class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase" :class="approvalStatusClass(event)">
                  <IconShieldCheck v-if="event.status === 'approved'" :size="11" stroke="2" />
                  <IconTool v-else-if="event.status === 'pending'" :size="11" stroke="2" />
                  <IconAlertTriangle v-else :size="11" stroke="2" />
                  {{ approvalStatusLabel(event) }}
                </span>
                <span v-if="event.path" class="truncate rounded bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
                  {{ event.path }}
                </span>
              </div>
              <div v-if="approvalMeta(event)" class="line-clamp-2 text-[11px] leading-4 text-gray-500">
                {{ approvalMeta(event) }}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>
