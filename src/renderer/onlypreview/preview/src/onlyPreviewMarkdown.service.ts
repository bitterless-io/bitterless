import createDOMPurify, { type WindowLike } from 'dompurify';
import { Marked, Renderer, type Tokens } from 'marked';
import { ONLY_PREVIEW_MAX_MARKDOWN_BYTES } from '@shared/onlypreview/onlyPreview.types';

export type OnlyPreviewMarkdownRenderResult =
  | { ok: true; html: string }
  | { ok: false; reason: 'too-large' | 'render-failed' };

const ONLY_PREVIEW_MARKDOWN_TAGS = [
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'a',
  'span'
] as const;

export const stripOnlyPreviewFrontMatter = (source: string): string => {
  const text = source.startsWith('\uFEFF') ? source.slice(1) : source;
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return source;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] !== '---' && lines[index] !== '...') continue;
    return lines.slice(index + 1).join('\n');
  }
  return source;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

class OnlyPreviewMarkdownRenderer extends Renderer {
  html({ text }: Tokens.HTML | Tokens.Tag): string {
    return escapeHtml(text);
  }

  image({ text }: Tokens.Image): string {
    return `<em>[Image: ${escapeHtml(text.trim() || 'image')}]</em>`;
  }

  link({ tokens }: Tokens.Link): string {
    return `<a>${this.parser.parseInline(tokens)}</a>`;
  }
}

const markdownParser = new Marked();

export const renderOnlyPreviewMarkdown = (
  source: string,
  sourceSize: number,
  windowLike: WindowLike
): OnlyPreviewMarkdownRenderResult => {
  if (!Number.isSafeInteger(sourceSize) || sourceSize < 0) {
    return { ok: false, reason: 'render-failed' };
  }

  if (sourceSize > ONLY_PREVIEW_MAX_MARKDOWN_BYTES) {
    return { ok: false, reason: 'too-large' };
  }

  try {
    const purifier = createDOMPurify(windowLike);
    if (!purifier.isSupported) return { ok: false, reason: 'render-failed' };
    const parsed = markdownParser.parse(stripOnlyPreviewFrontMatter(source), {
      async: false,
      breaks: false,
      gfm: true,
      renderer: new OnlyPreviewMarkdownRenderer()
    });
    const html = purifier.sanitize(parsed, {
      ALLOWED_ATTR: [],
      ALLOWED_NAMESPACES: ['http://www.w3.org/1999/xhtml'],
      ALLOWED_TAGS: [...ONLY_PREVIEW_MARKDOWN_TAGS],
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: true,
      RETURN_TRUSTED_TYPE: false
    });
    return { ok: true, html };
  } catch {
    return { ok: false, reason: 'render-failed' };
  }
};
