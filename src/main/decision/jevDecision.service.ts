import { createXpcMainEmitter } from 'electron-xpc/main';
import type { ConfigApi } from '@maestro-shared/config.api';
import { DECISION_CONFIG_DOMAIN, DECISION_JEV_ENABLED_KEY } from '@maestro-shared/config.api';
import { customerSessionService } from '@main/auth/customerSession.service';
import type { JevRequest, JevResult } from '@shared/decision/jev.api';

/**
 * Jev 判定的**唯一**主进程实现。xpc handler、技能沙箱里的 `jev` 绑定、ui_act 的闸
 * 全部走这一个模块 —— 凭证与开关的判定只有一份,不会出现「某条路忘了看开关」。
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

/**
 * 一次判定。**永不抛** —— 失败方向由调用方按自己那一格决定(见 jev.api.ts 的 `JevResult`)。
 */
export const jevJudge = async (request: JevRequest): Promise<JevResult> => {
  const startedAt = Date.now();
  const elapsed = (): number => Date.now() - startedAt;

  if (!(await isJevEnabled())) {
    return { ok: false, reason: 'off', message: 'Jev is switched off in Settings → Decision.', durationMs: elapsed() };
  }

  // 桌面端没有客户 SK,用的是本应用登录 Bitterless 拿到的 Core 会话 token(只在内存里)。
  // relay 的 `validateCaller` 认这条通道 —— SK 先试,不像 SK 的再当登录 token 验签 + 回查会话。
  const token = customerSessionService.current?.token;
  if (!token) {
    return {
      ok: false,
      reason: 'unauthenticated',
      message: 'Not signed in to Bitterless; sign in so Maestro can reuse that session for Jev.',
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
    if (!response.ok) {
      // relay 把上游的错误体原样透传,形状是 TypeSafe 的 `{detail:{error_type,message}}`。
      let message = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { detail?: { message?: string } };
        if (parsed?.detail?.message) message = parsed.detail.message;
      } catch {
        // 非 JSON 的错误体照原样截断带走,比吞掉有用。
      }
      return { ok: false, reason: 'http', message, status: response.status, durationMs: elapsed() };
    }
    const parsed = JSON.parse(text) as { model?: unknown; answers?: unknown };
    if (!isAnswers(parsed?.answers)) {
      return { ok: false, reason: 'invalid', message: 'relay returned no answers object', durationMs: elapsed() };
    }
    return {
      ok: true,
      model: typeof parsed.model === 'string' ? parsed.model : 'unknown',
      answers: parsed.answers,
      durationMs: elapsed()
    };
  } catch (error) {
    const message = (error as Error)?.name === 'AbortError' ? 'jev request timed out' : String((error as Error)?.message || error);
    return { ok: false, reason: 'network', message, durationMs: elapsed() };
  } finally {
    clearTimeout(timer);
  }
};
