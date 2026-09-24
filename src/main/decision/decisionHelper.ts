import { isJevEnabled, jevJudge } from '@main/decision/jevDecision.service';
import type {
  DecisionHelper,
  DecisionOptions,
  DecisionOutcome,
  DecisionQuestion
} from '@shared/decision/decision.api';
import type {
  JevChoiceAnswer,
  JevChoiceQuestion,
  JevNoulAnswer,
  JevNoulQuestion,
  JevQuestion,
  JevRequest,
  JevResult,
  JevScoreAnswer,
  JevScoreQuestion
} from '@shared/decision/jev.api';

/**
 * decision maker 的**唯一**判定入口(docs/features/decision-helper.md #3)。ui_act 的闸、快照选段、
 * 技能沙箱的 `decision` 绑定、渲染层的 `xpc:DecisionHandler/*` 全部走这里;`jevDecision.service.ts`
 * 只剩开关、凭证、HTTP 那一层,也只由本文件 import(源码守卫:tests/maestro/decisionHelper.test.mjs)。
 *
 * helper 只回答「判定了没有、为什么」。拿不到判定时放行还是问人**不在这里**:BJ3 问人,BJ1 / BJ4 放行 ——
 * 两种方向同时存在,合进 helper 必有一侧是错的。
 */

/** Ral 2026-09-24:全局默认阈值 0.5。严格大于它才算判定了(沿用 BJ3 的「大于 0.5 才采信」)。 */
export const DECISION_DEFAULT_THRESHOLD = 0.5;

type JevFailure = Extract<JevResult, { ok: false }>;

/** 从一道题的答案里读出的值,和拿来跟阈值比的那个置信度。 */
interface Reading<T> {
  value: T;
  confidence: number;
}

/** 写得出来就是那段文字;抛了就当没有。 */
const attempt = (write: () => string | undefined): string | undefined => {
  try {
    return write();
  } catch {
    return undefined;
  }
};

/**
 * 阈值写进说明时的样子。数原样写(`1.5`、`NaN`);不是数的按 JSON 写,字符串因此带引号 ——
 * `Threshold "0.7"` 才看得出错在类型,`Threshold 0.7` 像是在说 0.7 不在 (0, 1) 里。
 * JSON 写不出来的用 `String()`:BigInt 会让 `JSON.stringify` 抛,函数会让它回 `undefined`。
 * `String()` 也写不出来(没有原型、也没有 `toString` 的对象)就写 `(unprintable)` —— 一句说明不能把整次调用弄抛(#3)。
 */
const shownThreshold = (threshold: unknown): string => {
  if (typeof threshold === 'number') return String(threshold);
  return (
    attempt(() => JSON.stringify(threshold)) ?? attempt(() => String(threshold)) ?? '(unprintable)'
  );
};

/**
 * 阈值必须是 (0, 1) 之内的数,否则按默认值算。不悄悄换:返回一句说明,判不成时接在 `message` 后面;
 * 判成了的结果没有 `message`(#3),所以每次还记一条日志。技能脚本什么都可能传进来(比如字符串 "0.7"),
 * 所以参数是 `unknown`,按运行时的值判断。
 */
const resolveThreshold = (threshold: unknown): { threshold: number; note?: string } => {
  if (threshold === undefined) return { threshold: DECISION_DEFAULT_THRESHOLD };
  if (typeof threshold === 'number' && threshold > 0 && threshold < 1) return { threshold };
  const note = `Threshold ${shownThreshold(threshold)} is not a number strictly between 0 and 1, so the default ${DECISION_DEFAULT_THRESHOLD} was used.`;
  console.warn('[coach:decision:helper]', note);
  return { threshold: DECISION_DEFAULT_THRESHOLD, note };
};

const withNote = (message: string, note: string | undefined): string =>
  note ? `${message} ${note}` : message;

/*
 * 判不了时给人看的那句话。句式两仓逐字一致(docs/features/decision-helper.md #3「`message` 的固定句式」),
 * 不写 Jev(docs/features/decision-maker-naming-and-approval-card.md #1)。
 */

/**
 * `invalid` 的那一句 —— 不管是 relay 整个没回答案,还是这道题的答案缺了、形状不对。
 * `judge()` 的原始结果不属于哪一道题,就不点名。
 */
