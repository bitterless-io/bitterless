import { randomBytes } from 'node:crypto';
import { posix } from 'node:path';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import {
  normalizeOnlyPreviewRelativePath,
  OnlyPreviewContractError
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES,
  ONLY_PREVIEW_MAX_HTML_BYTES,
  ONLY_PREVIEW_SCHEME
} from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewPreviewReadPreparedSelection } from '@shared/onlypreview/onlyPreviewPreviewReadRuntime.types';
import { createOnlyPreviewReadResponse } from './onlyPreviewAsset.registry';
import { onlyPreviewHostRegistry, type OnlyPreviewHostRegistry } from './onlyPreviewHost.registry';
import {
  onlyPreviewWorkspaceRegistry,
  type OnlyPreviewWorkspaceRegistry
} from './onlyPreviewWorkspace.registry';

const MAX_DOCUMENT_TOKENS = 64;
const DOCUMENT_TOKEN_TTL_MS = 30 * 60 * 1000;
// A previewed HTML file has to render the way it would in a browser — its own scripts, stylesheets,
// workers and frames, its same-document fetches, and its remote dependencies (owner decision
// 2026-09-03: 「cors csp 都放开不要有安全限制」). The page that prompted this does
// `import mermaid from 'https://cdn.jsdelivr.net/…'`, so a policy without an `https:` source shows
// the owner a half-rendered document.
//
// `'self'` is the one-shot document token, so same-origin means the file's own sibling resources.
// `base-uri` and `form-action` stay `'none'`: they change where the page *sends* to rather than what
// it renders. The session keeps refusing downloads, permissions, WebRTC, and every `file:`/`ftp:`
// request, so a page still cannot read anything else on disk.
const DOCUMENT_SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self' https: data: blob:",
    "script-src 'self' https: 'unsafe-inline' 'unsafe-eval' data: blob:",
    "style-src 'self' https: 'unsafe-inline' data: blob:",
    "img-src 'self' https: data: blob:",
    "font-src 'self' https: data: blob:",
    "media-src 'self' https: data: blob:",
    "connect-src 'self' https: wss: data: blob:",
    "child-src 'self' https: data: blob:",
    "frame-src 'self' https: data: blob:",
    "object-src 'self' https: data: blob:",
    "worker-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'none'",
    "webrtc 'block'"
  ].join('; '),
  'X-DNS-Prefetch-Control': 'off',
  'Permissions-Policy': 'camera=(), microphone=(), display-capture=()',
  'Referrer-Policy': 'no-referrer'
});

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  '.aac': 'audio/aac',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.css': 'text/css; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.flac': 'audio/flac',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.m4v': 'video/x-m4v',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.ogg': 'audio/ogg',
  '.ogv': 'video/ogg',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8'
});

interface DocumentTokenRecord {
  token: string;
  hostToken: string;
  workspaceId: string;
  grantId: string;
  selectionRevision: number;
  entryRequestPath: string;
  createdAt: number;
  activeSessions: Set<string>;
}

const encodeDocumentPath = (relativePath: string): string =>
  relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

const parseDocumentRequest = (
  requestUrl: string
): { token: string; relativePath: string } | null => {
  const match = new RegExp(
    `^${ONLY_PREVIEW_SCHEME}:\\/\\/document\\/([a-f0-9]{64})\\/([^?#]+)$`
  ).exec(requestUrl);
  if (!match || /%2f|%5c/i.test(match[2]) || match[2].includes('\\')) return null;
  const decodedSegments: string[] = [];
  for (const encodedSegment of match[2].split('/')) {
    let segment: string;
    try {
      segment = decodeURIComponent(encodedSegment);
    } catch {
      return null;
    }
    if (
      encodedSegment !== encodeURIComponent(segment) ||
      !segment ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\') ||
      segment.includes('?') ||
      segment.includes('#') ||
      segment.includes('\0')
    ) {
      return null;
    }
    decodedSegments.push(segment);
  }
  try {
    return {
      token: match[1],
      relativePath: normalizeOnlyPreviewRelativePath(decodedSegments.join('/'))
    };
  } catch {
    return null;
  }
};

const mimeTypeFor = (relativePath: string): string =>
  MIME_BY_EXTENSION[posix.extname(relativePath).toLowerCase()] ?? 'application/octet-stream';

export class OnlyPreviewDocumentRegistry {
  private readonly documents = new Map<string, DocumentTokenRecord>();

  constructor(
    private readonly hosts: OnlyPreviewHostRegistry,
    workspaces: OnlyPreviewWorkspaceRegistry
  ) {
    hosts.onRevoke((host) => this.revokeHost(host.hostToken));
    workspaces.onRevoke((workspace) => this.revokeWorkspace(workspace.workspaceId));
  }

