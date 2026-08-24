import {
  OnlyPreviewDocumentCssSanitizer,
  type OnlyPreviewDocumentCssContext
} from './onlyPreviewDocumentCssSanitizer.service';

export class OnlyPreviewDocumentSanitizerError extends Error {
  readonly code = 'DOCUMENT_SANITIZE_FAILED' as const;

  constructor() {
    super('Document output could not be sanitized.');
    this.name = 'OnlyPreviewDocumentSanitizerError';
  }
}

export interface OnlyPreviewDocumentSanitizeResult {
  fragment: DocumentFragment;
  cssText: string;
  usedBlobUrls: ReadonlySet<string>;
  hasRenderableContent: boolean;
}

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

const ALLOWED_TAGS = new Set([
  'article',
  'b',
  'br',
  'col',
  'colgroup',
  'del',
  'div',
  'em',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  's',
  'section',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
  'wbr'
]);

const RENDERABLE_TAGS = new Set(['img', 'table']);
const URI_ATTRIBUTES = new Set([
  'action',
  'background',
  'cite',
  'data',
  'formaction',
  'href',
  'poster',
  'src',
  'srcset',
  'xlink:href'
]);

const fail = (): never => {
  throw new OnlyPreviewDocumentSanitizerError();
};

const cssSanitizer = new OnlyPreviewDocumentCssSanitizer(fail);

const hasUnsafeControlCharacter = (value: string, allowCssWhitespace = false): boolean => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 0x7f) return true;
    if (code >= 0x20) continue;
    if (allowCssWhitespace && (code === 0x09 || code === 0x0a || code === 0x0d)) continue;
    return true;
  }
  return false;
};

const collectElementBlobUrls = (root: HTMLElement, output: Set<string>): void => {
  const elements = [root, ...root.querySelectorAll('*')];
  for (const element of elements) {
    for (const attribute of [...element.attributes]) {
      const attributeName = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (attributeName === 'style') {
        cssSanitizer.collectValueBlobUrls(value, output);
        continue;
      }
      if (URI_ATTRIBUTES.has(attributeName) && value) {
        if (attributeName === 'href' && element.localName.toLowerCase() === 'a') continue;
        if (attributeName !== 'src' || element.localName.toLowerCase() !== 'img') fail();
        output.add(cssSanitizer.validateBlobUrl(value));
        continue;
      }
      for (const match of value.matchAll(/blob:[^\s"'<>),;]+/gi)) {
        output.add(cssSanitizer.validateBlobUrl(match[0]));
      }
    }
  }
};

const collectStyleText = (style: HTMLElement): string => {
  const cssText: string[] = [];
  for (const node of [...style.childNodes]) {
    if (node.nodeType === 8) continue;
    if (node.nodeType === 3) {
      if (node.textContent?.trim()) fail();
      continue;
    }
    if (
      node.nodeType !== 1 ||
      (node as Element).namespaceURI !== HTML_NAMESPACE ||
      (node as Element).localName.toLowerCase() !== 'style' ||
      (node as Element).attributes.length > 0
    ) {
      fail();
    }
    for (const child of [...node.childNodes]) {
      if (child.nodeType !== 3) fail();
    }
    cssText.push(node.textContent || '');
  }
  return cssText.join('\n');
};

export const collectOnlyPreviewDocumentBlobUrls = (
  body: HTMLElement,
  style: HTMLElement
): Set<string> => {
  const output = new Set<string>();
  collectElementBlobUrls(body, output);
  cssSanitizer.collectStylesheetBlobUrls(collectStyleText(style), output);
  return output;
};

const sanitizeClass = (value: string): string => {
  if (value.length > 4096) fail();
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (!tokens.every((token) => /^-?[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(token))) fail();
  return tokens.join(' ');
};

const sanitizeSpan = (value: string): string => {
  if (!/^[1-9][0-9]{0,2}$/.test(value)) fail();
  const parsed = Number(value);
  if (parsed > 1000) fail();
  return String(parsed);
};

const cloneSafeNode = (
  source: Node,
  document: Document,
  context: OnlyPreviewDocumentCssContext,
  renderable: { value: boolean }
): Node | null => {
  if (source.nodeType === 8) return null;
  if (source.nodeType === 3) {
    const text = source.textContent || '';
    if (text.trim()) renderable.value = true;
    return document.createTextNode(text);
  }
  if (source.nodeType !== 1) return fail();

  const sourceElement = source as Element;
  if (sourceElement.namespaceURI !== HTML_NAMESPACE) fail();
  const sourceTagName = sourceElement.localName.toLowerCase();
  const tagName = sourceTagName === 'a' ? 'span' : sourceTagName;
  if (sourceTagName !== 'a' && !ALLOWED_TAGS.has(tagName)) fail();
  const clone = document.createElement(tagName);
  if (RENDERABLE_TAGS.has(tagName)) renderable.value = true;

  for (const attribute of [...sourceElement.attributes]) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value;
    if (name.startsWith('on')) fail();
    if (name === 'id') continue;
    if (sourceTagName === 'a' && name === 'href') continue;
    if (name === 'class') {
      const sanitized = sanitizeClass(value);
      if (sanitized) clone.setAttribute('class', sanitized);
      continue;
    }
    if (name === 'style') {
      clone.setAttribute('style', cssSanitizer.sanitizeInlineStyle(value, context));
      continue;
    }
    if (name === 'lang') {
      if (!/^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value)) fail();
      clone.setAttribute('lang', value);
      continue;
    }
    if (tagName === 'img' && name === 'src') {
      const safeUrl = cssSanitizer.validateBlobUrl(value, context.verifiedBlobUrls);
      context.usedBlobUrls.add(safeUrl);
      clone.setAttribute('src', safeUrl);
      continue;
    }
    if (tagName === 'img' && name === 'alt') {
      if (value.length > 1024 || hasUnsafeControlCharacter(value, true)) fail();
      clone.setAttribute('alt', value);
      continue;
    }
    if ((tagName === 'td' || tagName === 'th') && (name === 'colspan' || name === 'rowspan')) {
      clone.setAttribute(name, sanitizeSpan(value));
      continue;
    }
    if (tagName === 'col' && name === 'span') {
      clone.setAttribute(name, sanitizeSpan(value));
      continue;
    }
    fail();
  }

  if (tagName === 'img' && !clone.hasAttribute('src')) fail();
  for (const child of [...source.childNodes]) {
    const clonedChild = cloneSafeNode(child, document, context, renderable);
    if (clonedChild) clone.append(clonedChild);
  }
  return clone;
};

export const sanitizeOnlyPreviewDocument = (
  body: HTMLElement,
  style: HTMLElement,
  verifiedBlobUrls: ReadonlySet<string>
): OnlyPreviewDocumentSanitizeResult => {
  if (body.ownerDocument !== style.ownerDocument) fail();
  for (const value of verifiedBlobUrls) cssSanitizer.validateBlobUrl(value);

  const usedBlobUrls = new Set<string>();
  const sanitizedCss = cssSanitizer.sanitizeStylesheet(
    collectStyleText(style),
    verifiedBlobUrls,
    usedBlobUrls
  );
  const fragment = body.ownerDocument.createDocumentFragment();
  const renderable = { value: false };
  for (const child of [...body.childNodes]) {
    const clone = cloneSafeNode(child, body.ownerDocument, sanitizedCss.context, renderable);
    if (clone) fragment.append(clone);
  }

  return {
    fragment,
    cssText: sanitizedCss.cssText,
    usedBlobUrls,
    hasRenderableContent: renderable.value
  };
};
