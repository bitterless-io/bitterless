import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ClaudeAccountExecutionContext,
  ClaudeAccountRoutingRecord,
  ClaudeAccountSource
} from '../../src/main/claudeSubscription/claudeAccount.repository';
import type { ClaudeAccountId } from '../../src/shared/claudeSubscription/claudeSubscription.contract';

export const fakeClaudeScript = path.resolve(
  process.cwd(),
  'tests/claudeSubscription/fixtures/fake-claude-cli.mjs'
);

export const readClaudeFixture = async <T>(name: string): Promise<T> =>
  JSON.parse(
    await readFile(path.resolve(process.cwd(), 'tests/claudeSubscription/fixtures', name), 'utf8')
  ) as T;

export class FakeClaudeAccountSource implements ClaudeAccountSource {
  readonly accounts: ClaudeAccountRoutingRecord[];
  readonly contexts = new Map<ClaudeAccountId, ClaudeAccountExecutionContext>();
  readonly cooldownMarks: Array<{ accountId: ClaudeAccountId; cooldownUntil: number }> = [];
  readonly loginMarks: ClaudeAccountId[] = [];

  constructor(ids: readonly ClaudeAccountId[] = ['account-a', 'account-b']) {
    this.accounts = ids.map((id) => ({
      id,
      enabled: true,
      hasAccountContext: true,
      needsLogin: false
    }));
    ids.forEach((id) => {
      const configDirectory = `/tmp/bitterless-claude-${id}/config`;
      this.contexts.set(id, {
        configDirectory,
        secureStorageConfigDirectory: configDirectory,
        anthropicConfigDirectory: `${configDirectory}/anthropic`
      });
    });
  }

  async listRoutingAccounts(): Promise<ClaudeAccountRoutingRecord[]> {
    return this.accounts.map((account) => ({ ...account }));
  }

  async getExecutionContext(
    accountId: ClaudeAccountId
  ): Promise<ClaudeAccountExecutionContext | null> {
    return this.contexts.get(accountId) ?? null;
  }

  markNeedsLogin(accountId: ClaudeAccountId): void {
    this.loginMarks.push(accountId);
    const account = this.accounts.find((candidate) => candidate.id === accountId);
    if (account) account.needsLogin = true;
  }

  markCooldown(accountId: ClaudeAccountId, cooldownUntil: number): void {
    this.cooldownMarks.push({ accountId, cooldownUntil });
    const account = this.accounts.find((candidate) => candidate.id === accountId);
    if (account) account.cooldownUntil = cooldownUntil;
  }
}

export const parseClaudeSse = (body: string): Array<{ event?: string; data: unknown }> =>
  body
    .trim()
    .split('\n\n')
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
      const rawData = lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '';
      return {
        ...(event ? { event } : {}),
        data: rawData === '[DONE]' ? '[DONE]' : JSON.parse(rawData)
      };
    });
