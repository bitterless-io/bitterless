import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';

export type LLMProvider = 'openrouter';

export interface ProxyConfig {
  ip: string;
  port: string;
}

export interface ModelConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  baseURL?: string;
  proxy?: ProxyConfig;
}

const buildFetch = (proxy?: ProxyConfig) => {
  if (!proxy?.ip || !proxy?.port) return fetch as any;
  const agent = new HttpsProxyAgent(`http://${proxy.ip}:${proxy.port}`);
  return (url: any, options: any = {}) => fetch(url, { ...options, agent });
};

const createOpenAIModel = (config: ModelConfig): BaseChatModel => {
  const customFetch = buildFetch(config.proxy);
  return new ChatOpenAI({
    model: config.model,
    temperature: 0.7,
    streaming: true,
    apiKey: config.apiKey,
    ...(config.baseURL
      ? { configuration: { baseURL: config.baseURL, fetch: customFetch } }
      : { configuration: { fetch: customFetch } }),
  });
};

export const createModel = (config: ModelConfig): BaseChatModel => {
  if (config.provider !== 'openrouter') {
    throw new Error(`[modelAdaptor] unsupported provider: ${config.provider}`);
  }
  return createOpenAIModel(config);
};
