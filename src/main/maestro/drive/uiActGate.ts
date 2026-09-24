import { agentDecisionRegistry } from '@main/agent/decisionRegistry.service';
import { decisionHelper } from '@main/decision/decisionHelper';
import type { AgentUiAction } from '@maestro-main/drive/replayEngine';

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

/**
 * 确定性先行:填写 / 勾选 / 下拉选择只改本地表单状态,**提交的是后面那一下点击**。
 * 把它们排除在外,常见路径上就不用为每个字段付一次 0.5 秒。
 *
 * 只有 `click` 与 `submit` 会真正提交,所以只有它们进闸。
 */
const needsJudgement = (action: AgentUiAction): boolean =>
  action.action === 'click' || action.action === 'submit';

/**
 * 审批卡片上的元素截图(docs/features/decision-maker-naming-and-approval-card.md #4.1)。
 * 最长边 240:卡片的显示框是 120×120,两倍才在高清屏上清楚。最多等 2 秒:截不出来(从未显示过的
 * tab 就可能)就不带图 —— 截图永远不能挡住审批,也不能变成一条新的失败路径。
 */
const SHOT_MAX_EDGE = 240;
const SHOT_TIMEOUT_MS = 2_000;

/** 标签读不到时卡片上写什么 —— 是哪一个元素由截图说明(#4.1)。闸只判 click / submit。 */
const UNLABELLED: Partial<Record<AgentUiAction['action'], string>> = {
  click: 'click this element',
  submit: 'submit this form'
};

export interface UiActionDescription {
  /** 给 decision maker 与模型:标签,读不到就是选择器 —— 它们看不到图,选择器至少能对上 ref。 */
  text: string;
  /**
   * 给人看的卡片:标签,读不到就写「click this element」—— 人看不懂 `click [data-coach-ref="e25"]`。
   * 只在**有截图**时用它;没图时卡片退回 `text`(见 `gateUiActions`)。
   */
  shown: string;
}

/**
 * 给 decision maker 和人各一句读得懂的话。
 *
 * 动作执行**之前**主进程只有 `selector` —— `parseAgentUiActions` 把模型给的 `ref` 丢了,
 * 而 `target:{tag,id,name}` 要等动作跑完才有。只喂 `click [data-coach-ref="e51"]` 等于没喂。
 * 所以先用 `readLabel` 把元素上的标签读出来:它是 `Runtime.evaluate` 一次往返,
 * **不会像重拍快照那样把 ref 重编号**(重拍会先清 `data-coach-ref` 再从 e1 重排,
 * 那会让这一批还没执行的动作全部指错)。不能用 `readText`:它对 `<button>` 读的是 `.value`
 * (默认空串),于是描述回落成选择器(docs/issues/approval-card-shows-selector-instead-of-button-text.md)。
 *
 * 读不到就照原样把 selector 交给判定和模型 —— 描述差一点由 fail-closed 兜底,不是猜一个名字;
 * 卡片上则写「click this element」,由截图说明是哪一个(没截到图时卡片仍显示 selector)。
 */
export const describeUiAction = async (
  action: AgentUiAction,
  readLabel: (selector: string) => Promise<string>
): Promise<UiActionDescription> => {
  let label = '';
  try {
    label = (await readLabel(action.selector)).slice(0, 120);
  } catch {
    label = '';
  }
  const target = label ? `"${label}"` : action.selector;
  const value = action.value ? ` with ${JSON.stringify(String(action.value).slice(0, 80))}` : '';
  const text = `${action.action} ${target}${value}`;
  const unlabelled = UNLABELLED[action.action];
  return { text, shown: label || !unlabelled ? text : `${unlabelled}${value}` };
};

export interface UiActGateContext {
  /** 目标元素上人看得见的标签(`ReplayEngine.readLabel`)。 */
  readLabel: (selector: string) => Promise<string>;
  /**
   * 目标元素的截图(data URL),只在要问人时才调。没接就不带图。
   * 必须打在**这一次 ui_act 绑定的 tab** 上 —— 绑定是调用方的事,闸不认识 tab。
   * `signal` 在 2 秒到点时中止:回调必须在真正截图之前看它,迟到的截图**不再执行**(#4.1)。
   */
  shootTarget?: (
    selector: string,
    shot: { maxEdge: number; signal: AbortSignal }
  ) => Promise<string | undefined>;
  sessionId: string;
  /** 页面地址,作为判定的 state 的一部分 —— 同一句 "Delete" 在不同系统里份量不同。 */
  pageUrl?: string;
}

