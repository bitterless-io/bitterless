import fetch from 'node-fetch';
import { parseHTML } from 'linkedom/worker';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { ProxyConfig } from './model.adaptor';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'identity',
  'Cache-Control': 'max-age=0',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  pageContent?: string;
}

class SearchAdaptor {
  async searchBaidu(query: string, maxResults: number): Promise<SearchResult[]> {
    const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${maxResults}&ie=utf-8`;
    console.log('[searchAdaptor] searchBaidu, url:', searchUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          ...BROWSER_HEADERS,
          'Referer': 'https://www.baidu.com/',
          'Host': 'www.baidu.com',
        },
        signal: controller.signal,
      } as any);
      clearTimeout(timeout);

        console.log('[searchAdaptor] searchBaidu, status:', response.status);
      const html = await response.text();
      console.log('[searchAdaptor] searchBaidu, html sample:', html.slice(0, 2000));
      const { document } = parseHTML(html);

      const results: SearchResult[] = [];
      const resultEls = Array.from(document.querySelectorAll('[class*="result"]'));

      for (let i = 0; i < resultEls.length; i++) {
        if (results.length >= maxResults) break;
        const el = resultEls[i];
        const titleEl = el.querySelector('h3 a');
        const title = titleEl?.textContent?.trim() ?? '';
        let href = titleEl?.getAttribute('href') ?? '';

        console.log(`[searchAdaptor] searchBaidu, result[${i}] title="${title}" href="${href}"`);

        if (!title || !href) continue;

        if (href.startsWith('/')) {
          href = `https://www.baidu.com${href}`;
        }

        const snippetEl = el.querySelector('[class*="abstract"], [class*="content"], [class*="desc"]');
        const snippet = snippetEl?.textContent?.trim() ?? '';

        results.push({ title, url: href, snippet });
      }

      console.log('[searchAdaptor] searchBaidu, results count:', results.length);
      return results;
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        console.warn('[searchAdaptor] searchBaidu, timeout');
        return [];
      }
      throw err;
    }
  }

  async searchDdg(query: string, maxResults: number, proxy?: ProxyConfig): Promise<SearchResult[]> {
    const searchUrl = 'https://html.duckduckgo.com/html/';
    console.log('[searchAdaptor] searchDdg, query:', query);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const formData = `q=${encodeURIComponent(query)}&b=&kl=&df=`;

      const fetchOptions: any = {
        method: 'POST',
        headers: {
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'cache-control': 'max-age=0',
          'content-type': 'application/x-www-form-urlencoded',
          'origin': 'https://html.duckduckgo.com',
          'referer': 'https://html.duckduckgo.com/',
          'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-user': '?1',
          'upgrade-insecure-requests': '1',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        },
        body: formData,
        signal: controller.signal,
      };

      if (proxy?.ip && proxy?.port) {
        const agent = new HttpsProxyAgent(`http://${proxy.ip}:${proxy.port}`);
        fetchOptions.agent = agent;
        console.log('[searchAdaptor] searchDdg, using proxy:', `${proxy.ip}:${proxy.port}`);
      }

      const response = await fetch(searchUrl, fetchOptions);
      clearTimeout(timeout);

      console.log('[searchAdaptor] searchDdg, status:', response.status);
      const html = await response.text();
      console.log('[searchAdaptor] searchDdg, html sample:', html.slice(0, 2000));
      const { document: ddgDoc } = parseHTML(html);

      const results: SearchResult[] = [];
      const resultEls = Array.from(ddgDoc.querySelectorAll('.result'));

      for (let i = 0; i < resultEls.length; i++) {
        if (results.length >= maxResults) break;

        const el = resultEls[i];
        if (el.classList.contains('result--ad')) {
          console.log(`[searchAdaptor] searchDdg, skipping ad result[${i}]`);
          continue;
        }

        const titleEl = el.querySelector('h2.result__title a.result__a');
        const title = titleEl?.textContent?.trim() ?? '';
        const href = titleEl?.getAttribute('href') ?? '';

        console.log(`[searchAdaptor] searchDdg, result[${i}] title="${title}" href="${href}"`);

        if (!title || !href) continue;

        const snippetEl = el.querySelector('a.result__snippet');
        const snippet = snippetEl?.textContent?.trim() ?? '';

        results.push({ title, url: href, snippet });
      }

      console.log('[searchAdaptor] searchDdg, results count:', results.length);
      return results;
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        console.warn('[searchAdaptor] searchDdg, timeout');
        return [];
      }
      throw err;
    }
  }
}

export const searchAdaptor = new SearchAdaptor();
