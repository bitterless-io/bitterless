const PAGE_SCRIPT_PATTERN = /\s*<script(?:\s[^>]*)?>[\s\S]*?<\/script>\s*/gi;
const PRIVILEGED_BLANK_RENDERER_PATHS = ['/trench-io/', '/fileSearch/'] as const;

export const stripPrivilegedRendererPageScripts = (html: string): string =>
  html.replace(PAGE_SCRIPT_PATTERN, '\n');

export const transformPrivilegedRendererHtml = (html: string, path: string): string =>
  PRIVILEGED_BLANK_RENDERER_PATHS.some((rendererPath) => path.includes(rendererPath))
    ? stripPrivilegedRendererPageScripts(html)
    : html;
