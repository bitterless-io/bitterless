import { randomBytes, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import { ONLY_PREVIEW_SCHEME } from '@shared/onlypreview/onlyPreview.types';
import type {
  OnlyPreviewPreviewReadChunkResult,
  OnlyPreviewPreviewReadPreparedSelection,
  OnlyPreviewPreviewReadSource
} from '@shared/onlypreview/onlyPreviewPreviewReadRuntime.types';
import { onlyPreviewHostRegistry, type OnlyPreviewHostRegistry } from './onlyPreviewHost.registry';
import {
  onlyPreviewWorkspaceRegistry,
  type OnlyPreviewWorkspaceRegistry
} from './onlyPreviewWorkspace.registry';

const MAX_ASSET_TOKENS = 512;
export const ONLY_PREVIEW_ASSET_TOKEN_TTL_MS = 30 * 60 * 1000;
const ASSET_FETCH_RESPONSE_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Accept-Ranges'
});

interface AssetTokenRecord {
  token: string;
  hostToken: string;
  workspaceId: string;
  relativePath: string;
  grantId: string;
  mimeType: string;
  selectionRevision: number;
  expectedSize: number;
  maxBytes: number;
  createdAt: number;
  lifetime: 'ttl' | 'selection';
  activeSessions: Set<string>;
}

export interface OnlyPreviewAssetIssueOptions {
  selectionRevision: number;
  maxBytes: number;
  lifetime?: 'ttl' | 'selection';
}

const isAssetExpired = (asset: AssetTokenRecord): boolean =>
  asset.lifetime === 'ttl' && Date.now() - asset.createdAt > ONLY_PREVIEW_ASSET_TOKEN_TTL_MS;

export interface OnlyPreviewByteRange {
  start: number;
  end: number;
}

export type OnlyPreviewRangeParseResult =
  | { kind: 'full' }
  | { kind: 'range'; range: OnlyPreviewByteRange }
  | { kind: 'invalid' };

export const parseOnlyPreviewRange = (
  value: string | null,
  size: number
): OnlyPreviewRangeParseResult => {
  if (!value) return { kind: 'full' };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return { kind: 'invalid' };

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { kind: 'invalid' };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      start >= size
    ) {
      return { kind: 'invalid' };
    }
    end = Math.min(end, size - 1);
  }
  return { kind: 'range', range: { start, end } };
};

