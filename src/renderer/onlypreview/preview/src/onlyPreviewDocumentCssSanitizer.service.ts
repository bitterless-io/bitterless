import postcss, {
  type AtRule,
  type ChildNode,
  type Declaration,
  type Root,
  type Rule
} from 'postcss';

export interface OnlyPreviewDocumentCssContext {
  fontVariables: ReadonlyMap<string, readonly string[]>;
  usedBlobUrls: Set<string>;
  verifiedBlobUrls: ReadonlySet<string>;
}

export interface OnlyPreviewDocumentCssResult {
  cssText: string;
  context: OnlyPreviewDocumentCssContext;
}

const SYSTEM_FONT_FALLBACK = [
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'sans-serif'
] as const;

const ALLOWED_CSS_PROPERTIES = new Set([
  'align-items',
  'align-self',
  'background',
  'background-color',
  'background-image',
  'border',
  'border-bottom',
  'border-bottom-color',
  'border-bottom-style',
  'border-bottom-width',
  'border-collapse',
  'border-color',
  'border-left',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-radius',
  'border-right',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-spacing',
  'border-style',
  'border-top',
  'border-top-color',
  'border-top-style',
  'border-top-width',
  'border-width',
  'bottom',
  'box-shadow',
  'box-sizing',
  'break-after',
  'break-before',
  'break-inside',
  'clear',
  'clip',
  'clip-path',
  'color',
  'column-count',
  'column-gap',
  'column-rule',
  'column-rule-color',
  'column-rule-style',
  'column-rule-width',
  'content',
  'counter-increment',
  'counter-reset',
  'counter-set',
  'direction',
  'display',
  'fill',
  'flex',
  'flex-basis',
  'flex-direction',
  'flex-flow',
  'flex-grow',
  'flex-shrink',
  'flex-wrap',
  'float',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'gap',
  'height',
  'hyphens',
  'justify-content',
  'left',
  'letter-spacing',
  'line-height',
  'list-style-position',
  'list-style-type',
  'margin',
  'margin-block-end',
  'margin-block-start',
  'margin-bottom',
  'margin-inline-end',
  'margin-inline-start',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'opacity',
  'orphans',
  'overflow',
  'overflow-wrap',
  'overflow-x',
  'overflow-y',
  'padding',
  'padding-block-end',
  'padding-block-start',
  'padding-bottom',
  'padding-inline-end',
  'padding-inline-start',
  'padding-left',
  'padding-right',
  'padding-top',
  'page-break-after',
  'page-break-before',
  'page-break-inside',
  'position',
  'right',
  'table-layout',
  'text-align',
  'text-decoration',
  'text-decoration-color',
  'text-decoration-line',
  'text-decoration-style',
  'text-indent',
  'text-shadow',
  'text-transform',
  'text-underline-position',
  'top',
  'transform',
  'transform-origin',
  'vertical-align',
  'visibility',
  'white-space',
  'widows',
  'width',
  'word-break',
  'word-spacing',
  'writing-mode',
  'z-index'
]);

const URL_CSS_PROPERTIES = new Set(['background', 'background-image']);
const SAFE_CSS_FUNCTIONS = new Set([
  'calc',
  'clamp',
  'counter',
  'counters',
  'hsl',
  'hsla',
  'linear-gradient',
  'matrix',
  'max',
  'min',
  'rect',
  'repeating-linear-gradient',
  'rgb',
  'rgba',
  'rotate',
  'scale',
  'translate',
  'translatex',
  'translatey',
  'url',
  'var'
]);

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

const hasUrlDelimiter = (value: string): boolean => {
  for (const character of value) {
    if (character.charCodeAt(0) <= 0x20 || `"'()<>`.includes(character)) return true;
  }
  return false;
};

const decodeCssEscapes = (value: string): string =>
  value.replace(/\\(?:([0-9a-fA-F]{1,6})[\t\n\f\r ]?|\r\n|[\n\r\f]|(.))/g, (_, hex, escaped) => {
    if (hex) {
      const point = Number.parseInt(hex, 16);
      if (point === 0 || point > 0x10ffff) return '\uFFFD';
      return String.fromCodePoint(point);
    }
    return escaped || '';
  });

interface CssUrlScan {
  urls: string[];
  textWithoutUrls: string;
}

export class OnlyPreviewDocumentCssSanitizer {
  constructor(private readonly fail: () => never) {}

  validateBlobUrl(value: string, verifiedBlobUrls?: ReadonlySet<string>): string {
    if (value !== value.trim() || !value.startsWith('blob:')) return this.fail();
    try {
      if (new URL(value).protocol !== 'blob:') return this.fail();
    } catch {
      return this.fail();
    }
    if (verifiedBlobUrls && !verifiedBlobUrls.has(value)) return this.fail();
    return value;
  }