/**
 * 最多等 `SHOT_TIMEOUT_MS`;超时、抛错、拿回来的不是图片 data URL → 不带图。
 *
 * 到点不只是「不再等」:同时中止 `signal`。定位最多会轮询 6 秒,不打这个标记的话,它回来之后照样会去
 * 截图 —— 那时人可能已经点了批准,截图就落在批准后的点击进行中(审查 F2)。
 */
const shootWithin = async (
  shoot: UiActGateContext['shootTarget'],
  selector: string
): Promise<string | undefined> => {
  if (!shoot) return undefined;
  const expired = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      expired.abort();
      resolve(undefined);
    }, SHOT_TIMEOUT_MS);
  });
  try {
    const shot = shoot(selector, { maxEdge: SHOT_MAX_EDGE, signal: expired.signal }).catch(
      () => undefined
    );
    const image = await Promise.race([shot, late]);
    return typeof image === 'string' && image.startsWith('data:image/') ? image : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};

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

    const { text: description, shown } = await describeUiAction(action, context.readLabel);
    // 默认阈值 0.5:大于它才采信分级,等于或低于就当没判出来。Ral 2026-09-23:「confidence 大于 0.5 都不需要
    // 人工去 confirm」—— 原来是 0.7,把 `Cari`(0.65)这类只读操作也推给了人。
    const outcome = await decisionHelper.choose(
      {
        name: 'risk',
        instructions: 'Classify what this single UI action does to the application state once it lands.',
        criteria: RISK_CRITERIA
      },
      { page_url: context.pageUrl || '', pending_action: description }
    );

    // 开关关着 = 这一格不存在。不能让它变成"拿不到判定所以问人"。
    if (outcome.decided === false && outcome.reason === 'off') return { ok: true };

    // 判不了、把握不够,都当作不可逆去问人 —— fail-closed 是这道闸的决定,不在 helper 里。
    // 判成 `irreversible` 的照样要问,与置信度无关。判成了的 `value` 一定是 `RISK_CRITERIA` 的一个键:
    // 意料之外的 choice(比如 `Irreversible`)helper 判 invalid,于是走上面那条问人(#3)。
    const risk: Risk = outcome.decided ? (outcome.value as Risk) : 'irreversible';
    if (risk !== 'irreversible') continue;

    // 会话里一律叫 decision maker,不出现 Jev —— 这句会上卡片,也会随下面的 ERROR 回到模型,
    // 被模型转述给人(docs/features/decision-maker-naming-and-approval-card.md #1 #2)。
    // 判不了时,卡片和回给模型的 ERROR 只写失败类型和 HTTP 状态(#2,审查 F6):relay 的原始报错体可能带着
    // jev 字样,原文只进日志(服务与 helper 各记一条)。
    // 没过阈值(`low-confidence`)也算答了。
    const answered = outcome.decided === true || outcome.reason === 'low-confidence';
    const why = !answered
      ? `The decision maker could not judge it (${outcome.reason}${outcome.status ? ` ${outcome.status}` : ''})`
      : outcome.decided === false
        ? `The decision maker was not confident enough (${outcome.confidence ?? 0})`
        : `The decision maker classified it as irreversible (${outcome.confidence})`;

    // 截图只在要问人时才拍,而且只给人看 —— 不进上面那次判定,也不进返回给模型的文字。
    const image = await shootWithin(context.shootTarget, action.selector);
    // 「click this element」要靠图说明是哪一个;没图时退回 selector —— 总比一句看不出对象的话强(审查 F5)。
    const onCard = image ? shown : description;

    const answerFromHuman = await agentDecisionRegistry.request(context.sessionId, [
      {
        header: 'Irreversible',
        question: `Run this action?\n${onCard}\n\n${why}`,
        options: [
          { label: 'Run it', description: 'Perform this action on the page now.' },
          { label: 'Stop', description: 'Do not perform it; the agent gets a failure and can pick another route.' }
        ],
        ...(image ? { image } : {})
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
