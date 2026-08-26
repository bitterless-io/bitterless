import createDOMPurify, { type WindowLike } from 'dompurify';

const STATIC_TAGS = [
  'article',
  'aside',
  'blockquote',
  'br',
  'code',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'mark',
  'ol',
  'p',
  'pre',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul'
] as const;

export const sanitizeOnlyPreviewStaticHtml = (source: string, windowLike: WindowLike): string => {
  const purifier = createDOMPurify(windowLike);
  if (!purifier.isSupported) return '';
  return purifier.sanitize(source, {
    ALLOWED_ATTR: [],
    ALLOWED_NAMESPACES: ['http://www.w3.org/1999/xhtml'],
    ALLOWED_TAGS: [...STATIC_TAGS],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: [
      'audio',
      'base',
      'embed',
      'form',
      'iframe',
      'img',
      'input',
      'link',
      'meta',
      'object',
      'script',
      'source',
      'style',
      'svg',
      'template',
      'video'
    ],
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false
  });
};
