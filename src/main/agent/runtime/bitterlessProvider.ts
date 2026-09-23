import { LLM_PRESETS } from '@main/maestro/llm/llmModels';
import { customerSessionService } from '@main/auth/customerSession.service';

/**
 * **Bitterless 是 pi 的一个 provider,不是另一套 agent。**
 *
 * 这条路线抄 micromeet-cowork 的 `aiCrmsProvider.ts`,连同它那次的教训:relay 本来就说标准
 * OpenAI `chat/completions`,所以不需要为它另写一套会话循环。注册成 provider 之后,pi 的
 * 工具循环、内置工具、压缩、steering 只有一份,**agent 能力不随 provider 变**。
 *
 * 与 Codex 的差别只在凭据来源:Codex 是 pi 的 OAuth,Bitterless 用的是用户在本应用里
 * 登录 Bitterless 得到的 Core 会话 token(`customerSessionService`,只在内存里)。
 *
 * **为什么是运行时注册而不是写进 models.json**:baseUrl 随环境走、apiKey 是会话 token,
 * 两者都会在重新登录时变。`registerProvider` 是 upsert 语义,每次建 runtime 前调一次即可。
 */

export const BITTERLESS_PROVIDER_ID = 'bitterless';

export const isBitterlessProvider = (providerId: string): boolean =>
  providerId.trim().toLowerCase() === BITTERLESS_PROVIDER_ID;

export const BITTERLESS_SIGN_IN_ERROR =
  'Not signed in to Bitterless. Sign in to your Bitterless account in the app so Maestro can reuse that session for the Bitterless models.';

/** 生产 relay(上海 FC `bl-relay-sh`)。用环境变量覆盖以指向本地或测试 relay。 */
const DEFAULT_RELAY_BASE_URL = 'https://bl-relay-sh-zbinqwnecm.cn-shanghai.fcapp.run';

/**
 * 交给 pi 的是 relay 的**provider 前缀根**(`…/v1/bailian`),`/chat/completions` 由 pi 自己拼。
 * 已经带了后缀的覆盖值会被剥掉,否则会拼成 `/chat/completions/chat/completions`。
 */
export const resolveBitterlessRelayBaseUrl = (): string => {
  const configured = (process.env.BITTERLESS_RELAY_URL || DEFAULT_RELAY_BASE_URL).trim();
  const root = configured.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  return /\/v1\/bailian$/i.test(root) ? root : `${root}/v1/bailian`;
};

/**
 * 请求形状与 relay 的百炼上游对齐,换算关系都在 pi-ai 的 `api/openai-completions.js` 里:
 * · `thinkingFormat: 'qwen'` + 模型声明 `reasoning: true` → 顶层 `enable_thinking`;
 * · `maxTokensField: 'max_tokens'` → 百炼认的是 `max_tokens`,不是 `max_completion_tokens`;
 * · `supportsUsageInStreaming` → 流式 usage,relay 靠它记账(relay 端也会强制打开
 *   `stream_options.include_usage`,两边都设是因为谁都不该依赖对方记得设)。
 */
const BITTERLESS_COMPAT = {
  maxTokensField: 'max_tokens',
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsUsageInStreaming: true,
  supportsStore: false,
  supportsStrictMode: false,
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: 'qwen'
} as const;

const BITTERLESS_MAX_OUTPUT_TOKENS = 8192;

/** pi 的 ModelRuntime 里这个模块用得到的那一小片,窄到测试里随手可以造一个假的。 */
export interface PiProviderRegistry {
  registerProvider(providerName: string, config: Record<string, unknown>): void;
  setRuntimeApiKey?(providerName: string, apiKey: string, options?: { signal?: AbortSignal }): Promise<void>;
}

export const bitterlessProviderModels = (): Record<string, unknown>[] =>
  LLM_PRESETS.filter((preset) => preset.provider === BITTERLESS_PROVIDER_ID).map((preset) => ({
    id: preset.model,
    name: preset.label,
    // thinking 由 pi 的 thinkingLevel 驱动,模型必须自报会 reasoning,
    // 否则 pi 那边 `&& model.reasoning` 短路,`enable_thinking` 一次都发不出去。
    reasoning: true,
    input: ['text'],
    contextWindow: (preset.contextLengthK || 256) * 1024,
    maxTokens: BITTERLESS_MAX_OUTPUT_TOKENS,
    // relay 不按 token 向客户端计费,成本面在服务端;这里报 0 而不是编一个数。
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { ...BITTERLESS_COMPAT }
  }));

/**
 * 用**当前**登录会话把 relay 注册进 pi。建 runtime 之后、找模型之前调用。
 *
 * 没登录时**静默跳过而不是抛错**:注册是在每次建 runtime 时无条件发生的,而用户完全可能
 * 正在用 Codex。没登录只意味着这两个模型此刻不可选(`hasConfiguredAuth` 会是 false,
 * 上层会给出指名 Bitterless 的登录提示),不该把 Codex 的会话一起打掉。
 */
export const registerBitterlessProvider = async (registry: PiProviderRegistry): Promise<boolean> => {
  const session = customerSessionService.current;
  if (!session?.token) return false;
  registry.registerProvider(BITTERLESS_PROVIDER_ID, {
    name: 'Bitterless',
    api: 'openai-completions',
    baseUrl: resolveBitterlessRelayBaseUrl(),
    apiKey: session.token,
    compat: { ...BITTERLESS_COMPAT },
    models: bitterlessProviderModels()
  });
  // pi 0.85+ 把运行时凭据放在内存 overlay 里;有这个方法就用,让 `hasConfiguredAuth` 认得它。
  await registry.setRuntimeApiKey?.(BITTERLESS_PROVIDER_ID, session.token);
  return true;
};