const noUsableAnswer = (name?: string): string =>
  name === undefined
    ? 'The decision maker gave no usable answer.'
    : `The decision maker gave no usable answer to "${name}".`;

/**
 * 报告一次底层的失败,`ask` 与 `judge` 共用。做两件事:
 * · 记一条带原文的日志 —— http / network / 服务自己的 invalid 才有原文(off / unauthenticated 不记)。原文是
 *   relay 透传的报错体或网络报错,里面可能带着 jev 字样或主机名,所以只进日志(服务的 `logRelayFailure` 与
 *   helper 各记一条),不进 `message`;
 * · 返回 #3 表的固定句式:off / unauthenticated 原样用服务写给人看的那句;http / network 只写失败类型和
 *   HTTP 状态,与审批卡片同一个写法;invalid 用 `noUsableAnswer`。技能脚本经 `jev.judge` / `decision.judge`
 *   拿到的也是这句,不带原文(审查 198-F4)。
 */
const reportFailure = (failure: JevFailure, name?: string): string => {
  if (failure.reason === 'off' || failure.reason === 'unauthenticated') return failure.message;
  const kind = `${failure.reason}${failure.status ? ` ${failure.status}` : ''}`;
  console.warn('[coach:decision:helper]', `decision maker ${kind}`, failure.message);
  return failure.reason === 'invalid'
    ? noUsableAnswer(name)
    : `The decision maker could not judge it (${kind}).`;
};

