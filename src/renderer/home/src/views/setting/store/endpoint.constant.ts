export interface EndpointOption {
  label: string;
  value: string;
}

export const ENDPOINT_OPTIONS: EndpointOption[] = [
  {
    label: 'OpenRouter (https://openrouter.ai/api)',
    value: 'https://openrouter.ai/api/v1',
  },
  {
    label: 'OpenAI (https://api.openai.com/v1)',
    value: 'https://api.openai.com/v1',
  },
  {
    label: 'Anthropic (https://api.anthropic.com)',
    value: 'https://api.anthropic.com',
  },
];

