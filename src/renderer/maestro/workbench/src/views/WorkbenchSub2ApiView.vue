<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Button,
  Empty,
  Input,
  InputNumber,
  Message,
  Modal,
  Table,
  TableColumn,
} from '@arco-design/web-vue'
import {
  IconClipboard,
  IconPlugConnected,
  IconRefresh,
  IconRouter,
  IconTrash,
} from '@tabler/icons-vue'
import { CLAUDE_SUBSCRIPTION_DEFAULT_PORT } from '@shared/claudeSubscription/claudeSubscription.contract'
import type { ClaudeSubscriptionAccountView } from '@shared/claudeSubscription/claudeSubscription.contract'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { claudeSubscriptionStore as claude } from '../claudeSubscription.store'
import './WorkbenchSub2ApiView.less'

const newAccountLabel = ref('')
const authorizationCode = ref('')

const copy = computed(() => i18nHelper.maestroSub2Api)
const snapshot = computed(() => claude.snapshot)
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

const usageText = (account: ClaudeSubscriptionAccountView): { text: string; tone: string } => {
  // The CLI reports a window, a status and a reset time — never a percentage — so the
  // window is shown rather than a number that would have to be invented.
  const usage = account.usage
  if (!usage) return { text: copy.value.usageUnknown, tone: 'workbench-sub2api__usage--idle' }
  const window = usage.window ? usage.window.replace(/_/gu, ' ') : ''
  const resets = usage.resetsAt
    ? ` · ${copy.value.resetsAt} ${new Date(usage.resetsAt * 1000).toLocaleString()}`
    : ''
  const overage = usage.usingOverage ? ` · ${copy.value.usingOverage}` : ''
  return {
    text: `${usage.status}${window ? ` (${window})` : ''}${resets}${overage}`,
    tone:
      usage.status === 'allowed'
        ? 'workbench-sub2api__usage--ok'
        : 'workbench-sub2api__usage--warn',
  }
}

interface Sub2ApiAccountRow {
  key: string
  id: string
  label: string
  platform: 'claude' | 'codex'
  plan: string
  usage: string
  usageTone: string
}

const accountRows = computed<Sub2ApiAccountRow[]>(() => {
  const rows: Sub2ApiAccountRow[] = (snapshot.value?.accounts || []).map((account) => {
    const usage = usageText(account)
    return {
      key: account.id,
      id: account.id,
      label: account.label,
      platform: 'claude',
      plan: account.subscriptionType.toUpperCase(),
      usage: usage.text,
      usageTone: usage.tone,
    }
  })
  // One synthetic row: the Codex upstream is a single browser-OAuth credential shared
  // with Translator, not a pool, so it has no account record to list.
  rows.push({
    key: 'codex-upstream',
    id: '',
    label: copy.value.codexAccounts,
    platform: 'codex',
    plan: codexConnected.value ? 'ChatGPT' : '—',
    usage: codexConnected.value ? copy.value.codexConnected : copy.value.codexDisconnected,
    usageTone: codexConnected.value
      ? 'workbench-sub2api__usage--ok'
      : 'workbench-sub2api__usage--warn',
  })
  return rows
})

const renameRow = async (accountId: string, label: string): Promise<void> => {
  if (label.trim()) await claude.renameAccount(accountId, label)
}

const reconnectRow = async (accountId: string, label: string): Promise<void> => {
  await claude.reconnectAccount(accountId, label)
}

const removeRow = (accountId: string, label: string): void => {
  Modal.confirm({
    title: copy.value.removeTitle,
    content: copy.value.removeDescription.replace('{label}', label),
    okText: copy.value.remove,
    cancelText: copy.value.cancel,
    okButtonProps: { status: 'danger' },
    onOk: async () => {
      await claude.removeAccount(accountId)
    },
  })
}
const codexConnected = computed(() => snapshot.value?.codexUpstream.connected === true)
/** Ready when the server is up and at least one upstream can actually serve. */
const endpointReady = computed(
  () =>
    snapshot.value?.server.state === 'ready' &&
    ((snapshot.value?.accounts.length || 0) > 0 || codexConnected.value),
)
const codexModels = computed(() => snapshot.value?.codexUpstream.models || [])

/** Shown only after a copy: telling the owner to restart Codex before there is
 *  anything to restart for is noise. */
const profileJustCopied = ref(false)

watch(
  () => flow.value?.flowId,
  () => {
    authorizationCode.value = ''
  },
)

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

const submitCode = async (): Promise<void> => {
  if (await claude.submitAuthorizationCode(authorizationCode.value)) authorizationCode.value = ''
}