export const createOnlyPreviewReadResponse = async (params: {
  request: Request;
  grantId: string;
  selectionRevision: number;
  source: OnlyPreviewPreviewReadSource;
  fileSize: number;
  mimeType: string;
  maxBytes: number;
  responseHeaders?: Readonly<Record<string, string>>;
  onSession?: (sessionId: string) => void;
  onSessionClosed?: (sessionId: string) => void;
  isSessionLive?: (sessionId: string) => boolean;
}): Promise<Response> => {
  if (params.request.method !== 'GET' && params.request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  if (
    !Number.isSafeInteger(params.maxBytes) ||
    params.maxBytes < 0 ||
    params.fileSize > params.maxBytes
  ) {
    return new Response(null, { status: 413 });
  }
  const parsedRange = parseOnlyPreviewRange(params.request.headers.get('range'), params.fileSize);
  const baseHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': params.mimeType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-DNS-Prefetch-Control': 'off',
    ...params.responseHeaders
  };
  if (parsedRange.kind === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes */${params.fileSize}`,
        'Content-Length': '0'
      }
    });
  }
  const range =
    parsedRange.kind === 'range'
      ? parsedRange.range
      : { start: 0, end: params.fileSize === 0 ? -1 : params.fileSize - 1 };
  const contentLength = params.fileSize === 0 ? 0 : range.end - range.start + 1;
  const headers: Record<string, string> = {
    ...baseHeaders,
    'Content-Length': String(contentLength)
  };
  if (parsedRange.kind === 'range') {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${params.fileSize}`;
  }

  const sessionId = randomUUID();
  const identity = {
    grantId: params.grantId,
    selectionRevision: params.selectionRevision,
    sessionId
  };
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    params.request.signal.removeEventListener('abort', abort);
    params.onSessionClosed?.(sessionId);
  };
  const cancel = (): void => {
    close();
    void fileSearchWindowService.cancelPreviewRead(identity).catch(() => undefined);
  };
  const abort = (): void => cancel();
  const isLive = (): boolean =>
    !closed && !params.request.signal.aborted && (params.isSessionLive?.(sessionId) ?? true);

  params.onSession?.(sessionId);
  params.request.signal.addEventListener('abort', abort, { once: true });
  if (!isLive()) {
    cancel();
    throw new OnlyPreviewContractError('OPERATION_FAILED', 'Preview Read was cancelled.');
  }

  const opened = await fileSearchWindowService
    .openPreviewRead({
      ...identity,
      method: params.request.method,
      source: params.source,
      start: range.start,
      end: range.end
    })
    .catch((error) => {
      cancel();
      throw error;
    });
  if (!isLive()) {
    cancel();
    throw new OnlyPreviewContractError('OPERATION_FAILED', 'Preview Read was cancelled.');
  }
  if (opened.totalBytes !== params.fileSize) {
    cancel();
    throw new OnlyPreviewContractError(
      'PROTOCOL_ERROR',
      'Preview Read source length changed before delivery.'
    );
  }
  if (params.request.method === 'HEAD' || params.fileSize === 0) {
    close();
    return new Response(null, {
      status: parsedRange.kind === 'range' ? 206 : 200,
      headers
    });
  }

  let offset = range.start;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (params.request.signal.aborted) {
          cancel();
          controller.error(new Error('Preview Read was aborted.'));
          return;
        }
        const chunk: OnlyPreviewPreviewReadChunkResult =
          await fileSearchWindowService.readNextPreviewChunk({ ...identity, offset });
        if (!isLive()) {
          cancel();
          controller.error(new Error('Preview Read was cancelled.'));
          return;
        }
        controller.enqueue(new Uint8Array(chunk.bytes));
        offset += chunk.bytes.byteLength;
        if (chunk.eof) {
          close();
          controller.close();
        }
      } catch (error) {
        cancel();
        controller.error(error);
      }
    },
    cancel() {
      cancel();
    }
  });
  return new Response(body, {
    status: parsedRange.kind === 'range' ? 206 : 200,
    headers
  });
};

