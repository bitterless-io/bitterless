import createDOMPurify, { type WindowLike } from 'dompurify';
import { ONLY_PREVIEW_MAX_HTML_BYTES } from '@shared/onlypreview/onlyPreview.types';

export type OnlyPreviewHtmlRenderResult =
  | { ok: true; html: string }
  | { ok: false; reason: 'too-large' | 'render-failed' };

const ONLY_PREVIEW_HTML_TAGS = [
  'main',
  'article',
  'section',
  'header',
  'footer',
  'aside',
  'nav',
  'div',
  'span',
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
  'dl',
  'dt',
  'dd',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'del',
  'mark',
  'small',
  'sub',
  'sup',
  'abbr',
  'cite',
  'q',
  'time',
  'address',
  'figure',
  'figcaption',
  'a',
  'code',
  'pre',
  'kbd',
  'samp',
  'var',
  'table',
  'caption',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td'
] as const;

const ONLY_PREVIEW_HTML_DISCARDED_CONTENT_TAGS = [
  'script',
  'style',
  'template',
  'noscript',
  'form',
  'button',
  'fieldset',
  'input',
  'label',
  'legend',
  'option',
  'optgroup',
  'select',
  'textarea',
  'datalist',
  'output',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'portal',
  'svg',
  'math',
  'audio',
  'video',
  'picture',
  'source',
  'track',
  'img',
  'image',
  'map',
  'area',
  'link',
  'base',
  'meta'
] as const;

export const renderOnlyPreviewHtml = (
  source: string,
  sourceSize: number,
  windowLike: WindowLike
): OnlyPreviewHtmlRenderResult => {
  if (!Number.isSafeInteger(sourceSize) || sourceSize < 0) {
    return { ok: false, reason: 'render-failed' };
  }

  const encodedSize = new TextEncoder().encode(source).byteLength;
  if (Math.max(sourceSize, encodedSize) > ONLY_PREVIEW_MAX_HTML_BYTES) {
    return { ok: false, reason: 'too-large' };
  }

  try {
    const purifier = createDOMPurify(windowLike);
    if (!purifier.isSupported) return { ok: false, reason: 'render-failed' };
    const html = purifier.sanitize(source, {
      ALLOWED_ATTR: [],
      ALLOWED_NAMESPACES: ['http://www.w3.org/1999/xhtml'],
      ALLOWED_TAGS: [...ONLY_PREVIEW_HTML_TAGS],
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      ADD_FORBID_CONTENTS: [...ONLY_PREVIEW_HTML_DISCARDED_CONTENT_TAGS],
      FORCE_BODY: true,
      KEEP_CONTENT: true,
      NAMESPACE: 'http://www.w3.org/1999/xhtml',
      RETURN_TRUSTED_TYPE: false
    });
    return { ok: true, html };
  } catch {
    return { ok: false, reason: 'render-failed' };
  }
};
