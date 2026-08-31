<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Button,
  Empty,
  Input,
  InputNumber,
  Message,
  Modal,
  Option,
  Select,
  Switch,
} from '@arco-design/web-vue'
import {
  IconArrowRight,
  IconCheck,
  IconClipboard,
  IconPlugConnected,
  IconRefresh,
  IconRouter,
  IconTrash,
} from '@tabler/icons-vue'
import { CLAUDE_SUBSCRIPTION_DEFAULT_PORT } from '@shared/claudeSubscription/claudeSubscription.contract'
import type { ClaudeSubscriptionAccountView } from '@shared/claudeSubscription/claudeSubscription.contract'
import type { LlmEffort } from '@maestro-shared/coach.api'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { claudeSubscriptionStore as claude } from '../claudeSubscription.store'
import { workbenchStore as workbench } from '../workbench.store'
import './WorkbenchConfigurationView.less'

const newAccountLabel = ref('')
const renameLabel = ref('')
const authorizationCode = ref('')

const copy = computed(() => i18nHelper.maestroConfiguration)
const snapshot = computed(() => claude.snapshot)
const selectedAccount = computed(() => claude.selectedAccount)
const localGroup = computed(() =>
  workbench.llmProviderGroups.find((group) => group.provider === 'local'),
)
const localModels = computed(() => localGroup.value?.models || [])
const localModel = computed(() => {
  if (workbench.llmConfig?.provider === 'local') return workbench.activeLlmModel
  return localModels.value[0]
})
const localModelValue = computed(() => localModel.value?.model || '')
const localEffortValue = computed(() =>
  workbench.llmConfig?.provider === 'local'
    ? workbench.llmConfig.effort
    : localModel.value?.effort || 'high',
)
const localEfforts = computed(() => localModel.value?.efforts || [])
const localReady = computed(() => Boolean(localGroup.value?.ready))
const endpoint = computed(() => {
  const server = snapshot.value?.server
  return server
    ? `http://${server.host}:${server.port}/v1`
    : `http://127.0.0.1:${CLAUDE_SUBSCRIPTION_DEFAULT_PORT}/v1`
})

const portDraft = ref<number | undefined>(undefined)
watch(
  () => snapshot.value?.server.port,
  (port) => {
    if (typeof port === 'number' && portDraft.value === undefined) portDraft.value = port
  },
  { immediate: true },
)

