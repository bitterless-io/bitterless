<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Button,
  Empty,
  Input,
  InputNumber,
  Message,
  Modal,
  TabPane,
  Table,
  TableColumn,
  Tabs,
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
import { workbenchStore as workbench } from '../workbench.store'
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

const homePrefix = computed(() => {
  // Derived from an account's own path rather than assumed: the directory is built by
  // main from the real home, which a test or a relocated profile can move.
  const sample = snapshot.value?.accounts.find((account) => account.directory)?.directory
  const match = sample ? /^(.*)\/\.claude\d+$/u.exec(sample) : null
  return match?.[1] ?? '~'
})

const statusLabelOf = (account: ClaudeSubscriptionAccountView): string =>
  copy.value.accountStatus[account.status]

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
  /** `~/.claude<N>` — the signed-in environment this account is bound to. */
  directory: string
  active: boolean
  activeLabel: string
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
      // Shown because an account can arrive two ways — a fresh sign-in or adopting an
      // already signed-in ~/.claude<N> — and the directory is what tells them apart.
      directory: account.directory ? account.directory.replace(homePrefix.value, '~') : '—',
      // The designated account, not "busy right now". One account per platform carries
      // every turn; selection follows weekly quota, so this moves on its own when the
      // active account runs low.
      active: account.active === true,
      activeLabel: account.active === true
        ? `${copy.value.activeNow}${account.activeRequests > 0 ? ` · ${account.activeRequests}` : ''}`
        : statusLabelOf(account),
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
    // A browser-OAuth credential, not a slot directory.
    directory: '—',
    active: false,
    activeLabel: codexConnected.value ? copy.value.codexReady : copy.value.codexDisconnected,
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
/** Turns in flight on the active account. Unlimited, so the live count is the fact. */
const claudeConcurrency = computed(
  () => snapshot.value?.accounts.reduce((total, account) => total + account.activeRequests, 0) || 0,
)

const endpointReady = computed(
  () =>
    snapshot.value?.server.state === 'ready' &&
    ((snapshot.value?.accounts.length || 0) > 0 || codexConnected.value),
)
const codexModels = computed(() => snapshot.value?.codexUpstream.models || [])
const codexAccounts = computed(() => snapshot.value?.codexUpstream.accounts || [])
const codexLabel = ref('')

/**
 * Saves the credential the Codex login just wrote under a name.
 *
 * Sign-in still produces one credential at a time — that is pi's flow, not a choice
 * here — so a pool is built by capturing after each sign-in rather than by holding
 * several logins open at once.
 */
const captureCodex = async (): Promise<void> => {
  const label = codexLabel.value.trim() || `ChatGPT ${codexAccounts.value.length + 1}`
  if (await claude.captureCodexAccount(label)) codexLabel.value = ''
}

/** Shown only after a copy: telling the owner to restart Codex before there is
 *  anything to restart for is noise. */
const profileJustCopied = ref(false)

watch(
  () => flow.value?.flowId,
  () => {
    authorizationCode.value = ''
  },
)

const addAccountOpen = ref(false)
const addAccountTab = ref('adopt')
const codexLoggingIn = ref(false)

const openAddAccount = async (): Promise<void> => {
  addAccountOpen.value = true
  // Refreshed on open: the owner may have signed into a ~/.claude<N> from a terminal
  // since the panel last looked, and adoption is the one path that needs no login.
  await claude.loadAdoptableSlots()
}

const addClaudeFromModal = async (): Promise<void> => {
  const label =
    newAccountLabel.value.trim() || `${copy.value.account} ${(snapshot.value?.accounts.length || 0) + 1}`
  if (await claude.addAccount(label)) {
    newAccountLabel.value = ''
    // Left open: the authorization flow renders in the panel behind it, and closing
    // here would hide the code prompt the owner has to answer.
    addAccountOpen.value = false
  }
}

const adoptFromModal = async (slot: number): Promise<void> => {
  const label = newAccountLabel.value.trim() || `${copy.value.account} ${slot}`
  if (await claude.adoptAccount(slot, label)) {
    newAccountLabel.value = ''
    addAccountOpen.value = false
  }
}

