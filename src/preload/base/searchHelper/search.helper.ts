import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

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

class SearchHelper {
  async searchBaidu(query: string, maxResults: number): Promise<SearchResult[]> {
    const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${maxResults}&ie=utf-8`;
    console.log('[searchHelper] searchBaidu, url:', searchUrl);

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

      console.log('[searchHelper] searchBaidu, status:', response.status);
      const html = await response.text();
      console.log('[searchHelper] searchBaidu, html sample:', html.slice(0, 2000));
      const $ = cheerio.load(html);

      const results: SearchResult[] = [];

      $('[class*="result"]').each((i, el) => {
        if (results.length >= maxResults) return false;
        const titleEl = $(el).find('h3 a').first();
        const title = titleEl.text().trim();
        let href = titleEl.attr('href') ?? '';

        console.log(`[searchHelper] searchBaidu, result[${i}] title="${title}" href="${href}"`);

        if (!title || !href) return;

        if (href.startsWith('/')) {
          href = `https://www.baidu.com${href}`;
        }

        const snippet = $(el).find('[class*="abstract"], [class*="content"], [class*="desc"]').first().text().trim();

        results.push({ title, url: href, snippet });
      });

      console.log('[searchHelper] searchBaidu, results count:', results.length);
      return results;
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        console.warn('[searchHelper] searchBaidu, timeout');
        return [];
      }
      throw err;
    }
  }

  async searchDdg(query: string, maxResults: number): Promise<SearchResult[]> {
    const searchUrl = 'https://html.duckduckgo.com/html/';
    console.log('[searchHelper] searchDdg, query:', query);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const formData = `q=${encodeURIComponent(query)}&b=&kl=&df=`;

      const response = await fetch(searchUrl, {
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
      } as any);
      clearTimeout(timeout);

      console.log('[searchHelper] searchDdg, status:', response.status);
      const html = await response.text();
      console.log('[searchHelper] searchDdg, html sample:', html.slice(0, 2000));
      const $ = cheerio.load(html);

      const results: SearchResult[] = [];

      $('.result').each((i, el) => {
        if (results.length >= maxResults) return false;

        const $el = $(el);
        if ($el.hasClass('result--ad')) {
          console.log(`[searchHelper] searchDdg, skipping ad result[${i}]`);
          return;
        }

        const titleEl = $el.find('h2.result__title a.result__a').first();
        const title = titleEl.text().trim();
        const href = titleEl.attr('href') ?? '';

        console.log(`[searchHelper] searchDdg, result[${i}] title="${title}" href="${href}"`);

        if (!title || !href) return;

        const snippet = $el.find('a.result__snippet').first().text().trim();

        results.push({ title, url: href, snippet });
      });

      console.log('[searchHelper] searchDdg, results count:', results.length);
      return results;
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        console.warn('[searchHelper] searchDdg, timeout');
        return [];
      }
      throw err;
    }
  }
}

export const searchHelper = new SearchHelper();
