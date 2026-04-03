export interface ModelDef {
  provider: string;
  name: string;
}

export const MODEL_LIST: ModelDef[] = [
  { provider: 'openai', name: 'gpt-5.2' },
  { provider: 'anthropic', name: 'claude-opus-4.5' },
  { provider: 'anthropic', name: 'claude-sonnet-4.5' },
  { provider: 'google', name: 'gemini-3-flash-preview' },
  { provider: 'google', name: 'gemini-3-pro-preview' },
  { provider: 'openrouter', name: 'claude-sonnet-4.5' },
  { provider: 'openrouter', name: 'google/gemini-3-flash-preview' },
  { provider: 'openrouter', name: 'deepseek/deepseek-v3.2' },
];

export const PROVIDER_LIST: string[] = [...new Set(MODEL_LIST.map((m) => m.provider))];

export const getModelsByProvider = (provider: string): ModelDef[] =>
  MODEL_LIST.filter((m) => m.provider === provider);