const connectCodex = async (): Promise<void> => {
  codexLoggingIn.value = true
  try {
    await workbench.loginLlmProvider('openai-codex', 'browser')
    Message.success(copy.value.addCodexStarted)
  } catch {
    Message.error(copy.value.actionFailed)
  } finally {
    codexLoggingIn.value = false
  }
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
            <div>
              <dt>{{ copy.concurrency }}</dt>
              <dd :title="copy.concurrencyHint">{{ claudeConcurrency }}</dd>
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
          <Button
            type="primary"
            size="small"
            name="sub2api__accounts__add"
            :disabled="Boolean(flow || claude.actionKey)"
            @click="openAddAccount"
          >
            {{ copy.addAccount }}
          </Button>
        </div>

        <Modal
          v-model:visible="addAccountOpen"
          :title="copy.addAccountTitle"
          :footer="false"
          width="560px"
        >
          <Tabs v-model:active-key="addAccountTab" size="small">
            <!--
              Tabs rather than a stacked list: the three are different acts, not
              variants of one. Adoption reuses a credential that already exists,
              signing in creates one, and Codex is a different subscription entirely —
              stacked, the cheapest path (adoption needs no login) sat below the fold.
            -->
            <TabPane key="adopt" :title="copy.addAdoptTitle">
              <div class="workbench-sub2api__add-account">
                <p class="workbench-sub2api__card__note">{{ copy.addAdoptHint }}</p>
                <div v-if="claude.adoptableSlots.length" class="workbench-sub2api__adoptable">
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
                      :disabled="!slot.initialized || Boolean(flow || claude.actionKey)"
                      @click="adoptFromModal(slot.slot)"
                    >
                      {{ copy.adopt }}
                    </Button>
                  </div>
                </div>
                <p v-else class="workbench-sub2api__card__note">{{ copy.addAdoptEmpty }}</p>
              </div>
            </TabPane>

            <TabPane key="claude" :title="copy.addClaudeTitle">
              <div class="workbench-sub2api__add-account">
                <p class="workbench-sub2api__card__note">{{ copy.addClaudeHint }}</p>
                <div class="workbench-sub2api__add">
                  <Input
                    v-model="newAccountLabel"
                    name="sub2api__accounts__new-label"
                    size="small"
                    :placeholder="copy.accountLabelPlaceholder"
                    :disabled="Boolean(flow || claude.actionKey)"
                    @press-enter="addClaudeFromModal"
                  />
                  <Button
                    type="primary"
                    size="small"
                    :loading="claude.actionKey === 'authorize:new'"
                    :disabled="Boolean(flow || claude.actionKey)"
                    @click="addClaudeFromModal"
                  >
                    {{ copy.addClaudeAction }}
                  </Button>
                </div>
              </div>
            </TabPane>

            <TabPane key="codex" :title="copy.addCodexTitle">
              <div class="workbench-sub2api__add-account">
                <p class="workbench-sub2api__card__note">{{ copy.addCodexHint }}</p>
                <div class="workbench-sub2api__add-account__codex">
                  <span
                    class="workbench-sub2api__local-model__dot"
                    :class="{ 'workbench-sub2api__local-model__dot--ready': codexConnected }"
                  />
                  <span>{{ codexConnected ? copy.codexConnected : copy.codexDisconnected }}</span>
                  <Button
                    size="small"
                    :loading="codexLoggingIn"
                    :disabled="codexLoggingIn"
                    @click="connectCodex"
                  >
                    {{ codexConnected ? copy.addCodexReconnect : copy.addCodexAction }}
                  </Button>
                </div>
                <div class="workbench-sub2api__add">
                  <Input
                    v-model="codexLabel"
                    size="small"
                    :placeholder="copy.addCodexLabelPlaceholder"
                    :disabled="!codexConnected || Boolean(claude.actionKey)"
                    @press-enter="captureCodex"
                  />
                  <Button
                    type="primary"
                    size="small"
                    :loading="claude.actionKey === 'codex:capture'"
                    :disabled="!codexConnected || Boolean(claude.actionKey)"
                    @click="captureCodex"
                  >
                    {{ copy.addCodexSave }}
                  </Button>
                </div>
                <p class="workbench-sub2api__card__note">{{ copy.addCodexSaveHint }}</p>

                <div v-if="codexAccounts.length" class="workbench-sub2api__adoptable">
                  <div
                    v-for="account in codexAccounts"
                    :key="account.id"
                    class="workbench-sub2api__adoptable__row"
                  >
                    <span
                      class="workbench-sub2api__local-model__dot"
                      :class="{ 'workbench-sub2api__local-model__dot--ready': account.active }"
                    />
                    <span>{{ account.label }}</span>
                    <Button
                      size="mini"
                      :disabled="account.active || Boolean(claude.actionKey)"
                      :loading="claude.actionKey === `codex:activate:${account.id}`"
                      @click="claude.activateCodexAccount(account.id)"
                    >
                      {{ account.active ? copy.activeNow : copy.addCodexActivate }}
                    </Button>
                    <Button
                      size="mini"
                      status="danger"
                      :disabled="Boolean(claude.actionKey)"
                      :loading="claude.actionKey === `codex:remove:${account.id}`"
                      @click="claude.removeCodexAccount(account.id)"
                    >
                      <template #icon><IconTrash :size="13" /></template>
                    </Button>
                  </div>
                </div>
              </div>
            </TabPane>
          </Tabs>
        </Modal>

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
            <TableColumn :title="copy.adoptColumn" data-index="directory" :width="150">
              <template #cell="{ record }">
                <code class="workbench-sub2api__directory">{{ record.directory }}</code>
              </template>
            </TableColumn>
            <TableColumn :title="copy.activeColumn" data-index="active" :width="130">
              <template #cell="{ record }">
                <span
                  class="workbench-sub2api__active"
                  :class="{ 'workbench-sub2api__active--on': record.active }"
                >
                  {{ record.activeLabel }}
                </span>
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
