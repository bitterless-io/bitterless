import type { GmgnCliService, GmgnReadResult } from '../resources/gmgnCli.service';
import { GmgnReadError } from '../resources/gmgnCli.service';
import { coinCandidateChains, gmgnTokenInfoIdentityOutcome } from '@shared/coin/coinAddress';
import type { TrenchChain } from '@shared/trench/trench.type';
import {
  TRENCH_INDEX_CHANGED_EVENT,
  type TrenchIndexAddTargetInput,
  type TrenchIndexChangedEvent,
  type TrenchIndexCommandReceipt,
  type TrenchIndexError,
  type TrenchIndexReanalyzeInput,
  type TrenchIndexResult,
  type TrenchIndexStorageBeginRunResult,
  type TrenchIndexWorkspaceSnapshot,
} from '@shared/trench/trenchIndex.type';
import {
  canonicalizeIndexAddress,
  parseTrenchIndexWorkspaceSnapshot,
  trenchIndexRequestFingerprint,
} from '@shared/trench/trenchIndex.validation';
import {
  normalizeTrenchTokenInfo,
  normalizeTrenchTraderCandidates,
  rankTrenchIndexWallets,
  TrenchIndexSourceError,
} from './trenchIndex.normalize';
import {
  TRENCH_PERSON_CHANGED_EVENT,
  type TrenchPersonChangedEvent,
} from '@shared/trench/trenchPerson.type';

interface TrenchIndexStoragePort {
  getWorkspace(): Promise<TrenchIndexResult<TrenchIndexWorkspaceSnapshot>>;
  addTargetsAndBeginRun(
    input: Parameters<import('@shared/trench/trenchIndex.type').TrenchIoRuntimeApi['addTargetsAndBeginRun']>[0]['request'],
  ): Promise<TrenchIndexResult<TrenchIndexStorageBeginRunResult>>;
  beginRun(
    input: Parameters<import('@shared/trench/trenchIndex.type').TrenchIoRuntimeApi['beginRun']>[0]['request'],
  ): Promise<TrenchIndexResult<TrenchIndexStorageBeginRunResult>>;
  completeRun(
    input: Parameters<import('@shared/trench/trenchIndex.type').TrenchIoRuntimeApi['completeRun']>[0]['request'],
  ): Promise<TrenchIndexResult<{ revision: number }>>;
  failRun(
    input: Parameters<import('@shared/trench/trenchIndex.type').TrenchIoRuntimeApi['failRun']>[0]['request'],
  ): Promise<TrenchIndexResult<{ revision: number }>>;
}

interface TrenchIndexOrchestratorDependencies {
  storage: TrenchIndexStoragePort;
  gmgn: Pick<GmgnCliService, 'read'>;
  broadcast(eventName: string, value: TrenchIndexChangedEvent | TrenchPersonChangedEvent): void;
  now?: () => number;
}

interface ResolvedTarget {
  chain: TrenchChain;
  canonicalAddress: string;
  info: GmgnReadResult;
}

const failure = <T>(error: TrenchIndexError): TrenchIndexResult<T> => ({ ok: false, error });

const publicError = (error: unknown): TrenchIndexError => {
  if (error instanceof TrenchIndexSourceError) return { code: error.code, message: error.message };
  if (error instanceof GmgnReadError) {
    return {
      code: 'PROVIDER_UNAVAILABLE',
      message: ['cli-missing', 'key-missing'].includes(error.code)
        ? 'Configure the read-only GMGN CLI before running Trench INDEX.'
        : 'GMGN could not complete the bounded read-only analysis.',
    };
  }
  const candidate = error as Partial<TrenchIndexError> | null;
  if (candidate && typeof candidate.code === 'string' && typeof candidate.message === 'string') {
    return candidate as TrenchIndexError;
  }
  return { code: 'INTERNAL', message: 'Trench INDEX analysis failed.' };
};

export class TrenchIndexOrchestrator {
  private readonly now: () => number;
  private readonly analyses = new Map<string, Promise<void>>();