  issue(
    hostToken: string,
    selection: OnlyPreviewPreviewReadPreparedSelection,
    selectionRevision: number
  ): string {
    this.hosts.require(hostToken, ['content']);
    if (
      !Number.isSafeInteger(selectionRevision) ||
      selectionRevision < 1 ||
      selection.selectionRevision !== selectionRevision ||
      (selection.descriptor.extension !== '.html' && selection.descriptor.extension !== '.htm')
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Document revision is invalid.');
    }
    if (selection.descriptor.size > ONLY_PREVIEW_MAX_HTML_BYTES) {
      throw new OnlyPreviewContractError('PROTOCOL_ERROR', 'HTML preview is limited to 1 MiB.');
    }
    while (this.documents.size >= MAX_DOCUMENT_TOKENS) {
      const oldest = this.documents.keys().next().value as string | undefined;
      if (!oldest) break;
      this.revokeToken(oldest);
    }
    const token = randomBytes(32).toString('hex');
    const entryRequestPath = posix.basename(selection.relativePath);
    this.documents.set(token, {
      token,
      hostToken,
      workspaceId: selection.workspaceId,
      grantId: selection.grantId,
      selectionRevision,
      entryRequestPath,
      createdAt: Date.now(),
      activeSessions: new Set()
    });
    return `${ONLY_PREVIEW_SCHEME}://document/${token}/${encodeDocumentPath(entryRequestPath)}`;
  }

  async respond(request: Request): Promise<Response> {
    const parsed = parseDocumentRequest(request.url);
    if (!parsed) return new Response(null, { status: 404 });
    const document = this.documents.get(parsed.token);
    if (!document || !this.isLive(document)) {
      if (document) this.revokeToken(document.token);
      return new Response(null, { status: 404 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    try {
      const resource = await fileSearchWindowService.inspectPreviewDocumentResource({
        grantId: document.grantId,
        selectionRevision: document.selectionRevision,
        requestPath: parsed.relativePath
      });
      if (this.documents.get(document.token) !== document || !this.isLive(document)) {
        return new Response(null, { status: 404 });
      }
      const byteLimit =
        parsed.relativePath === document.entryRequestPath
          ? ONLY_PREVIEW_MAX_HTML_BYTES
          : ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES;
      return await createOnlyPreviewReadResponse({
        request,
        grantId: document.grantId,
        selectionRevision: document.selectionRevision,
        source: { kind: 'document', requestPath: parsed.relativePath },
        fileSize: resource.size,
        mimeType: mimeTypeFor(parsed.relativePath),
        maxBytes: byteLimit,
        responseHeaders: DOCUMENT_SECURITY_HEADERS,
        onSession: (sessionId) => document.activeSessions.add(sessionId),
        onSessionClosed: (sessionId) => document.activeSessions.delete(sessionId),
        isSessionLive: (sessionId) =>
          this.documents.get(document.token) === document &&
          document.activeSessions.has(sessionId) &&
          this.isLive(document)
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  }

  revokeSelection(hostToken: string, selectionRevision?: number): void {
    for (const [token, document] of this.documents) {
      if (
        document.hostToken === hostToken &&
        (selectionRevision === undefined || document.selectionRevision === selectionRevision)
      ) {
        this.revokeToken(token);
      }
    }
  }

  revokeHost(hostToken: string): void {
    this.revokeSelection(hostToken);
  }

  revokeWorkspace(workspaceId: string): void {
    for (const [token, document] of this.documents) {
      if (document.workspaceId === workspaceId) this.revokeToken(token);
    }
  }

  clear(): void {
    for (const token of [...this.documents.keys()]) this.revokeToken(token);
  }

  private isLive(document: DocumentTokenRecord): boolean {
    return (
      this.hosts.isLive(document.hostToken) &&
      Date.now() - document.createdAt <= DOCUMENT_TOKEN_TTL_MS
    );
  }

  private revokeToken(token: string): void {
    const document = this.documents.get(token);
    if (!document) return;
    this.documents.delete(token);
    for (const sessionId of document.activeSessions) {
      void fileSearchWindowService
        .cancelPreviewRead({
          grantId: document.grantId,
          selectionRevision: document.selectionRevision,
          sessionId
        })
        .catch(() => undefined);
    }
    document.activeSessions.clear();
  }
}

export const onlyPreviewDocumentRegistry = new OnlyPreviewDocumentRegistry(
  onlyPreviewHostRegistry,
  onlyPreviewWorkspaceRegistry
);
