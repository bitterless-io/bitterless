/**
 * Jev(TypeSafe System One)判定的宿主契约:请求、答案与失败原因的形状。
 *
 * 调用方不直接用这一层:主进程、技能沙箱、渲染进程都经 decision helper(`decision.api.ts`),
 * 它在这些类型之上加了阈值;`main/decision/jevDecision.service.ts` 只由 helper 调用。
 *
 * 凭证**只存在于主进程**:技能脚本入库前会过 `sanitizeSkillScriptForStorage`,
 * 脚本里出现疑似密钥的字面量会让整段脚本被丢弃。所以任何门面都不接受、也不回传凭证。
 *
 * 判断点与失败方向见 overmind `areas/agent-runtime/decision/browser-use.html` #1 / #3。
 */

/** 题型三选一,与 TypeSafe 的 primitives 同名;没有一种能吐自由文本。 */
export interface JevChoiceQuestion {
  type: 'choice';
  instructions: string;
  /** 选项 → 释义。上限 255 项;必须包含一个「都不是」的出口,否则它只能在错的里面挑。 */
  criteria: Record<string, string>;
}

export interface JevNoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface JevScoreQuestion {
  type: 'score';
  instructions: string;
  /** 2–10 档有序释义,每一档要能独立读懂。 */
  criteria: string[];
}

export type JevQuestion = JevChoiceQuestion | JevNoulQuestion | JevScoreQuestion;

export interface JevRequest {
  /** 给它判的事实。用具名 JSON 字段,不要糊成一段话。 */
  state: Record<string, unknown>;
  questions: Record<string, JevQuestion>;
  /** 默认 `jev-latest`(滚动路由)。生产接线应钉具体版本。 */
  model?: string;
  /** 毫秒。默认 8000 —— 稳态 ≈0.5s,冷启实测 8.2–9.5s。 */
  timeoutMs?: number;
}

export interface JevChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevNoulAnswer {
  noul: number;
}

export interface JevScoreAnswer {
  score: number;
  confidence: number;
  legend?: unknown;
  probabilities?: Record<string, number>;
}

export type JevAnswer = JevChoiceAnswer | JevNoulAnswer | JevScoreAnswer;

/**
 * **永不抛,永不只回一个 null。**
 *
 * 调用方必须能区分「它说了话」和「它没说上话」,因为这两者的失败方向相反:
 * BJ1/BJ4 拿不到判定就放行原逻辑,BJ3 拿不到判定就升到最高档去问人。
 * 一个裸 null 会把这两种情况压成一种,于是必有一侧的失败方向是错的。
 */
export type JevResult =
  | { ok: true; model: string; answers: Record<string, JevAnswer>; durationMs: number }
  | {
      ok: false;
      /** off = 设置里关着 · unauthenticated = 没登录 · http = relay 回了非 2xx · network = 打不通/超时 · invalid = 回包不是预期形状 */
      reason: 'off' | 'unauthenticated' | 'http' | 'network' | 'invalid';
      message: string;
      status?: number;
      durationMs: number;
    };
