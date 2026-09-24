import type {
  JevChoiceQuestion,
  JevNoulQuestion,
  JevQuestion,
  JevRequest,
  JevResult,
  JevScoreQuestion
} from '@shared/decision/jev.api';

/**
 * Decision helper 的契约(docs/features/decision-helper.md #3)。类型名与 micromeet-cowork 的同名文件一致。
 *
 * 实现只有一份,在主进程 `main/decision/decisionHelper.ts` —— 凭证只在主进程。
 * 其余都是同一签名(`DecisionHelper`)的门面,背后是那一份实现:
 *   · 主进程里的调用方(ui_act 的闸、快照选段)→ 直接 import 它
 *   · 生成的技能脚本 → `skillScript.ts` 沙箱里的 `decision` 绑定(`jev` 是它的旧名字)
 *   · 渲染进程 → `renderer/common/decision/decisionHelper.ts`,经 `xpc:DecisionHandler/*`(`DecisionApi`)
 *
 * helper 只回答「判定了没有、为什么」。拿不到判定时放行还是问人,由每个调用方自己决定(#3)。
 */

export interface DecisionOptions {
  /**
   * **严格大于**它才算判定了。缺省 0.5;不在 (0, 1) 之内就按 0.5 算 —— 判不成时在 `message` 里说明,
   * 并且每次记一条 `console.warn`。`judge` 不看它。
   */
  threshold?: number;
  /** 毫秒,缺省 8000(稳态 ≈0.5s,冷启实测 8.2–9.5s)。 */
  timeoutMs?: number;
  /** 缺省走滚动路由;生产接线应钉具体版本。 */
  model?: string;
}

/**
 * `choose` / `check` / `score` 的题目。题型由方法决定,所以不写 `type`;技能脚本是纯 JS,
 * 题目里即使带了 `type`,也以调用的方法为准(#3)。
 *
 * `name`(必填)是这道题在请求里的键,回包也按它取答案。整份请求都交给 decision maker,键名算不算进判定无从验证 ——
 * 所以从 `jevJudge` 迁过来的调用方沿用原来的键(BJ3 `risk`、BJ1 `block`),请求与迁移前逐字相同。
 */
export type DecisionQuestion<Q extends JevQuestion> = Omit<Q, 'type'> & { name: string };

/** 判不了的原因:`jevJudge` 的五种原样带回,外加「把握不够」这一种。 */
export type DecisionFailureReason = Extract<JevResult, { ok: false }>['reason'] | 'low-confidence';

/**
 * 一次判定的结论(#3)。判不了的一侧带 `status`:`reason === 'http'` 时 relay 回的 HTTP 状态 —— 审批卡片与
 * 快照说明写的是「(http 502)」(decision-maker-naming-and-approval-card.md #2),helper 不能把它丢掉。
 *
 * `message` 是给人看的,一律叫 decision maker,不写 Jev;句式两仓逐字一致,见 #3「`message` 的固定句式」。
 * 在 BL 主进程(tsconfig `strict: false`)里要写 `outcome.decided === false` 才能收窄到这一侧,`!outcome.decided` 不行。
 */
export type DecisionOutcome<T> =
  | { decided: true; value: T; confidence: number; durationMs: number }
  | {
      decided: false;
      reason: DecisionFailureReason;
      /** `low-confidence` 时带回它的答案与置信度,调用方要看可以看。 */
      value?: T;
      confidence?: number;
      message: string;
      status?: number;
      durationMs: number;
    };

/** Decision helper 的签名:主进程的 `decisionHelper`、渲染层模块、技能沙箱的 `decision` 绑定都按它写。 */
export interface DecisionHelper {
  /** 设置里的开关是不是开着。 */
  enabled(): Promise<boolean>;
  /**
   * 原样判定,不加阈值 —— 给需要自己看原始结果的调用方。判不了时其余字段原样,只有 `message` 按
   * #3「`message` 的固定句式」改写,不带 relay 原文。
   */
  judge(request: JevRequest, options?: DecisionOptions): Promise<JevResult>;
  /** choice 题:`value` 是选中的那一项,看 `confidence`。 */
  choose(
    question: DecisionQuestion<JevChoiceQuestion>,
    state: Record<string, unknown>,
    options?: DecisionOptions
  ): Promise<DecisionOutcome<string>>;
  /** noul 题(是 / 否),是否一视同仁:`value` = noul > 0.5,置信度是选中那一边的概率(`value ? noul : 1 − noul`)。 */
  check(
    question: DecisionQuestion<JevNoulQuestion>,
    state: Record<string, unknown>,
    options?: DecisionOptions
  ): Promise<DecisionOutcome<boolean>>;
  /** score 题:`value` 是档位,看 `confidence`。 */
  score(
    question: DecisionQuestion<JevScoreQuestion>,
    state: Record<string, unknown>,
    options?: DecisionOptions
  ): Promise<DecisionOutcome<number>>;
}

/*
 * 渲染进程门面 `xpc:DecisionHandler/*` 的契约(`main/xpc/decision.handler.ts` 实现它)。electron-xpc 的方法
 * 只能有 0 或 1 个形参(第二个会被丢掉,类型上塌成 never),所以渲染层把位置参数装进一个对象,主进程那边再拆开。
 */
export interface DecisionJudgeParams {
  request: JevRequest;
  options?: DecisionOptions;
}

export interface DecisionAskParams<Q extends JevQuestion> {
  question: DecisionQuestion<Q>;
  state: Record<string, unknown>;
  options?: DecisionOptions;
}

export interface DecisionApi {
  enabled(): Promise<boolean>;
  judge(params: DecisionJudgeParams): Promise<JevResult>;
  choose(params: DecisionAskParams<JevChoiceQuestion>): Promise<DecisionOutcome<string>>;
  check(params: DecisionAskParams<JevNoulQuestion>): Promise<DecisionOutcome<boolean>>;
  score(params: DecisionAskParams<JevScoreQuestion>): Promise<DecisionOutcome<number>>;
}