  collectValueBlobUrls(value: string, output: Set<string>): void {
    const scan = this.scanCssUrls(value);
    for (const url of scan.urls) output.add(this.validateBlobUrl(url));
    if (
      /\b(?:blob|data|file|https?|javascript):/i.test(scan.textWithoutUrls) ||
      /\b[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(scan.textWithoutUrls)
    ) {
      this.fail();
    }
  }

  collectStylesheetBlobUrls(cssText: string, output: Set<string>): void {
    const root = this.parseCss(cssText);
    root.walkAtRules((rule) => {
      if (!this.isOnlyPreviewNotPrintRule(rule)) this.fail();
    });
    root.walkDecls((declaration) => this.collectValueBlobUrls(declaration.value, output));
  }

  sanitizeStylesheet(
    cssText: string,
    verifiedBlobUrls: ReadonlySet<string>,
    usedBlobUrls: Set<string>
  ): OnlyPreviewDocumentCssResult {
    const root = this.parseCss(cssText);
    const fontVariables = this.collectFontVariables(root);
    const context = { fontVariables, usedBlobUrls, verifiedBlobUrls };
    const sanitizeNodes = (nodes: readonly ChildNode[], allowNotPrint: boolean): string[] => {
      const rules: string[] = [];
      for (const node of nodes) {
        if (node.type === 'comment') continue;
        if (node.type === 'rule') {
          const sanitized = this.sanitizeRule(node as Rule, context);
          if (sanitized) rules.push(sanitized);
          continue;
        }
        if (
          node.type === 'atrule' &&
          allowNotPrint &&
          this.isOnlyPreviewNotPrintRule(node as AtRule)
        ) {
          rules.push(...sanitizeNodes((node as AtRule).nodes || [], false));
          continue;
        }
        this.fail();
      }
      return rules;
    };
    return { cssText: sanitizeNodes(root.nodes, true).join('\n'), context };
  }

  sanitizeInlineStyle(value: string, context: OnlyPreviewDocumentCssContext): string {
    const root = this.parseCss(`.onlypreview-docx { ${value} }`);
    const rule = root.first;
    if (root.nodes.length !== 1 || !rule || rule.type !== 'rule') return this.fail();
    const output: string[] = [];
    for (const node of rule.nodes || []) {
      if (node.type === 'comment' || node.type !== 'decl') this.fail();
      const declaration = this.sanitizeDeclaration(node as Declaration, context);
      output.push(`${declaration.property}: ${declaration.value}`);
    }
    if (output.length === 0) return this.fail();
    return `${output.join('; ')};`;
  }

  private scanCssUrls(value: string): CssUrlScan {
    if (value.includes('/*') || value.includes('*/')) return this.fail();
    const decoded = decodeCssEscapes(value);
    const urls: string[] = [];
    const masked = [...decoded];
    const matcher = /(^|[^-_a-zA-Z0-9])url\s*\(/gi;
    let match: RegExpExecArray | null;

    while ((match = matcher.exec(decoded))) {
      const functionStart = match.index + match[1].length;
      let cursor = matcher.lastIndex;
      let quote = '';
      let closed = false;
      while (cursor < decoded.length) {
        const character = decoded[cursor];
        if (quote) {
          if (character === quote) quote = '';
        } else if (character === '"' || character === "'") {
          quote = character;
        } else if (character === ')') {
          closed = true;
          break;
        } else if (character === '(') {
          this.fail();
        }
        cursor += 1;
      }
      if (!closed || quote) this.fail();
      let url = decoded.slice(matcher.lastIndex, cursor).trim();
      if (
        (url.startsWith('"') && url.endsWith('"')) ||
        (url.startsWith("'") && url.endsWith("'"))
      ) {
        url = url.slice(1, -1).trim();
      }
      if (!url || hasUrlDelimiter(url)) this.fail();
      urls.push(url);
      for (let index = functionStart; index <= cursor; index += 1) masked[index] = ' ';
      matcher.lastIndex = cursor + 1;
    }

    if (/(^|[^-_a-zA-Z0-9])url\s*\(/i.test(masked.join(''))) this.fail();
    return { urls, textWithoutUrls: masked.join('') };
  }

  private parseCss(cssText: string): Root {
    try {
      return postcss.parse(cssText, { from: undefined });
    } catch {
      return this.fail();
    }
  }

  private isOnlyPreviewNotPrintRule(rule: AtRule): boolean {
    return (
      rule.name.toLowerCase() === 'media' &&
      rule.params.trim().replace(/\s+/g, ' ').toLowerCase() === 'not print' &&
      Array.isArray(rule.nodes)
    );
  }

  private validateSelector(selector: string): string {
    const normalized = selector.trim().replace(/\s+/g, ' ');
    if (
      !normalized ||
      normalized.length > 2048 ||
      !/^[A-Za-z0-9_.\s>,:_-]+$/.test(normalized) ||
      /[+~]/.test(normalized)
    ) {
      return this.fail();
    }
    for (const component of normalized.split(',')) {
      if (
        !/(?:^|[\s>])(?:[a-z][a-z0-9-]*)?\.onlypreview-docx(?:[-_][A-Za-z0-9_-]+)?(?=$|[\s>.,:])/i.test(
          component.trim()
        )
      ) {
        return this.fail();
      }
      for (const pseudo of component.matchAll(/:{1,2}([A-Za-z-]+)/g)) {
        if (!['after', 'before'].includes(pseudo[1].toLowerCase())) this.fail();
      }
    }
    return normalized;
  }

  private splitFontFamilies(value: string): string[] | null {
    const families: string[] = [];
    let current = '';
    let quote = '';
    for (const character of value) {
      if (quote) {
        if (character === quote) quote = '';
        current += character;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        current += character;
        continue;
      }
      if (character === ',') {
        families.push(current.trim());
        current = '';
        continue;
      }
      current += character;
    }
    if (quote) return null;
    families.push(current.trim());
    return families.every(Boolean) ? families : null;
  }

  private normalizeSingleFontFamily(value: string): string | null {
    const genericFamilies = new Set([
      'cursive',
      'emoji',
      'fangsong',
      'fantasy',
      'math',
      'monospace',
      'sans-serif',
      'serif',
      'system-ui',
      'ui-monospace',
      'ui-rounded',
      'ui-sans-serif',
      'ui-serif'
    ]);
    const cssWide = new Set(['inherit', 'initial', 'revert', 'revert-layer', 'unset']);
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 160 || /[\\;{}@()]/.test(trimmed)) return null;

    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      const content = trimmed.slice(1, -1);
      if (
        !content ||
        content.length > 128 ||
        /["'\\]/.test(content) ||
        hasUnsafeControlCharacter(content)
      ) {
        return null;
      }
      return JSON.stringify(content);
    }

    const lower = trimmed.toLowerCase();
    if (cssWide.has(lower)) return null;
    if (genericFamilies.has(lower)) return lower;
    const words = trimmed.split(/\s+/);
    if (!words.every((word) => /^-?[_A-Za-z][-_A-Za-z0-9]*$/.test(word))) return null;
    return words.join(' ');
  }

  private parseFontFamilyList(value: string): string[] | null {
    const split = this.splitFontFamilies(value);
    if (!split) return null;
    const normalized = split.map((family) => this.normalizeSingleFontFamily(family));
    return normalized.every((family): family is string => family !== null) ? normalized : null;
  }

  private appendSystemFontFallback(families: readonly string[]): string {
    const fallbackKeys = new Set(
      SYSTEM_FONT_FALLBACK.map((family) => family.replaceAll('"', '').toLowerCase())
    );
    const preserved = families.filter(
      (family) => !fallbackKeys.has(family.replaceAll('"', '').toLowerCase())
    );
    return [...preserved, ...SYSTEM_FONT_FALLBACK].join(', ');
  }

  private resolveFontFamily(
    rawValue: string,
    fontVariables: ReadonlyMap<string, readonly string[]>
  ): string {
    if (/\burl\s*\(/i.test(decodeCssEscapes(rawValue))) return this.fail();
    const variable = rawValue.match(/^\s*var\(\s*(--docx-[A-Za-z0-9_-]+-font)\s*\)\s*$/i);
    if (variable) return this.appendSystemFontFallback(fontVariables.get(variable[1]) || []);
    if (/\bvar\s*\(/i.test(decodeCssEscapes(rawValue))) {
      return this.appendSystemFontFallback([]);
    }
    const families = this.parseFontFamilyList(rawValue);
    if (!families) return this.fail();
    return this.appendSystemFontFallback(families);
  }

  private validateContentValue(value: string): string {
    const decoded = decodeCssEscapes(value).trim();
    if (
      /\b(?:blob|data|file|https?|javascript):/i.test(decoded) ||
      /\b[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(decoded)
    ) {
      this.fail();
    }
    if (decoded === 'none' || decoded === 'normal') return decoded;
    if (
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) &&
      !hasUnsafeControlCharacter(value.slice(1, -1))
    ) {
      return value;
    }
    if (/^counters?\([A-Za-z0-9_-]+(?:\s*,\s*[A-Za-z0-9_-]+){0,2}\)$/.test(value)) {
      return value;
    }
    return this.fail();
  }

  private validateVariableReferences(value: string): void {
    const decoded = decodeCssEscapes(value);
    for (const match of decoded.matchAll(/\bvar\s*\(([^)]*)\)/gi)) {
      if (!/^\s*--(?:docx|onlypreview-docx)-[A-Za-z0-9_-]+\s*$/.test(match[1])) this.fail();
    }
    const withoutVariables = decoded.replace(/\bvar\s*\([^)]*\)/gi, '');
    if (/\bvar\s*\(/i.test(withoutVariables)) this.fail();
  }

  private validateCssFunctions(value: string): void {
    const decoded = decodeCssEscapes(value);
    const withoutStrings = decoded.replace(/"[^"\r\n]*"|'[^'\r\n]*'/g, '');
    for (const match of withoutStrings.matchAll(
      /(^|[^-_a-zA-Z0-9])(-?[_a-zA-Z][-_a-zA-Z0-9]*)\s*\(/g
    )) {
      if (!SAFE_CSS_FUNCTIONS.has(match[2].toLowerCase())) this.fail();
    }
  }

  private sanitizeDeclaration(
    declaration: Declaration,
    context: OnlyPreviewDocumentCssContext
  ): { property: string; value: string } {
    const rawProperty = declaration.prop.trim();
    const property = rawProperty.toLowerCase();
    const rawValue = declaration.value.trim();
    if (
      !rawProperty ||
      rawProperty.includes('\\') ||
      declaration.important ||
      !rawValue ||
      rawValue.length > 4096 ||
      hasUnsafeControlCharacter(rawValue, true) ||
      /[;{}@]/.test(rawValue) ||
      rawValue.includes('/*') ||
      rawValue.includes('*/')
    ) {
      return this.fail();
    }

    const isCustomProperty = /^--(?:docx|onlypreview-docx)-[A-Za-z0-9_-]+$/.test(rawProperty);
    if (!isCustomProperty && !ALLOWED_CSS_PROPERTIES.has(property)) this.fail();
    if (property === 'font-family') {
      return { property, value: this.resolveFontFamily(rawValue, context.fontVariables) };
    }
    if (property === 'content') {
      return { property, value: this.validateContentValue(rawValue) };
    }

    const decoded = decodeCssEscapes(rawValue);
    if (
      /\b(?:behavior|-moz-binding)\s*:/i.test(decoded) ||
      /\bexpression\s*\(/i.test(decoded) ||
      /\bjavascript\s*:/i.test(decoded)
    ) {
      this.fail();
    }
    if (rawValue.includes('\\')) this.fail();
    this.validateVariableReferences(rawValue);
    this.validateCssFunctions(rawValue);

    const scan = this.scanCssUrls(rawValue);
    if (scan.urls.length > 0 && !isCustomProperty && !URL_CSS_PROPERTIES.has(property)) {
      this.fail();
    }
    for (const url of scan.urls) {
      context.usedBlobUrls.add(this.validateBlobUrl(url, context.verifiedBlobUrls));
    }
    if (/\b(?:blob|data|file|https?|javascript):/i.test(scan.textWithoutUrls)) this.fail();
    return { property: isCustomProperty ? rawProperty : property, value: rawValue };
  }

  private collectFontVariables(root: Root): Map<string, readonly string[]> {
    const output = new Map<string, readonly string[]>();
    root.walkDecls((declaration) => {
      if (!/^--docx-[A-Za-z0-9_-]+-font$/i.test(declaration.prop)) return;
      if (declaration.important || declaration.value.includes('\\')) this.fail();
      const families = this.parseFontFamilyList(declaration.value);
      if (!families) this.fail();
      output.set(declaration.prop, families);
    });
    return output;
  }

  private sanitizeRule(rule: Rule, context: OnlyPreviewDocumentCssContext): string {
    const selector = this.validateSelector(rule.selector);
    const declarations: string[] = [];
    for (const node of rule.nodes || []) {
      if (node.type === 'comment') continue;
      if (node.type !== 'decl') this.fail();
      const declaration = this.sanitizeDeclaration(node as Declaration, context);
      declarations.push(`  ${declaration.property}: ${declaration.value};`);
    }
    return declarations.length > 0 ? `${selector} {\n${declarations.join('\n')}\n}` : '';
  }
}