  constructor(private readonly dependencies: TrenchIndexOrchestratorDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  async getWorkspace(): Promise<TrenchIndexResult<TrenchIndexWorkspaceSnapshot>> {
    try {
      const workspace = await this.dependencies.storage.getWorkspace();
      return workspace.ok
        ? { ok: true, value: parseTrenchIndexWorkspaceSnapshot(workspace.value) }
        : workspace;
    } catch {
      return failure({ code: 'STORAGE_UNAVAILABLE', message: 'Trench storage is unavailable.' });
    }
  }

  async addTargets(
    input: TrenchIndexAddTargetInput,
  ): Promise<TrenchIndexResult<TrenchIndexCommandReceipt>> {
    try {
      const workspace = await this.requireWorkspace();
      if (workspace.jobState === 'running') {
        return failure({
          code: 'ANALYSIS_BUSY',
          message: 'Trench INDEX is already analyzing the active target set.',
        });
      }
      const resolvedTargets: ResolvedTarget[] = [];
      for (const target of input.targets) {
        resolvedTargets.push(await this.resolveTarget(
          target.contractAddress,
          target.chain ?? 'auto',
        ));
      }
      const identities = new Map<string, ResolvedTarget>();
      for (const target of resolvedTargets) {
        const identity = `${target.chain}:${target.canonicalAddress}`;
        if (!identities.has(identity)) identities.set(identity, target);
      }
      const targets = [...identities.values()].map((resolved) => {
        const previousHighest = workspace.chainProjections.flatMap(({ targets }) => targets)
          .find(({ chain, canonicalAddress }) =>
          chain === resolved.chain && canonicalAddress === resolved.canonicalAddress)
          ?.highestMarketCapUsd ?? null;
        return {
          chain: resolved.chain,
          contractAddress: resolved.canonicalAddress,
          canonicalAddress: resolved.canonicalAddress,
          metadata: normalizeTrenchTokenInfo(resolved.info, previousHighest),
        };
      }).sort((left, right) => left.chain.localeCompare(right.chain) ||
        left.canonicalAddress.localeCompare(right.canonicalAddress));
      const fingerprint = trenchIndexRequestFingerprint(
        'add-target',
        targets.flatMap(({ chain, canonicalAddress }) => [chain, canonicalAddress]),
      );
      const begun = await this.dependencies.storage.addTargetsAndBeginRun({
        requestId: input.requestId,
        requestFingerprint: fingerprint,
        targets,
      });
      if (!begun.ok) return begun;
      this.changed(begun.value.revision, begun.value.status === 'running' ? 'running' : 'idle');
      const analysisStarted = !begun.value.replayed && begun.value.status === 'running';
      if (analysisStarted) this.startAnalysis(begun.value);
      return {
        ok: true,
        value: {
          requestId: input.requestId,
          runId: begun.value.runId,
          revision: begun.value.revision,
          targetPersistedCount: targets.length,
          analysisStarted,
          replayed: begun.value.replayed,
        },
      };
    } catch (error) {
      return failure(publicError(error));
    }
  }

  async reanalyze(
    input: TrenchIndexReanalyzeInput,
  ): Promise<TrenchIndexResult<TrenchIndexCommandReceipt>> {
    try {
      const fingerprint = trenchIndexRequestFingerprint('reanalyze', []);
      const begun = await this.dependencies.storage.beginRun({
        requestId: input.requestId,
        requestFingerprint: fingerprint,
        trigger: 'reanalyze',
      });
      if (!begun.ok) return begun;
      this.changed(begun.value.revision, begun.value.status === 'running' ? 'running' : 'idle');
      const analysisStarted = !begun.value.replayed && begun.value.status === 'running';
      if (analysisStarted) this.startAnalysis(begun.value);
      return {
        ok: true,
        value: {
          requestId: input.requestId,
          runId: begun.value.runId,
          revision: begun.value.revision,
          targetPersistedCount: 0,
          analysisStarted,
          replayed: begun.value.replayed,
        },
      };
    } catch (error) {
      return failure(publicError(error));
    }
  }

  async waitForIdle(): Promise<void> {
    await Promise.all([...this.analyses.values()]);
  }

  private async resolveTarget(
    address: string,
    requestedChain: 'auto' | TrenchChain,
  ): Promise<ResolvedTarget> {
    const chains = requestedChain === 'auto'
      ? coinCandidateChains(address)
      : [requestedChain];
    if (chains.length === 0) {
      throw { code: 'INVALID_INPUT', message: 'Enter one exact Solana or EVM contract address.' };
    }
    const probes: ResolvedTarget[] = [];
    for (const chain of chains) {
      const canonicalAddress = canonicalizeIndexAddress(address, chain, 'contractAddress');
      const info = await this.dependencies.gmgn.read({
        operation: 'token-info',
        chain,
        address: canonicalAddress,
      });
      const identity = gmgnTokenInfoIdentityOutcome(info.data, chain, canonicalAddress);
      if (identity === 'provider-error') {
        throw new TrenchIndexSourceError('GMGN token-info did not contain an exact address proof.');
      }
      if (identity === 'match') probes.push({ chain, canonicalAddress, info });
    }
    if (probes.length === 0) {
      throw { code: 'TOKEN_NOT_FOUND', message: 'GMGN did not find this contract address.' };
    }
    if (probes.length > 1) {
      throw {
        code: 'CHAIN_AMBIGUOUS',
        message: 'The EVM contract address matched more than one supported chain.',
        chains: probes.map(({ chain }) => chain),
      };
    }
    return probes[0]!;
  }

  private startAnalysis(run: TrenchIndexStorageBeginRunResult): void {
    const analysis = this.performAnalysis(run).finally(() => {
      this.analyses.delete(run.runId);
    });
    this.analyses.set(run.runId, analysis);
    void analysis;
  }

  private async performAnalysis(run: TrenchIndexStorageBeginRunResult): Promise<void> {
    let failedTargetId: string | null = null;
    try {
      const workspace = await this.requireWorkspace();
      const targets = [];
      for (const target of run.targets) {
        failedTargetId = target.targetId;
        const info = await this.dependencies.gmgn.read({
          operation: 'token-info',
          chain: target.chain,
          address: target.contractAddress,
        });
        if (gmgnTokenInfoIdentityOutcome(info.data, target.chain, target.canonicalAddress) !== 'match') {
          throw new TrenchIndexSourceError('GMGN token-info identity changed during analysis.');
        }
        const traders = await this.dependencies.gmgn.read({
          operation: 'token-traders',
          chain: target.chain,
          address: target.contractAddress,
          orderBy: 'profit',
          direction: 'desc',
          limit: 100,
        });
        const previousHighest = workspace.chainProjections.flatMap(({ targets }) => targets)
          .find(({ targetId }) => targetId === target.targetId)
          ?.highestMarketCapUsd ?? null;
        targets.push({
          targetId: target.targetId,
          chain: target.chain,
          contractAddress: target.contractAddress,
          metadata: normalizeTrenchTokenInfo(info, previousHighest),
          candidates: normalizeTrenchTraderCandidates(traders, target.chain),
        });
      }
      failedTargetId = null;
      const completedAt = Math.max(
        this.now(),
        ...targets.map(({ metadata }) => metadata.observedAt),
      );
      const completed = await this.dependencies.storage.completeRun({
        runId: run.runId,
        observedAt: completedAt,
        targets,
        wallets: rankTrenchIndexWallets(targets),
      });
      if (!completed.ok) throw completed.error;
      this.changed(completed.value.revision, 'idle');
      this.dependencies.broadcast(TRENCH_PERSON_CHANGED_EVENT, {
        schema: 'bl-trench-person-changed-v1',
        revision: completed.value.revision,
      });
    } catch (error) {
      const failed = await this.dependencies.storage.failRun({
        runId: run.runId,
        targetId: failedTargetId,
        error: publicError(error),
        failedAt: this.now(),
      }).catch(() => null);
      if (failed?.ok) this.changed(failed.value.revision, 'idle');
    }
  }

  private async requireWorkspace(): Promise<TrenchIndexWorkspaceSnapshot> {
    const workspace = await this.dependencies.storage.getWorkspace();
    if (!workspace.ok) throw workspace.error;
    return parseTrenchIndexWorkspaceSnapshot(workspace.value);
  }

  private changed(revision: number, jobState: TrenchIndexChangedEvent['jobState']): void {
    this.dependencies.broadcast(TRENCH_INDEX_CHANGED_EVENT, {
      schema: 'bl-trench-index-changed-v1',
      revision,
      jobState,
    });
  }
}
