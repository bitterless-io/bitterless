import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import {
  CLAUDE_SUBSCRIPTION_SNAPSHOT_CHANGED_EVENT,
  type ClaudeAccountId,
  type ClaudeSubscriptionActionResult,
  type ClaudeSubscriptionAdoptableSlot,
  type ClaudeSubscriptionApi,
  type ClaudeSubscriptionSnapshot,
} from '@shared/claudeSubscription/claudeSubscription.contract'
import {
  parseClaudeSubscriptionActionResult,
  parseClaudeSubscriptionCopyResult,
  parseClaudeSubscriptionSnapshot,
} from '@shared/claudeSubscription/claudeSubscription.schema'

const claudeSubscription =
  createXpcRendererEmitter<ClaudeSubscriptionApi>('ClaudeSubscriptionHandler')

class ClaudeSubscriptionStore {
  snapshot: ClaudeSubscriptionSnapshot | null = null
  selectedAccountId: ClaudeAccountId | null = null
  loading = false
  actionKey = ''
  errorCode = ''
  /** ~/.claude<N> directories present on disk but not yet registered. */
  adoptableSlots: ClaudeSubscriptionAdoptableSlot[] = []
  initialized = false
  private operationGeneration = 0

  get selectedAccount() {
    return (
      this.snapshot?.accounts.find((account) => account.id === this.selectedAccountId) ||
      this.snapshot?.accounts[0]
    )
  }

  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    xpcRenderer.subscribe(CLAUDE_SUBSCRIPTION_SNAPSHOT_CHANGED_EVENT, (payload) => {
      try {
        this.applySnapshot(parseClaudeSubscriptionSnapshot(payload.params))
      } catch {
        this.errorCode = 'runtime_unavailable'
      }
    })
    this.loading = true
    try {
      this.applySnapshot(parseClaudeSubscriptionSnapshot(await claudeSubscription.getSnapshot()))
    } catch {
      this.errorCode = 'runtime_unavailable'
    } finally {
      this.loading = false
    }
  }

  selectAccount(accountId: ClaudeAccountId): void {
    this.selectedAccountId = accountId
  }

  async addAccount(label: string): Promise<boolean> {
    return await this.runAction('authorize:new', () =>
      claudeSubscription.startAuthorization({ label: label.trim() })
    )
  }

  /** Takes effect on the next service start; the running listener keeps its port. */
  async setServerPort(port: number): Promise<boolean> {
    return await this.runAction('set-port', () => claudeSubscription.setServerPort({ port }))
  }

  async loadAdoptableSlots(): Promise<void> {
    try {
      this.adoptableSlots = await claudeSubscription.listAdoptableSlots()
    } catch {
      this.adoptableSlots = []
    }
  }

  /**
   * Registers a slot that is already logged in. No browser and no re-login: the
   * credential exists, so this only verifies and records it.
   */
  async adoptAccount(slot: number, label: string): Promise<boolean> {
    const ok = await this.runAction(`adopt:${slot}`, () =>
      claudeSubscription.adoptAccount({ slot, label: label.trim() }),
    )
    await this.loadAdoptableSlots()
    return ok
  }

  async reconnectAccount(accountId: ClaudeAccountId, label: string): Promise<boolean> {
    return await this.runAction(`authorize:${accountId}`, () =>
      claudeSubscription.startAuthorization({ accountId, label })
    )
  }

  async submitAuthorizationCode(code: string): Promise<boolean> {
    const flowId = this.snapshot?.authFlow?.flowId
    if (!flowId) return false
    return await this.runAction('authorize:code', () =>
      claudeSubscription.submitAuthorizationCode({ flowId, code: code.trim() })
    )
  }

  async cancelAuthorization(): Promise<boolean> {
    const flowId = this.snapshot?.authFlow?.flowId
    if (!flowId) return false
    return await this.runAction('authorize:cancel', () =>
      claudeSubscription.cancelAuthorization({ flowId })
    )
  }

  async renameAccount(accountId: ClaudeAccountId, label: string): Promise<boolean> {
    return await this.runAction(`rename:${accountId}`, () =>
      claudeSubscription.renameAccount({ accountId, label: label.trim() })
    )
  }

  async setAccountEnabled(accountId: ClaudeAccountId, enabled: boolean): Promise<boolean> {
    return await this.runAction(`enabled:${accountId}`, () =>
      claudeSubscription.setAccountEnabled({ accountId, enabled })
    )
  }

  async testAccount(accountId: ClaudeAccountId): Promise<boolean> {
    return await this.runAction(`test:${accountId}`, () =>
      claudeSubscription.testAccount({ accountId })
    )
  }

  async removeAccount(accountId: ClaudeAccountId): Promise<boolean> {
    return await this.runAction(`remove:${accountId}`, () =>
      claudeSubscription.removeAccount({ accountId })
    )
  }

  async copyCodexProfile(): Promise<boolean> {
    const generation = ++this.operationGeneration
    this.actionKey = 'copy-profile'
    this.errorCode = ''
    try {
      const result = parseClaudeSubscriptionCopyResult(
        await claudeSubscription.copyCodexProfile(),
      )
      if (generation !== this.operationGeneration) return false
      if (!result.ok) this.errorCode = result.error.code
      return result.ok
    } catch {
      if (generation === this.operationGeneration) this.errorCode = 'profile_copy_failed'
      return false
    } finally {
      if (generation === this.operationGeneration) this.actionKey = ''
    }
  }

  private applySnapshot(snapshot: ClaudeSubscriptionSnapshot): void {
    if (this.snapshot && snapshot.revision <= this.snapshot.revision) return
    if (snapshot.authFlow?.error) this.errorCode = snapshot.authFlow.error.code
    this.snapshot = snapshot
    if (
      !this.selectedAccountId ||
      !snapshot.accounts.some((account) => account.id === this.selectedAccountId)
    ) {
      this.selectedAccountId = snapshot.accounts[0]?.id || null
    }
  }

  private async runAction(
    key: string,
    operation: () => Promise<ClaudeSubscriptionActionResult>,
  ): Promise<boolean> {
    const generation = ++this.operationGeneration
    this.actionKey = key
    this.errorCode = ''
    try {
      const result = parseClaudeSubscriptionActionResult(await operation())
      if (generation !== this.operationGeneration) return false
      this.applySnapshot(result.snapshot)
      if (!result.ok) this.errorCode = result.error.code
      return result.ok
    } catch {
      if (generation === this.operationGeneration) this.errorCode = 'runtime_unavailable'
      return false
    } finally {
      if (generation === this.operationGeneration) this.actionKey = ''
    }
  }
}

export const claudeSubscriptionStore = reactive<ClaudeSubscriptionStore>(
  new ClaudeSubscriptionStore(),
)
