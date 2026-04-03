import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { chromium } from 'playwright';
import { pathHelper } from '@shared/pathHelper/preload/pathPreload.helper';
import type { ProxyConfig } from '../model.adaptor';
import { searchHelper } from '@preload/base/searchHelper/search.helper';
import type { SearchResult } from '@preload/base/searchHelper/search.helper';
import * as cheerio from 'cheerio';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'identity',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

const cleanText = (text: string): string => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/gm, '')
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '')
    .trim();
};

const extractContentFromHtml = (html: string): string => {
  const { document } = parseHTML(html);
  const reader = new Readability(document);
  const article = reader.parse();

  if (article?.textContent) {
    const cleaned = cleanText(article.textContent);
    return cleaned;
  }

  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, aside, iframe, noscript, [class*="ad"], [id*="ad"], [class*="banner"], [class*="sidebar"]').remove();
  return cleanText($('body').text());
};

const fetchSinglePage = async (url: string): Promise<string> => {
  console.log('[skill] fetch_page, using Playwright:', url);
  let browser;
  try {
    const chromiumPath = await pathHelper.getChromiumPath();
    console.log('[skill] fetch_page, chromium path:', chromiumPath);

    browser = await chromium.launch({
      headless: true,
      executablePath: chromiumPath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      userAgent: BROWSER_HEADERS['User-Agent'],
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    console.log('[skill] fetch_page, navigating to:', url);
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 10000,
    });

    console.log('[skill] fetch_page, page loaded, extracting content...');
    const html = await page.content();
    await browser.close();

    const content = extractContentFromHtml(html);
    console.log('[skill] fetch_page, playwright extracted, length:', content.length);
    return content.slice(0, 3000);
  } catch (err: any) {
    if (browser) await browser.close().catch(() => {});
    console.warn('[skill] fetch_page, playwright failed:', url, err?.message);
    return '';
  }
};

const fetchPageContent = async (urlOrUrls: string | string[]): Promise<{ urls: string[]; contents: string[] }> => {
  const urlList = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
  const contents = await Promise.all(urlList.map((u) => fetchSinglePage(u)));
  return { urls: urlList, contents };
};

export const createSearchWebSkill = (proxy?: ProxyConfig) => tool(
  async ({ query, maxResults = 5 }: {
    query: string;
    maxResults?: number;
  }) => {
    console.log('[skill] search_web, query:', query);
    try {
      const results = await searchHelper.searchBaidu(query, maxResults);
      if (results.length === 0) {
        return JSON.stringify({ message: 'No results found', query });
      }

      console.log('[skill] search_web, fetching page content for', results.length, 'results');
      const urls = results.map(r => r.url);
      const settledResults = await Promise.allSettled(urls.map(url => fetchSinglePage(url)));

      const resultsWithContent: SearchResult[] = [];
      for (let i = 0; i < results.length; i++) {
        const settled = settledResults[i];
        if (settled.status === 'fulfilled') {
          const content = settled.value;
          if (content && content.length >= 100) {
            resultsWithContent.push({
              ...results[i],
              pageContent: content,
            });
            if (resultsWithContent.length >= 3) {
              console.log('[skill] search_web, reached 3 results with content, stopping early');
              break;
            }
          } else {
            console.log('[skill] search_web, skipping result with insufficient content:', results[i].url);
          }
        } else {
          console.log('[skill] search_web, fetch failed for:', results[i].url, settled.reason?.message);
        }
      }

      if (resultsWithContent.length === 0) {
        return JSON.stringify({ message: 'No results with valid content found', query });
      }

      console.log('[skill] search_web, returning', resultsWithContent.length, 'results with content');
      return JSON.stringify({ query, results: resultsWithContent }, null, 2);
    } catch (err: any) {
      console.error('[skill] search_web error:', err?.code, err?.message);
      return JSON.stringify({ error: err.message, code: err?.code });
    }
  },
  {
    name: 'search_web',
    description:
      'Search Baidu and automatically fetch full page content from all search results. ' +
      'Returns search results with title, URL, snippet, and extracted page content (pageContent field). ' +
      'Only returns results where page content was successfully extracted (minimum 100 characters). ' +
      'This is a one-step tool that combines search and content extraction — no need to call any other tool afterward.',
    schema: z.object({
      query: z.string().describe('The search query. For time-sensitive queries include exact date from get_date, e.g. "上海天气 2026-03-08". Never use relative terms like "明天".'),
      maxResults: z.number().optional().describe('Max number of search results to fetch and extract content from, default 5'),
    }),
  },
);

// Commented out - functionality merged into createSearchWebSkill
// export const createFetchPageSkill = (proxy?: ProxyConfig) => tool(
//   async ({ url, urls }: { url?: string; urls?: string[] }) => {
//     const resolvedUrls: string[] = urls && urls.length > 0 ? urls : url ? [url] : [];
//     if (resolvedUrls.length === 0) {
//       return JSON.stringify({ error: 'No URL provided. Supply either url or urls.' });
//     }
//     console.log('[skill] fetch_page, urls:', resolvedUrls);
//     const { urls: fetchedUrls, contents } = await fetchPageContent(resolvedUrls);
//     const items = fetchedUrls.map((u, i) => ({
//       url: u,
//       status: contents[i] && contents[i].length >= 100 ? 'ok' : 'no_useful_content',
//       content: contents[i] && contents[i].length >= 100 ? contents[i] : '',
//     }));
//     return JSON.stringify({ urls: fetchedUrls, contents: items.map((it) => it.content), items });
//   },
//   {
//     name: 'fetch_page',
//     description:
//       'Fetch and extract the main readable text from one or more web page URLs. Accepts a single url or an array of urls. ' +
//       'Supports both static HTML and JavaScript-rendered pages (uses headless browser). ' +
//       'Returns { urls: string[], contents: string[], items: { url, status, content }[] }. ' +
//       'status is "ok" when useful content was extracted, or "no_useful_content" when the page is empty/blocked. ' +
//       'RULES: (1) Only call after search_web. (2) When search_web returns multiple results, pass all candidate URLs at once via urls[]. ' +
//       '(3) If all items have status=no_useful_content, try the next batch of URLs. (4) Stop as soon as content answers the question. (5) Maximum 20 URLs total across all calls.',
//     schema: z.object({
//       url: z.string().optional().describe('A single page URL to fetch. Use when fetching only one URL.'),
//       urls: z.array(z.string()).optional().describe('An array of page URLs to fetch in parallel. Prefer this over url when search_web returned multiple results.'),
//     }),
//   },
// );