const copyProfile = async (): Promise<void> => {
  if (await claude.copyCodexProfile()) {
    profileJustCopied.value = true
    Message.success(copy.value.profileCopied)
  } else {
    Message.error(copy.value.actionFailed)
  }
}

onMounted(async () => {
  await Promise.all([claude.init(), claude.loadAdoptableSlots()])
})

onBeforeUnmount(() => {
  authorizationCode.value = ''
})
</script>

<template>
  <section name="sub2api" class="workbench-sub2api">
    <!--
      The endpoint, the import guide and Bitterless's own use of the route are three
      views of one thing: an OpenAI-compatible client target. They read as a row of
      cards rather than a pipeline diagram, because the reader's next action is always
      in one of the cards.
    -->
    <section name="sub2api__client" class="workbench-sub2api__client">
      <div class="workbench-sub2api__section-heading">
        <div>
          <span class="workbench-sub2api__eyebrow">Sub2API</span>
          <h2>{{ copy.clientTitle }}</h2>
          <p>{{ copy.clientDescription }}</p>
        </div>
        <span
          class="workbench-sub2api__route__state"
          :class="{ 'workbench-sub2api__route__state--ready': endpointReady }"
        >
          {{ endpointReady ? copy.ready : copy.attention }}
        </span>
      </div>

      <div name="sub2api__client__cards" class="workbench-sub2api__cards">
        <article name="sub2api__card__endpoint" class="workbench-sub2api__card">
          <header class="workbench-sub2api__card__header">
            <IconRouter :size="18" />
            <div>
              <strong>{{ copy.endpointTitle }}</strong>
              <span>{{ copy.endpointSubtitle }}</span>
            </div>
          </header>
          <code class="workbench-sub2api__card__endpoint">{{ endpoint }}</code>
          <div name="sub2api__endpoint__port" class="workbench-sub2api__port">
            <span>{{ copy.serverPort }}</span>
            <InputNumber
              v-model="portDraft"
              name="sub2api__endpoint__port-input"
              size="mini"
              :min="1024"
              :max="65535"
              :disabled="Boolean(claude.actionKey)"
              hide-button
            />
            <Button
              name="sub2api__endpoint__port-apply"
              size="mini"
              :loading="claude.actionKey === 'set-port'"
              :disabled="Boolean(claude.actionKey) || portDraft === snapshot?.server.port"
              @click="applyPort"
            >
              {{ copy.applyPort }}
            </Button>
          </div>
          <p class="workbench-sub2api__card__note">{{ copy.serverPortHint }}</p>
          <dl class="workbench-sub2api__card__served">
            <div>
              <dt>Claude</dt>
              <dd>{{ snapshot?.accounts.length || 0 }} {{ copy.accounts }}</dd>
            </div>
            <div>
              <dt>GPT</dt>
              <dd>{{ codexConnected ? codexModels.length : 0 }} {{ copy.models }}</dd>
            </div>
          </dl>
        </article>

        <article name="sub2api__card__import" class="workbench-sub2api__card">
          <header class="workbench-sub2api__card__header">
            <IconClipboard :size="18" />
            <div>
              <strong>{{ copy.importTitle }}</strong>
              <span>{{ copy.importSubtitle }}</span>
            </div>
          </header>
          <ol class="workbench-sub2api__card__steps">
            <li>{{ copy.importStepCopy }}</li>
            <li>{{ copy.importStepPaste }}</li>
            <li>{{ copy.importStepRestart }}</li>
          </ol>
          <Button
            type="primary"
            long
            name="sub2api__card__import-copy"
            :loading="claude.actionKey === 'copy-profile'"
            @click="copyProfile"
          >
            <template #icon><IconClipboard :size="15" /></template>
            {{ copy.copyCodexProfile }}
          </Button>
          <p v-if="profileJustCopied" class="workbench-sub2api__card__restart">
            {{ copy.restartCodexNotice }}
          </p>
          <p v-else class="workbench-sub2api__card__note">{{ copy.profileNote }}</p>
        </article>

      </div>
    </section>

    <div name="sub2api__body" class="workbench-sub2api__body">
      <div name="sub2api__accounts" class="workbench-sub2api__accounts">
        <div class="workbench-sub2api__section-heading">
          <div>
            <span class="workbench-sub2api__eyebrow">{{ copy.accountPool }} · Claude</span>
            <h2>{{ copy.claudeAccounts }}</h2>
            <p>{{ copy.accountDescription }}</p>
          </div>
          <div class="workbench-sub2api__add">
            <Input
              v-model="newAccountLabel"
              name="sub2api__accounts__new-label"
              size="small"
              :placeholder="copy.accountLabelPlaceholder"
              :disabled="Boolean(flow || claude.actionKey)"
              @press-enter="addAccount"
            />
            <Button
              type="primary"
              size="small"
              name="sub2api__accounts__add"
              :loading="claude.actionKey === 'authorize:new'"
              :disabled="Boolean(flow || claude.actionKey)"
              @click="addAccount"
            >
              {{ copy.addAccount }}
            </Button>
          </div>
        </div>

        <div
          v-if="claude.adoptableSlots.length"
          name="sub2api__accounts__adoptable"
          class="workbench-sub2api__adoptable"
        >
          <strong>{{ copy.adoptTitle }}</strong>
          <p>{{ copy.adoptHint }}</p>
          <div
            v-for="slot in claude.adoptableSlots"
            :key="slot.slot"
            class="workbench-sub2api__adoptable__row"
          >
            <code>~/.claude{{ slot.slot }}</code>
            <span>{{ adoptSlotLabel(slot) }}</span>
            <Button
              size="mini"
              :loading="claude.actionKey === `adopt:${slot.slot}`"
              :disabled="Boolean(flow || claude.actionKey)"
              @click="adopt(slot.slot)"
            >
              {{ copy.adopt }}
            </Button>
          </div>
        </div>

        <p name="sub2api__usage-credit-note" class="workbench-sub2api__usage-credit-note">
          {{ copy.usageCreditNote }}
        </p>

        <div v-if="flow" name="sub2api__auth-flow" class="workbench-sub2api__auth-flow">
          <div>
            <strong>{{ copy.authorization }}</strong>
            <span>{{ copy.flowStatus[flow.status] }}</span>
          </div>
          <Input
            v-if="flow.canSubmitCode"
            v-model="authorizationCode"
            name="sub2api__auth-flow__code"
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

        <!--
          The status text for a repeat ask is identical to the first one, so without
          this the owner cannot tell "Claude wants a second code" from "Claude refused
          the one I just typed" — both look like nothing happened.
        -->
        <div
          v-if="flow && flow.canSubmitCode && flow.codeAttempt > 1"
          name="sub2api__auth-flow__retry"
          class="workbench-sub2api__auth-flow__retry"
        >
          {{ copy.codeAskedAgain }}
        </div>

        <div v-if="claude.errorCode" class="workbench-sub2api__error">
          {{ copy.actionFailed }} · {{ claude.errorCode }}
        </div>

        <Table
          name="sub2api__accounts__table"
          class="workbench-sub2api__table"
          :data="accountRows"
          :pagination="false"
          :bordered="false"
          size="small"
          row-key="key"
        >
          <template #columns>
            <TableColumn :title="copy.accountName" data-index="label">
              <template #cell="{ record }">
                <Input
                  v-if="record.platform === 'claude'"
                  :model-value="record.label"
                  size="mini"
                  :disabled="Boolean(claude.actionKey)"
                  @change="(value) => renameRow(record.id, String(value))"
                />
                <span v-else>{{ record.label }}</span>
              </template>
            </TableColumn>
            <TableColumn :title="copy.platform" data-index="platform" :width="110">
              <template #cell="{ record }">
                <span class="workbench-sub2api__platform">{{ record.platform }}</span>
              </template>
            </TableColumn>
            <TableColumn :title="copy.plan" data-index="plan" :width="110" />
            <TableColumn :title="copy.weeklyUsage" data-index="usage" :width="220">
              <template #cell="{ record }">
                <span :class="record.usageTone">{{ record.usage }}</span>
              </template>
            </TableColumn>
            <TableColumn :title="copy.operation" :width="140" fixed="right">
              <template #cell="{ record }">
                <div class="workbench-sub2api__row-actions">
                  <Button
                    size="mini"
                    :title="copy.test"
                    :disabled="record.platform !== 'claude' || Boolean(claude.actionKey)"
                    :loading="claude.actionKey === `test:${record.id}`"
                    @click="claude.testAccount(record.id)"
                  >
                    <template #icon><IconRefresh :size="14" /></template>
                  </Button>
                  <Button
                    size="mini"
                    :title="copy.reconnect"
                    :disabled="record.platform !== 'claude' || Boolean(flow || claude.actionKey)"
                    :loading="claude.actionKey === `authorize:${record.id}`"
                    @click="reconnectRow(record.id, record.label)"
                  >
                    <template #icon><IconPlugConnected :size="14" /></template>
                  </Button>
                  <Button
                    size="mini"
                    status="danger"
                    :title="copy.remove"
                    :disabled="record.platform !== 'claude' || Boolean(flow || claude.actionKey)"
                    @click="removeRow(record.id, record.label)"
                  >
                    <template #icon><IconTrash :size="14" /></template>
                  </Button>
                </div>
              </template>
            </TableColumn>
          </template>
        </Table>
      </div>

    </div>
  </section>
</template>
