import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'openrouter';

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

const createAnthropicModel = (config: ModelConfig): BaseChatModel => {
  const customFetch = buildFetch(config.proxy);
  return new ChatAnthropic({
    model: config.model,
    temperature: 0.7,
    streaming: true,
    apiKey: config.apiKey,
    clientOptions: { fetch: customFetch },
  });
};

const createGoogleModel = (config: ModelConfig): BaseChatModel => {
  return new ChatGoogleGenerativeAI({
    model: config.model,
    temperature: 0.7,
    streaming: true,
    apiKey: config.apiKey,
  });
};

const providerFactories: Record<LLMProvider, (config: ModelConfig) => BaseChatModel> = {
  openai: createOpenAIModel,
  anthropic: createAnthropicModel,
  google: createGoogleModel,
  openrouter: createOpenAIModel,
};

export const createModel = (config: ModelConfig): BaseChatModel => {
  const factory = providerFactories[config.provider];
  if (!factory) {
    throw new Error(`[modelAdaptor] unsupported provider: ${config.provider}`);
  }
  return factory(config);
};
