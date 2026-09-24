import { createXpcMainEmitter } from 'electron-xpc/main';
import type { ConfigApi } from '@maestro-shared/config.api';
import { DECISION_CONFIG_DOMAIN, DECISION_JEV_ENABLED_KEY } from '@maestro-shared/config.api';
import { customerSessionService, revalidateRejectedCustomerSession } from '@main/auth/customerSession.service';
import type { JevRequest, JevResult } from '@shared/decision/jev.api';

/**
 * Jev 判定的**唯一**主进程实现:开关、凭证、HTTP。**只由 `decisionHelper.ts` 调用** —— ui_act 的闸、快照选段、
 * 技能沙箱的 `decision` 绑定、xpc 门面都经 helper 走到这里,凭证与开关的判定只有一份,不会出现「某条路忘了看开关」。
 * 阈值不在这一层(docs/features/decision-helper.md #3)。
 *
 * 走的是自家 relay 的透传口 `POST /v1/systemone`(`bitterless-private` 的
 * `apps/relay/src/modules/jev/jev.service.ts`),不是直连 api.typesafe.ai:
 * · 上游 key 留在 relay 的环境变量里,桌面端不持有;
 * · 直连/经 bridge 由 relay 的 `JEV_UPSTREAM` 决定,客户端不需要知道自己在不在受限区;
 * · 用量按调用方入账。
 */

// 与 `bitterlessProvider.ts` 同一个默认值和同一个环境变量覆盖 —— 但这里要的是 relay 的
// **根**,不是它那个 `/v1/bailian` 的 provider 前缀,所以不能复用那个函数。
const DEFAULT_RELAY_BASE_URL = 'https://bl-relay-sh-zbinqwnecm.cn-shanghai.fcapp.run';

const resolveRelayRoot = (): string =>
  (process.env.BITTERLESS_RELAY_URL || DEFAULT_RELAY_BASE_URL)
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/v1\/(bailian|openai|anthropic|openrouter)$/i, '');

// 主进程也能读这张加密配置表:它住在 sqlite 窗口的 preload 里,经 xpc 到达。
// 六个主进程模块已经这么用(maestroAgent / maestroLlm / capture / apiDoc …)。
const configStore = createXpcMainEmitter<ConfigApi>('ConfigDao');

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * 开关。**不是存下来的 `true` 一律读成关。**
 *
 * electron-xpc 对「通道没注册」(sqlite 窗口还没起来)和「handler 抛了」都回 `null`,
 * 于是「配置库坏了」和「人把它关了」是同一个值。把那个默认成开,等于在配置库坏掉的
 * 那天把页面内容发给第三方 API。
 */
export const isJevEnabled = async (): Promise<boolean> => {
  try {
    const row = await configStore.get({
      domain: DECISION_CONFIG_DOMAIN,
      key: DECISION_JEV_ENABLED_KEY
    });
    return row?.options === true;
  } catch {
    return false;
  }
};

const isAnswers = (value: unknown): value is Record<string, never> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

type JevFailure = Extract<JevResult, { ok: false }>;

/**
 * relay 这一侧的失败(非 2xx 的原始错误体、网络错误、回包形状不对)**原文只进日志**(main 的 console
 * 已接到日志文件,`log.setup.ts`)。给人看的原因只写失败类型和 HTTP 状态 —— 上游的报错里可能带着 jev
 * 字样(docs/features/decision-maker-naming-and-approval-card.md #2,审查 F6)。`message` 仍留在结果里给程序用。
 */
const logRelayFailure = (failure: JevFailure): JevFailure => {
  console.warn(
    `decision maker relay call failed (${failure.reason}${failure.status ? ` ${failure.status}` : ''}): ${failure.message}`
  );
  return failure;
};

/**
 * 一次判定。**永不抛** —— 失败方向由调用方按自己那一格决定(见 jev.api.ts 的 `JevResult`)。
 */
export const jevJudge = async (request: JevRequest): Promise<JevResult> => {
  const startedAt = Date.now();
  const elapsed = (): number => Date.now() - startedAt;

  // 失败原因会被调用方转给人或模型(比如技能脚本里的 `jev` 绑定)—— 会话里一律叫 decision maker,
  // 不出现 Jev(docs/features/decision-maker-naming-and-approval-card.md #1 #2)。ui_act 的闸只把失败类型拼进卡片。
  if (!(await isJevEnabled())) {
    return {
      ok: false,
      reason: 'off',
      message: 'The decision maker is switched off in Settings → Decision.',
      durationMs: elapsed()
    };
  }

  // 桌面端没有客户 SK,用的是本应用登录 Bitterless 拿到的 Core 会话 token(只在内存里)。
  // relay 的 `validateCaller` 认这条通道 —— SK 先试,不像 SK 的再当登录 token 验签 + 回查会话。
  const session = customerSessionService.current;
  const token = session?.token;
  if (!token) {
    return {
      ok: false,
      reason: 'unauthenticated',
      message:
        'Not signed in to Bitterless; sign in so Maestro can reuse that session for the decision maker.',
      durationMs: elapsed()
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${resolveRelayRoot()}/v1/systemone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        state: request.state,
        model: request.model ?? 'jev-latest',
        questions: request.questions
      }),
      signal: controller.signal
    });
    const text = await response.text();
    if (response.status === 401 && session) await revalidateRejectedCustomerSession(session);
    if (!response.ok) {
      // relay 把上游的错误体原样透传,形状是 TypeSafe 的 `{detail:{error_type,message}}`。
      let message = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { detail?: { message?: string } };
        if (parsed?.detail?.message) message = parsed.detail.message;
      } catch {
        // 非 JSON 的错误体照原样截断带走,比吞掉有用。
      }
      return logRelayFailure({
        ok: false,
        reason: 'http',
        message,
        status: response.status,
        durationMs: elapsed()
      });
    }
    const parsed = JSON.parse(text) as { model?: unknown; answers?: unknown };
    if (!isAnswers(parsed?.answers)) {
      return logRelayFailure({
        ok: false,
        reason: 'invalid',
        message: 'relay returned no answers object',
        durationMs: elapsed()
      });
    }
    return {
      ok: true,
      model: typeof parsed.model === 'string' ? parsed.model : 'unknown',
      answers: parsed.answers,
      durationMs: elapsed()
    };
  } catch (error) {
    const message =
      (error as Error)?.name === 'AbortError'
        ? 'decision maker request timed out'
        : String((error as Error)?.message || error);
    return logRelayFailure({ ok: false, reason: 'network', message, durationMs: elapsed() });
  } finally {
    clearTimeout(timer);
  }
};
