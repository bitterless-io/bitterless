<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Button, Empty, Message, Option, Select } from '@arco-design/web-vue'
import { IconAlertTriangle, IconDownload, IconRefresh, IconSearch, IconShieldCheck, IconTool, IconTrash } from '@tabler/icons-vue'
import type { HostApprovalEvent, HostToolCatalogEntry, HostToolPolicyMode, HostToolRisk, HostToolScope } from '@maestro-shared/coach.api'
import { workbenchStore as store } from '../workbench.store'
import './WorkbenchToolsView.less'

const queryDraft = ref(store.hostToolQuery)

const scopes: { id: HostToolScope; label: string }[] = [
  { id: 'cowork', label: 'Maestro' },
  { id: 'trainer', label: 'Trainer' }
]

const title = computed(() => (store.hostToolScope === 'trainer' ? 'Trainer Tools' : 'Maestro Tools'))
const subtitle = computed(() => `${store.hostToolCatalog?.total || 0} tools`)
const approvalSubtitle = computed(() => `${store.hostApprovalEvents.length} recent`)

const riskLabel = (risk: HostToolRisk): string => {
  if (risk === 'destructive') return 'Destructive'
  if (risk === 'write') return 'Write'
  return 'Read'
}

const riskClass = (risk: HostToolRisk): string => {
  if (risk === 'destructive') return 'workbench-tools__badge--risk-destructive'
  if (risk === 'write') return 'workbench-tools__badge--risk-write'
  return 'workbench-tools__badge--risk-read'
}

const policyMode = (tool: HostToolCatalogEntry): HostToolPolicyMode => tool.policy?.mode || 'bypass'

const policyClass = (tool: HostToolCatalogEntry): string => {
  if (policyMode(tool) === 'disabled') return 'workbench-tools__badge--policy-disabled'
  if (policyMode(tool) === 'confirm') return 'workbench-tools__badge--policy-confirm'
  return 'workbench-tools__badge--policy-bypass'
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
  if (tool.category === 'api') return 'workbench-tools__category--api'
  if (tool.category === 'skill') return 'workbench-tools__category--skill'
  if (tool.category === 'integration') return 'workbench-tools__category--integration'
  if (tool.category === 'training') return 'workbench-tools__category--training'
  if (tool.category === 'workspace' || tool.category === 'file') return 'workbench-tools__category--workspace'
  if (tool.category === 'act') return 'workbench-tools__category--act'
  return 'workbench-tools__category--default'
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
  if (event.status === 'approved') return 'workbench-tools__badge--approval-approved'
  if (event.status === 'pending') return 'workbench-tools__badge--approval-pending'
  return 'workbench-tools__badge--approval-blocked'
}