/** 回包里的数得是个真正的数:缺了、是 NaN / ±Infinity、是字符串、布尔、对象,都算回包坏了(#3)。 */
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** 置信度与 noul 都是概率:出了 [0, 1] 与非数一样算回包坏了(#3)。 */
const isProbability = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0 && value <= 1;

/*
 * 三种题型各自怎么读答案。读不出来(缺这道题、字段类型不对、概率出了 [0, 1]、choice 不是题目给的选项)
 * = 回包不是预期的形状,按 `invalid` 报,不猜成置信度 0 或「没选中」。
 */

/**
 * choice 必须是题目 `criteria` 的一个键(#3,审查 001-1 N4):BJ3 把不是 `irreversible` 的判定都当成安全,
 * 一个意料之外的 choice(比如大小写不同的 `Irreversible`)会让点击不问人就执行。技能脚本是纯 JS,
 * 题目可能根本没给 `criteria`,所以 `?? {}` —— 读答案不能抛。
 */
const readChoice = (
  answer: unknown,
  criteria: Record<string, string>
): Reading<string> | undefined => {
  const { choice, confidence } = (answer ?? {}) as Partial<JevChoiceAnswer>;
  const offered = typeof choice === 'string' && Object.hasOwn(criteria ?? {}, choice);
  return offered && isProbability(confidence) ? { value: choice, confidence } : undefined;
};

const readScore = (answer: unknown): Reading<number> | undefined => {
  const { score, confidence } = (answer ?? {}) as Partial<JevScoreAnswer>;
  return isFiniteNumber(score) && isProbability(confidence)
    ? { value: score, confidence }
    : undefined;
};

/**
 * noul 是「是」的概率。是 / 否一视同仁(#3):`value` 看它过没过中点 0.5,置信度是选中那一边的概率 ——
 * 所以 noul 0.02 是有把握的「否」(置信度 0.98),算判定了。中点 0.5 是概率的对半,与阈值无关;
 * 置信度因此最低是 0.5,阈值低于 0.5 对 check 没有意义。
 */
const readNoul = (answer: unknown): Reading<boolean> | undefined => {
  const { noul } = (answer ?? {}) as Partial<JevNoulAnswer>;
  if (!isProbability(noul)) return undefined;
  const value = noul > 0.5;
  return { value, confidence: value ? noul : 1 - noul };
};

interface Ask<T> {
  /** 这道题在请求里的键,回包也按它取答案。 */
  name: string;
  question: JevQuestion;
  state: Record<string, unknown>;
  options?: DecisionOptions;
  read: (answer: unknown) => Reading<T> | undefined;
}

/** 问一道题,按阈值下结论。和 `jevJudge` 一样**永不抛**:所有情况都落在 `DecisionOutcome` 里。 */
const ask = async <T>(params: Ask<T>): Promise<DecisionOutcome<T>> => {
  const { name, question, state, options, read } = params;
  const { threshold, note } = resolveThreshold(options?.threshold);
  const result = await jevJudge({
    state,
    questions: { [name]: question },
    model: options?.model,
    timeoutMs: options?.timeoutMs
  });
  if (result.ok === false) {
    return {
      decided: false,
      reason: result.reason,
      message: withNote(reportFailure(result, name), note),
      ...(result.status ? { status: result.status } : {}),
      durationMs: result.durationMs
    };
  }

  const answer = result.answers[name];
  const reading = read(answer);
  if (!reading) {
    // helper 自己判的 invalid 也记一条,带上回来的答案,不然查不出「这次为什么问人」(#3「日志」)。答案里没有
    // relay 的报错原文;它是 `jevJudge` 从 JSON 解析出来的,再写成 JSON 不会抛。答案只进日志,`message` 仍是
    // #3 的固定句式(`noUsableAnswer`)。
    console.warn(
      '[coach:decision:helper]',
      `decision maker gave an unusable answer to "${name}"`,
      JSON.stringify(answer)
    );
    return {
      decided: false,
      reason: 'invalid',
      message: withNote(noUsableAnswer(name), note),
      durationMs: result.durationMs
    };
  }
  if (reading.confidence > threshold) {
    return {
      decided: true,
      value: reading.value,
      confidence: reading.confidence,
      durationMs: result.durationMs
    };
  }
  return {
    decided: false,
    reason: 'low-confidence',
    value: reading.value,
    confidence: reading.confidence,
    message: withNote(
      `The decision maker was not confident enough (${reading.confidence}, needs more than ${threshold}).`,
      note
    ),
    durationMs: result.durationMs
  };
};

/**
 * 题型由调用的方法定(#3)。`name` 只是键,不进题目本身。技能脚本是纯 JS,题目里可能还带着 `type`
 * (TS 调用方的类型里没有它):删掉,由方法给的那个写在最前 —— 迁移过来的调用方发出去的题目因此与迁移前
 * 手写的 `{ type, instructions, criteria }` 逐字节相同,键的顺序也一样。
 */
const typedQuestion = <Q extends JevQuestion>(
  type: Q['type'],
  asked: DecisionQuestion<Q>
): { name: string; question: Q } => {
  const { name, ...rest } = asked as DecisionQuestion<Q> & { type?: unknown };
  delete rest.type;
  return { name, question: { type, ...rest } as unknown as Q };
};

export const decisionHelper: DecisionHelper = {
  /** = `isJevEnabled`:不是存下来的 `true` 一律读成关。 */
  enabled: () => isJevEnabled(),

  /**
   * 不加阈值。判成了的结果原样交回;判不了的其余字段原样,只把 `message` 换成 #3 表里的句式(`invalid` 不点名),
   * 原文只进日志(审查 198-F4)。`options` 里只有 `model` / `timeoutMs` 对它有意义,给了就盖过 `request` 里的。
   */
  judge: async (request, options) => {
    // 技能脚本是纯 JS,`jev.judge()` / `jev.judge(null)` 可能什么都不传:当 `{}` 交给底层,不在这里抛。
    // 开关关着时回 off,与迁移前一样;开着时向 relay 发一次请求(body 只有默认 `model`),失败按 #3 表写,
    // 如 `(http 422)` —— 迁移前开着时这一下是脚本里的 TypeError,什么都不发(#4 技能沙箱一行)。
    const given = request ?? ({} as JevRequest);
    const result = await jevJudge({
      ...given,
      model: options?.model ?? given.model,
      timeoutMs: options?.timeoutMs ?? given.timeoutMs
    });
    return result.ok === false ? { ...result, message: reportFailure(result) } : result;
  },

  choose: (asked, state, options) => {
    const { name, question } = typedQuestion<JevChoiceQuestion>('choice', asked);
    return ask({
      name,
      question,
      state,
      options,
      read: (answer) => readChoice(answer, question.criteria)
    });
  },

  check: (asked, state, options) =>
    ask({ ...typedQuestion<JevNoulQuestion>('noul', asked), state, options, read: readNoul }),

  score: (asked, state, options) =>
    ask({ ...typedQuestion<JevScoreQuestion>('score', asked), state, options, read: readScore })
};