const applyPort = async (): Promise<void> => {
  const port = Number(portDraft.value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return
  await claude.setServerPort(port)
}
const flow = computed(() => snapshot.value?.authFlow)

watch(
  selectedAccount,
  (account) => {
    renameLabel.value = account?.label || ''
  },
  { immediate: true },
)

watch(
  () => flow.value?.flowId,
  () => {
    authorizationCode.value = ''
  },
)

const statusLabel = (account: ClaudeSubscriptionAccountView): string =>
  copy.value.accountStatus[account.status]

const formatPlan = (account: ClaudeSubscriptionAccountView): string =>
  account.subscriptionType.toUpperCase()

const addAccount = async (): Promise<void> => {
  const label = newAccountLabel.value.trim() || `${copy.value.account} ${(snapshot.value?.accounts.length || 0) + 1}`
  if (await claude.addAccount(label)) newAccountLabel.value = ''
}

const adopt = async (slot: number): Promise<void> => {
  const label = newAccountLabel.value.trim() || `${copy.value.account} ${slot}`
  if (await claude.adoptAccount(slot, label)) newAccountLabel.value = ''
}

const adoptSlotLabel = (slot: { slot: number; initialized: boolean }): string =>
  copy.value.adoptSlot.replace('{slot}', String(slot.slot)) +
  (slot.initialized ? '' : ` · ${copy.value.adoptNotSignedIn}`)

const reconnect = async (): Promise<void> => {
  const account = selectedAccount.value
  if (account) await claude.reconnectAccount(account.id, account.label)
}

const rename = async (): Promise<void> => {
  const account = selectedAccount.value
  if (account && renameLabel.value.trim()) await claude.renameAccount(account.id, renameLabel.value)
}

const setSelectedAccountEnabled = async (value: string | number | boolean): Promise<void> => {
  const account = selectedAccount.value
  if (account) await claude.setAccountEnabled(account.id, value === true)
}

const submitCode = async (): Promise<void> => {
  if (await claude.submitAuthorizationCode(authorizationCode.value)) authorizationCode.value = ''
}

const remove = (): void => {
  const account = selectedAccount.value
  if (!account) return
  Modal.confirm({
    title: copy.value.removeTitle,
    content: copy.value.removeDescription.replace('{label}', account.label),
    okText: copy.value.remove,
    cancelText: copy.value.cancel,
    okButtonProps: { status: 'danger' },
    onOk: async () => {
      await claude.removeAccount(account.id)
    },
  })
}

const copyProfile = async (): Promise<void> => {
  if (await claude.copyCodexProfile()) Message.success(copy.value.profileCopied)
  else Message.error(copy.value.actionFailed)
}

const setLocalModel = async (model: string): Promise<void> => {
  const target = localModels.value.find((item) => item.model === model)
  if (!target) return
  await workbench.setLlmProvider('local')
  if (workbench.activeLlmModel?.model !== model) await workbench.setLlmModel(model)
}

const setLocalEffort = async (value: unknown): Promise<void> => {
  const effort = String(value) as LlmEffort
  if (!localEfforts.value.some((item) => item.id === effort)) return
  if (workbench.llmConfig?.provider !== 'local') await workbench.setLlmProvider('local')
  await workbench.setLlmEffort(effort)
}

onMounted(async () => {
  await Promise.all([claude.init(), workbench.refreshLlmConfig(), claude.loadAdoptableSlots()])
})

onBeforeUnmount(() => {
  authorizationCode.value = ''
})
</script>

<template>
  <section name="configuration" class="workbench-configuration">
    <header name="configuration__route" class="workbench-configuration__route">
      <div class="workbench-configuration__route__node">
        <span class="workbench-configuration__route__eyebrow">Codex</span>
        <strong>{{ copy.routeSource }}</strong>
      </div>
      <IconArrowRight :size="18" class="workbench-configuration__route__arrow" />
      <div class="workbench-configuration__route__node workbench-configuration__route__node--relay">
        <IconRouter :size="18" />
        <div>
          <span class="workbench-configuration__route__eyebrow">Local Responses</span>
          <code>{{ endpoint }}</code>
          <div name="configuration__endpoint__port" class="workbench-configuration__port">
            <span>{{ copy.serverPort }}</span>
            <InputNumber
              v-model="portDraft"
              name="configuration__endpoint__port-input"
              size="mini"
              :min="1024"
              :max="65535"
              :disabled="Boolean(claude.actionKey)"
              hide-button
            />
            <Button
              name="configuration__endpoint__port-apply"
              size="mini"
              :loading="claude.actionKey === 'set-port'"
              :disabled="Boolean(claude.actionKey) || portDraft === snapshot?.server.port"
              @click="applyPort"
            >
              {{ copy.applyPort }}
            </Button>
            <em>{{ copy.serverPortHint }}</em>
          </div>
        </div>
      </div>
      <IconArrowRight :size="18" class="workbench-configuration__route__arrow" />
      <div class="workbench-configuration__route__node">
        <span class="workbench-configuration__route__eyebrow">Claude CLI</span>
        <strong>{{ snapshot?.accounts.length || 0 }} {{ copy.accounts }}</strong>
      </div>
      <span
        class="workbench-configuration__route__state"
        :class="{ 'workbench-configuration__route__state--ready': localReady }"
      >
        {{ localReady ? copy.ready : copy.attention }}
      </span>
    </header>

    <div name="configuration__body" class="workbench-configuration__body">
      <div name="configuration__accounts" class="workbench-configuration__accounts">
        <div class="workbench-configuration__section-heading">
          <div>
            <span class="workbench-configuration__eyebrow">{{ copy.accountPool }}</span>
            <h2>{{ copy.claudeAccounts }}</h2>
            <p>{{ copy.accountDescription }}</p>
          </div>
          <div class="workbench-configuration__add">
            <Input
              v-model="newAccountLabel"
              name="configuration__accounts__new-label"
              size="small"
              :placeholder="copy.accountLabelPlaceholder"
              :disabled="Boolean(flow || claude.actionKey)"
              @press-enter="addAccount"
            />
            <Button
              name="configuration__accounts__add"
              size="small"
              type="primary"
              :loading="claude.actionKey === 'authorize:new'"
              :disabled="Boolean(flow || (claude.actionKey && claude.actionKey !== 'authorize:new'))"
              @click="addAccount"
            >
              <template #icon><IconPlugConnected :size="15" /></template>
              {{ copy.addAccount }}
            </Button>
          </div>
        </div>

        <div
          v-if="claude.adoptableSlots.length"
          name="configuration__adoptable"
          class="workbench-configuration__adoptable"
        >
          <div class="workbench-configuration__adoptable__head">
            <strong>{{ copy.adoptTitle }}</strong>
            <span>{{ copy.adoptHint }}</span>
          </div>
          <div class="workbench-configuration__adoptable__list">
            <div
              v-for="slot in claude.adoptableSlots"
              :key="slot.slot"
              name="configuration__adoptable__row"
              class="workbench-configuration__adoptable__row"
            >
              <code>~/.claude{{ slot.slot }}</code>
              <span>{{ adoptSlotLabel(slot) }}</span>
              <Button
                name="configuration__adoptable__adopt"
                size="mini"
                :loading="claude.actionKey === `adopt:${slot.slot}`"
                :disabled="Boolean(flow || claude.actionKey)"
                @click="adopt(slot.slot)"
              >
                {{ copy.adopt }}
              </Button>
            </div>
          </div>
        </div>

        <p name="configuration__usage-credit-note" class="workbench-configuration__usage-credit-note">
          {{ copy.usageCreditNote }}
        </p>

        <div v-if="flow" name="configuration__auth-flow" class="workbench-configuration__auth-flow">
          <div>
            <strong>{{ copy.authorization }}</strong>
            <span>{{ copy.flowStatus[flow.status] }}</span>
          </div>
          <Input
            v-if="flow.canSubmitCode"
            v-model="authorizationCode"
            name="configuration__auth-flow__code"
            size="small"
            :placeholder="copy.authorizationCode"
            @press-enter="submitCode"
          />
          <Button
            v-if="flow.canSubmitCode"
            size="small"
            type="primary"
            :loading="claude.actionKey === 'authorize:code'"
            @click="submitCode"
          >
            {{ copy.submit }}
          </Button>
          <Button size="small" :loading="claude.actionKey === 'authorize:cancel'" @click="claude.cancelAuthorization()">
            {{ copy.cancel }}
          </Button>
        </div>

        <div v-if="claude.errorCode" class="workbench-configuration__error">
          {{ copy.actionFailed }} · {{ claude.errorCode }}
        </div>

        <div name="configuration__accounts__workspace" class="workbench-configuration__accounts__workspace">
          <div name="configuration__accounts__list" class="workbench-configuration__accounts__list">
            <button
              v-for="account in snapshot?.accounts || []"
              :key="account.id"
              name="configuration__accounts__row"
              type="button"
              class="workbench-configuration__account"
              :class="{ 'workbench-configuration__account--selected': selectedAccount?.id === account.id }"
              @click="claude.selectAccount(account.id)"
            >
              <span class="workbench-configuration__account__status" :class="`workbench-configuration__account__status--${account.status}`" />
              <span class="workbench-configuration__account__identity">
                <strong>{{ account.label }}</strong>
                <span>{{ account.email || copy.emailUnavailable }}</span>
              </span>
              <span class="workbench-configuration__account__plan">{{ formatPlan(account) }}</span>
            </button>
            <Empty
              v-if="!claude.loading && !snapshot?.accounts.length"
              class="workbench-configuration__empty"
              :description="copy.noAccounts"
            />
          </div>

          <aside v-if="selectedAccount" name="configuration__account-detail" class="workbench-configuration__detail">
            <div class="workbench-configuration__detail__header">
              <div>
                <span class="workbench-configuration__eyebrow">{{ copy.selectedAccount }}</span>
                <h3>{{ selectedAccount.label }}</h3>
              </div>
              <span class="workbench-configuration__detail__status">
                {{ statusLabel(selectedAccount) }}
              </span>
            </div>
            <dl class="workbench-configuration__metadata">
              <div><dt>{{ copy.email }}</dt><dd>{{ selectedAccount.email || copy.emailUnavailable }}</dd></div>
              <div><dt>{{ copy.plan }}</dt><dd>{{ formatPlan(selectedAccount) }}</dd></div>
              <div><dt>{{ copy.activeRequests }}</dt><dd>{{ selectedAccount.activeRequests }}</dd></div>
              <div><dt>{{ copy.enabled }}</dt><dd><Switch :model-value="selectedAccount.enabled" size="small" :disabled="Boolean(claude.actionKey)" @change="setSelectedAccountEnabled" /></dd></div>
            </dl>
            <div class="workbench-configuration__rename">
              <Input v-model="renameLabel" name="configuration__account-detail__label" size="small" />
              <Button size="small" :disabled="!renameLabel.trim() || Boolean(claude.actionKey)" @click="rename">
                <template #icon><IconCheck :size="15" /></template>
                {{ copy.rename }}
              </Button>
            </div>
            <div class="workbench-configuration__detail__actions">
              <Button size="small" :loading="claude.actionKey === `test:${selectedAccount.id}`" :disabled="Boolean(claude.actionKey && claude.actionKey !== `test:${selectedAccount.id}`)" @click="claude.testAccount(selectedAccount.id)">
                <template #icon><IconRefresh :size="15" /></template>
                {{ copy.test }}
              </Button>
              <Button size="small" :loading="claude.actionKey === `authorize:${selectedAccount.id}`" :disabled="Boolean(flow || claude.actionKey)" @click="reconnect">
                {{ copy.reconnect }}
              </Button>
              <Button size="small" status="danger" :disabled="Boolean(flow || claude.actionKey)" @click="remove">
                <template #icon><IconTrash :size="15" /></template>
                {{ copy.remove }}
              </Button>
            </div>
          </aside>
        </div>
      </div>

      <aside name="configuration__local-model" class="workbench-configuration__local-model">
        <span class="workbench-configuration__eyebrow">Local provider</span>
        <h2>{{ copy.localModel }}</h2>
        <p>{{ copy.localDescription }}</p>
        <div class="workbench-configuration__local-model__status">
          <span :class="{ 'workbench-configuration__local-model__dot--ready': localReady }" class="workbench-configuration__local-model__dot" />
          {{ localReady ? copy.routeReady : copy.routeUnavailable }}
        </div>
        <!--
          Deliberately a div, not a label: a <label> re-dispatches its click to the
          control it labels, so Arco's Select opened and immediately closed again on
          every click. The <span> is a caption, not a form label.
        -->
        <div name="configuration__local-model__model" class="workbench-configuration__local-model__field">
          <span>{{ copy.model }}</span>
          <Select :model-value="localModelValue" size="small" :disabled="workbench.llmSaving" @change="(value) => setLocalModel(String(value))">
            <Option v-for="model in localModels" :key="model.model" :value="model.model">{{ model.label }}</Option>
          </Select>
        </div>
        <div name="configuration__local-model__effort" class="workbench-configuration__local-model__field">
          <span>{{ copy.effort }}</span>
          <Select :model-value="localEffortValue" size="small" :disabled="workbench.llmSaving" @change="setLocalEffort">
            <Option v-for="effort in localEfforts" :key="effort.id" :value="effort.id">{{ effort.label }}</Option>
          </Select>
        </div>
        <Button type="primary" long :loading="claude.actionKey === 'copy-profile'" @click="copyProfile">
          <template #icon><IconClipboard :size="15" /></template>
          {{ copy.copyCodexProfile }}
        </Button>
        <p class="workbench-configuration__local-model__note">{{ copy.profileNote }}</p>
      </aside>
    </div>
  </section>
</template>