export class OnlyPreviewAssetRegistry {
  private readonly assets = new Map<string, AssetTokenRecord>();

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
    mimeType: string,
    options: OnlyPreviewAssetIssueOptions
  ): string {
    this.hosts.require(hostToken, ['content']);
    if (
      !Number.isSafeInteger(options.selectionRevision) ||
      options.selectionRevision < 1 ||
      options.selectionRevision !== selection.selectionRevision ||
      !Number.isSafeInteger(options.maxBytes) ||
      options.maxBytes < 0 ||
      (options.lifetime !== undefined &&
        options.lifetime !== 'ttl' &&
        options.lifetime !== 'selection')
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Asset byte ceiling is invalid.');
    }
    if (selection.descriptor.size > options.maxBytes) {
      throw new OnlyPreviewContractError(
        'PROTOCOL_ERROR',
        'The selected file exceeds the bounded preview size.'
      );
    }
    while (this.assets.size >= MAX_ASSET_TOKENS) {
      const oldest = this.assets.keys().next().value as string | undefined;
      if (!oldest) break;
      this.revokeToken(oldest);
    }
    const token = randomBytes(32).toString('hex');
    this.assets.set(token, {
      token,
      hostToken,
      workspaceId: selection.workspaceId,
      relativePath: selection.relativePath,
      grantId: selection.grantId,
      mimeType,
      selectionRevision: options.selectionRevision,
      expectedSize: selection.descriptor.size,
      maxBytes: options.maxBytes,
      createdAt: Date.now(),
      lifetime: options.lifetime ?? 'ttl',
      activeSessions: new Set()
    });
    return `${ONLY_PREVIEW_SCHEME}://asset/${token}/${encodeURIComponent(basename(selection.relativePath))}`;
  }

  async respond(request: Request): Promise<Response> {
    const rawMatch = new RegExp(
      `^${ONLY_PREVIEW_SCHEME}:\\/\\/asset\\/([a-f0-9]{64})\\/([^/?#]+)$`
    ).exec(request.url);
    if (!rawMatch) return new Response(null, { status: 404 });
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (
      url.protocol !== `${ONLY_PREVIEW_SCHEME}:` ||
      url.hostname !== 'asset' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.pathname !== `/${rawMatch[1]}/${rawMatch[2]}`
    ) {
      return new Response(null, { status: 404 });
    }
    const asset = this.assets.get(rawMatch[1]);
    let displayName: string;
    try {
      displayName = decodeURIComponent(rawMatch[2]);
    } catch {
      return new Response(null, { status: 404 });
    }
    if (
      !asset ||
      rawMatch[2] !== encodeURIComponent(displayName) ||
      displayName !== basename(asset.relativePath)
    ) {
      return new Response(null, { status: 404 });
    }
    if (isAssetExpired(asset) || !this.hosts.isLive(asset.hostToken)) {
      this.revokeToken(asset.token);
      return new Response(null, { status: 404 });
    }
    try {
      return await createOnlyPreviewReadResponse({
        request,
        grantId: asset.grantId,
        selectionRevision: asset.selectionRevision,
        source: { kind: 'selection' },
        fileSize: asset.expectedSize,
        mimeType: asset.mimeType,
        maxBytes: asset.maxBytes,
        responseHeaders: ASSET_FETCH_RESPONSE_HEADERS,
        onSession: (sessionId) => asset.activeSessions.add(sessionId),
        onSessionClosed: (sessionId) => asset.activeSessions.delete(sessionId),
        isSessionLive: (sessionId) =>
          this.assets.get(asset.token) === asset &&
          asset.activeSessions.has(sessionId) &&
          !isAssetExpired(asset) &&
          this.hosts.isLive(asset.hostToken)
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  }

  revokeHost(hostToken: string): void {
    for (const [token, asset] of this.assets) {
      if (asset.hostToken === hostToken) this.revokeToken(token);
    }
  }

  revokeSelection(hostToken: string, selectionRevision?: number): void {
    for (const [token, asset] of this.assets) {
      if (
        asset.hostToken === hostToken &&
        (selectionRevision === undefined || asset.selectionRevision === selectionRevision)
      ) {
        this.revokeToken(token);
      }
    }
  }

  revokeUrl(assetUrl: string | undefined): void {
    if (!assetUrl) return;
    const match = new RegExp(`^${ONLY_PREVIEW_SCHEME}:\\/\\/asset\\/([a-f0-9]{64})\\/`).exec(
      assetUrl
    );
    if (match) this.revokeToken(match[1]);
  }

  revokeWorkspace(workspaceId: string): void {
    for (const [token, asset] of this.assets) {
      if (asset.workspaceId === workspaceId) this.revokeToken(token);
    }
  }

  clear(): void {
    for (const token of [...this.assets.keys()]) this.revokeToken(token);
  }

  private revokeToken(token: string): void {
    const asset = this.assets.get(token);
    if (!asset) return;
    this.assets.delete(token);
    for (const sessionId of asset.activeSessions) {
      void fileSearchWindowService
        .cancelPreviewRead({
          grantId: asset.grantId,
          selectionRevision: asset.selectionRevision,
          sessionId
        })
        .catch(() => undefined);
    }
    asset.activeSessions.clear();
  }
}

export const onlyPreviewAssetRegistry = new OnlyPreviewAssetRegistry(
  onlyPreviewHostRegistry,
  onlyPreviewWorkspaceRegistry
);