const approvalKindClass = (event: HostApprovalEvent): string => {
  if (event.kind === 'api') return 'workbench-tools__approval-kind--api'
  return 'workbench-tools__approval-kind--default'
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
  <section name="tools" class="workbench-tools">
    <div name="tools__toolbar" class="workbench-tools__toolbar">
      <div name="tools__title" class="workbench-tools__title">
        <span class="workbench-tools__title__icon">
          <IconTool :size="17" stroke="1.8" />
        </span>
        <div class="workbench-tools__title__body">
          <div class="workbench-tools__title__heading">{{ title }}</div>
          <div class="workbench-tools__title__subtitle">{{ subtitle }}</div>
        </div>
      </div>

      <div name="tools__controls" class="workbench-tools__controls">
        <div name="tools__scope" class="workbench-tools__scope">
          <button
            v-for="scope in scopes"
            :key="scope.id"
            type="button"
            class="workbench-tools__scope__button"
            :class="{ 'workbench-tools__scope__button--active': store.hostToolScope === scope.id }"
            @click="setScope(scope.id)"
          >
            {{ scope.label }}
          </button>
        </div>

        <Select
          name="tools__category"
          :model-value="store.hostToolCategory"
          size="small"
          class="workbench-tools__category-select"
          :disabled="store.hostToolLoading"
          @change="setCategory"
        >
          <Option v-for="category in store.hostToolCategories" :key="category.key" :value="category.key">
            {{ category.label }}
          </Option>
        </Select>

        <label name="tools__search" class="workbench-tools__search">
          <IconSearch :size="15" class="workbench-tools__search__icon" stroke="1.8" />
          <input
            v-model="queryDraft"
            type="search"
            class="workbench-tools__search__input"
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

    <div name="tools__body" class="workbench-tools__body">
      <div name="tools__list__scroll" class="workbench-tools__list__scroll">
        <Empty v-if="!store.hostToolLoading && !store.hostTools.length" class="workbench-tools__empty" description="No tools" />
        <div v-else name="tools__list" class="workbench-tools__list">
          <article
            v-for="tool in store.hostTools"
            :key="tool.name"
            name="tools__row"
            class="workbench-tools__row"
          >
            <div name="tools__row__identity" class="workbench-tools__row__identity">
              <div class="workbench-tools__row__name-line">
                <span class="workbench-tools__row__name">{{ tool.name }}</span>
                <span class="workbench-tools__category" :class="categoryClass(tool)">
                  {{ tool.category }}
                </span>
              </div>
              <div class="workbench-tools__row__badges">
                <span class="workbench-tools__badge" :class="riskClass(tool.risk)">
                  <IconAlertTriangle v-if="tool.risk === 'destructive'" :size="12" stroke="2" />
                  <IconShieldCheck v-else :size="12" stroke="2" />
                  {{ riskLabel(tool.risk) }}
                </span>
                <span class="workbench-tools__badge" :class="policyClass(tool)">
                  {{ policyLabel(tool) }}
                </span>
                <span
                  v-for="scope in tool.scopes"
                  :key="scope"
                  class="workbench-tools__scope-tag"
                >
                  {{ scope }}
                </span>
              </div>
              <Select
                name="tools__policy"
                size="mini"
                class="workbench-tools__policy-select"
                :model-value="policyMode(tool)"
                :disabled="store.hostToolLoading"
                @change="(value) => setPolicy(tool, value)"
              >
                <Option value="bypass">Bypass</Option>
                <Option value="confirm">Confirm</Option>
                <Option value="disabled">Disabled</Option>
              </Select>
            </div>

            <div name="tools__row__content" class="workbench-tools__row__content">
              <p class="workbench-tools__row__summary">{{ tool.summary }}</p>
              <div class="workbench-tools__row__details">
                <div class="workbench-tools__row__detail">
                  <div class="workbench-tools__row__detail-label">Use when</div>
                  <div class="workbench-tools__row__detail-value">{{ tool.useWhen }}</div>
                </div>
                <div class="workbench-tools__row__detail">
                  <div class="workbench-tools__row__detail-label">Safety</div>
                  <div class="workbench-tools__row__detail-value">{{ tool.safety }}</div>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>

      <aside name="tools__approval" class="workbench-tools__approval">
        <div name="tools__approval__header" class="workbench-tools__approval__header">
          <div class="workbench-tools__approval__heading">
            <div class="workbench-tools__approval__title">Approval history</div>
            <div class="workbench-tools__approval__subtitle">{{ approvalSubtitle }}</div>
          </div>
          <div class="workbench-tools__approval__actions">
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
        <div name="tools__approval__list" class="workbench-tools__approval__list">
          <Empty v-if="!store.recentHostApprovalEvents.length" class="workbench-tools__approval__empty" description="No approvals" />
          <div v-else class="workbench-tools__approval__rows">
            <div
              v-for="event in store.recentHostApprovalEvents"
              :key="event.id"
              name="tools__approval__row"
              class="workbench-tools__approval__row"
            >
              <div class="workbench-tools__approval__row-header">
                <div class="workbench-tools__approval__identity">
                  <span class="workbench-tools__approval-kind" :class="approvalKindClass(event)">
                    {{ event.kind }}
                  </span>
                  <span class="workbench-tools__approval__label">{{ event.label }}</span>
                </div>
                <span class="workbench-tools__approval__time">{{ approvalTime(event.resolvedAt || event.requestedAt) }}</span>
              </div>
              <div class="workbench-tools__approval__badges">
                <span class="workbench-tools__badge workbench-tools__badge--small" :class="approvalStatusClass(event)">
                  <IconShieldCheck v-if="event.status === 'approved'" :size="11" stroke="2" />
                  <IconTool v-else-if="event.status === 'pending'" :size="11" stroke="2" />
                  <IconAlertTriangle v-else :size="11" stroke="2" />
                  {{ approvalStatusLabel(event) }}
                </span>
                <span v-if="event.path" class="workbench-tools__approval__path">
                  {{ event.path }}
                </span>
              </div>
              <div v-if="approvalMeta(event)" class="workbench-tools__approval__meta">
                {{ approvalMeta(event) }}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>
