import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { ProxyConfig } from '../model.adaptor';

export const createFetchUrlSkill = (proxy?: ProxyConfig) => tool(
  async ({ url, method = 'GET', headers, body }: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }) => {
    console.log('[skill] fetch_url, url:', url, 'method:', method, 'proxy:', proxy?.ip);
    try {
      const agent = proxy?.ip && proxy?.port
        ? new HttpsProxyAgent(`http://${proxy.ip}:${proxy.port}`)
        : undefined;
      const response = await fetch(url, {
        method,
        headers: { 'User-Agent': 'Mozilla/5.0', ...headers },
        ...(body ? { body } : {}),
        ...(agent ? { agent } : {}),
      });

      const contentType = response.headers.get('content-type') ?? '';
      let content: string;

      if (contentType.includes('application/json')) {
        const json = await response.json();
        content = JSON.stringify(json, null, 2);
      } else {
        const text = await response.text();
        content = text.slice(0, 8000);
      }

      return JSON.stringify({
        status: response.status,
        statusText: response.statusText,
        content,
      });
    } catch (err: any) {
      console.error('[skill] fetch_url error:', err.message);
      return JSON.stringify({ error: err.message });
    }
  },
  {
    name: 'fetch_url',
    description:
      'Fetch content from a URL using HTTP/HTTPS. Use this to retrieve web pages, call REST APIs, or download JSON data. Returns the response status and content.',
    schema: z.object({
      url: z.string().describe('The full URL to fetch, including http:// or https://'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional().describe('HTTP method, default is GET'),
      headers: z.record(z.string()).optional().describe('Optional HTTP headers as key-value pairs'),
      body: z.string().optional().describe('Optional request body for POST/PUT requests'),
    }),
  },
);
