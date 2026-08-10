import { TRENCH_AGENT_SKILL_VERSION_CODE } from '@shared/trench/trenchAgentSkillVersion.shared';
import { resolveTrenchAgentGuideInfo } from '@shared/trench/trenchAgentGuide.shared';
import type {
  TrenchAgentGuideClient,
  TrenchAgentGuideClipboard,
  TrenchAgentGuideCopyKind,
  TrenchAgentGuideState,
} from './trenchAgentGuide.type';

const createCopyStates = (): TrenchAgentGuideState['copyStates'] => ({
  complete: 'idle',
  helper: 'idle',
  config: 'idle',
  skill: 'idle',
});

export class TrenchAgentGuideStore implements TrenchAgentGuideState {
  visible = false;
  phase: TrenchAgentGuideState['phase'] = 'idle';
  info: TrenchAgentGuideState['info'] = null;
  mismatchReason: TrenchAgentGuideState['mismatchReason'] = null;
  copyStates = createCopyStates();

  private requestGeneration = 0;

  constructor(
    private readonly client: TrenchAgentGuideClient,
    private readonly clipboard: TrenchAgentGuideClipboard,
  ) {}

  open(): void {
    this.visible = true;
    void this.load();
  }

  close(): void {
    this.visible = false;
  }

  async load(): Promise<void> {
    const generation = ++this.requestGeneration;
    this.phase = 'loading';
    this.info = null;
    this.mismatchReason = null;
    this.copyStates = createCopyStates();

    let response: unknown;
    try {
      response = await this.client.getIntegrationInfo();
    } catch {
      if (generation !== this.requestGeneration) return;
      this.phase = 'error';
      return;
    }
    if (generation !== this.requestGeneration) return;

    const resolved = resolveTrenchAgentGuideInfo(
      response,
      TRENCH_AGENT_SKILL_VERSION_CODE,
    );
    if (resolved.status === 'restart-required') {
      this.phase = 'restart-required';
      this.mismatchReason = resolved.reason;
      return;
    }

    this.info = resolved.info;
    this.phase = 'ready';
  }

  async copy(kind: TrenchAgentGuideCopyKind): Promise<boolean> {
    if (this.phase !== 'ready' || !this.info) return false;
    const text = {
      complete: this.info.instruction,
      helper: this.info.commandPath,
      config: this.info.configJson,
      skill: this.info.skillPath,
    }[kind];

    try {
      await this.clipboard.writeText(text);
      this.copyStates[kind] = 'copied';
      return true;
    } catch {
      this.copyStates[kind] = 'failed';
      return false;
    }
  }
}
