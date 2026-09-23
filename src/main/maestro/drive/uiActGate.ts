import { agentDecisionRegistry } from '@main/agent/decisionRegistry.service';
import { jevJudge } from '@main/decision/jevDecision.service';
import type { AgentUiAction } from '@maestro-main/drive/replayEngine';
import type { JevChoiceAnswer } from '@shared/decision/jev.api';

/**
 * BJ3 —— `ui_act` 落地前的不可逆分级(overmind `areas/agent-runtime/decision/browser-use.html` #1)。
 *
 * 为什么这一格值得做:接口那条路本来就有确定性闸(`apiSafety.ts`:没录过的
 * POST/PUT/DELETE 一律要人确认),而界面这条路**一道都没有** —— `toolUiAct` 过去是
 * parse → run → 播报,"删除病人""立即支付"直接落地。补的是这个洞。
 *
 * 为什么不是关键词黑名单:ai-crms 的界面语言不是英文。实测 Jev 对
 * `Hapus pasien` / `Bayar sekarang` / `确认注销账户` 与英文同样准(12/12),
 * 而黑名单要按语言维护,漏一个词就漏一道闸。
 */

/** 分级。只有 `irreversible` 会拦人。 */
type Risk = 'read_only' | 'reversible_write' | 'irreversible';

const RISK_CRITERIA: Record<Risk, string> = {
  read_only: 'only reads or navigates; nothing is written',
  reversible_write: 'writes something the same UI can undo (draft, filter, selection, form field)',
  irreversible: 'deletes data, submits a payment/order, or otherwise cannot be undone from this UI'
};

/** 不过这个线就当没判出来 —— 边界上概率模型最不稳,而这一格的错误不可逆。 */
const CONFIDENCE_FLOOR = 0.7;

/**
 * 确定性先行:填写 / 勾选 / 下拉选择只改本地表单状态,**提交的是后面那一下点击**。
 * 把它们排除在外,常见路径上就不用为每个字段付一次 0.5 秒。
 *
 * 只有 `click` 与 `submit` 会真正提交,所以只有它们进闸。
 */
const needsJudgement = (action: AgentUiAction): boolean =>
  action.action === 'click' || action.action === 'submit';

/**
 * 给 Jev 一句人能读懂的话。
 *
 * 动作执行**之前**主进程只有 `selector` —— `parseAgentUiActions` 把模型给的 `ref` 丢了,
 * 而 `target:{tag,id,name}` 要等动作跑完才有。只喂 `click [data-coach-ref="e51"]` 等于没喂。
 * 所以先用 `readText` 把元素上的字读出来:它是 `Runtime.evaluate` 一次往返,
 * **不会像重拍快照那样把 ref 重编号**(重拍会先清 `data-coach-ref` 再从 e1 重排,
 * 那会让这一批还没执行的动作全部指错)。
 *
 * 读不到就照原样把 selector 交上去 —— 描述差一点由 fail-closed 兜底,不是猜一个名字。
 */
export const describeUiAction = async (
  action: AgentUiAction,
  readText: (selector: string) => Promise<string>
): Promise<string> => {
  let label = '';
  try {
    label = (await readText(action.selector)).slice(0, 120);
  } catch {
    label = '';
  }
  const target = label ? `"${label}"` : action.selector;
  const value = action.value ? ` with ${JSON.stringify(String(action.value).slice(0, 80))}` : '';
  return `${action.action} ${target}${value}`;
};

export interface UiActGateContext {
  readText: (selector: string) => Promise<string>;
  sessionId: string;
  /** 页面地址,作为判定的 state 的一部分 —— 同一句 "Delete" 在不同系统里份量不同。 */
  pageUrl?: string;
}

export type UiActGateVerdict = { ok: true } | { ok: false; error: string };

/**
 * 逐条过闸。返回 `ok:false` 时调用方**必须**一个动作都不执行。
 *
 * 三条失败方向,刻意不同:
 * · 开关关着(`reason==='off'`)→ **直接放行**。关掉开关必须等于「完全按现有流程走」,
 *   否则"关"反而比"开"更啰嗦,人会把它再打开。
 * · 判定拿不到 / confidence 不够 → **当作不可逆**,去问人(fail-closed)。
 * · 判定说不可逆 → 去问人。
 *
 * Jev 在这一格**只有否决权**:它可以把一条动作抬到"问人",不能把任何动作降级成"免问"。
 */
export const gateUiActions = async (
  actions: AgentUiAction[],
  context: UiActGateContext
): Promise<UiActGateVerdict> => {
  for (const action of actions) {
    if (!needsJudgement(action)) continue;

    const description = await describeUiAction(action, context.readText);
    const result = await jevJudge({
      state: { page_url: context.pageUrl || '', pending_action: description },
      questions: {
        risk: {
          type: 'choice',
          instructions: 'Classify what this single UI action does to the application state once it lands.',
          criteria: RISK_CRITERIA
        }
      }
    });

    // 开关关着 = 这一格不存在。不能让它变成"拿不到判定所以问人"。
    if (result.ok === false && result.reason === 'off') return { ok: true };

    const answer = result.ok ? (result.answers.risk as JevChoiceAnswer | undefined) : undefined;
    const undecided = !answer || typeof answer.choice !== 'string' || (answer.confidence ?? 0) < CONFIDENCE_FLOOR;
    const risk: Risk = undecided ? 'irreversible' : (answer.choice as Risk);
    if (risk !== 'irreversible') continue;

    const why =
      result.ok === false
        ? `Jev could not judge it (${result.reason}: ${result.message})`
        : undecided
          ? `Jev was not confident enough (${answer?.confidence ?? 0})`
          : `Jev classified it as irreversible (${answer?.confidence ?? 0})`;

    const answerFromHuman = await agentDecisionRegistry.request(context.sessionId, [
      {
        header: 'Irreversible',
        question: `Run this action?\n${description}\n\n${why}`,
        options: [
          { label: 'Run it', description: 'Perform this action on the page now.' },
          { label: 'Stop', description: 'Do not perform it; the agent gets a failure and can pick another route.' }
        ]
      }
    ]);

    // `picked` 是「每问一组选中项」;取消 ≠ 停止(它只表示人不回答),
    // 但在这一格里**不回答只能当作不批准** —— 这是唯一一处错误不可逆的地方。
    const picked = answerFromHuman?.picked?.[0]?.[0] ?? '';
    if (answerFromHuman?.cancelled || !picked.startsWith('Run')) {
      return { ok: false, error: `ERROR: operator did not approve ${description} — ${why}` };
    }
  }
  return { ok: true };
};
