import type { ReadStream } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { pipeline, Readable, Transform } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import { ONLY_PREVIEW_SCHEME } from '@shared/onlypreview/onlyPreview.types';
import type { OpenedOnlyPreviewFile } from './onlyPreviewWorkspace.registry';
import { onlyPreviewHostRegistry, type OnlyPreviewHostRegistry } from './onlyPreviewHost.registry';
import {
  onlyPreviewWorkspaceRegistry,
  type OnlyPreviewWorkspaceRegistry
} from './onlyPreviewWorkspace.registry';

const MAX_ASSET_TOKENS = 512;
const ASSET_TOKEN_TTL_MS = 30 * 60 * 1000;

interface AssetTokenRecord {
  token: string;
  hostToken: string;
  workspaceId: string;
  relativePath: string;
  mimeType: string;
  selectionRevision: number;
  expectedSize: number;
  expectedDeviceId: bigint;
  expectedInode: bigint;
  expectedModifiedTimeNanoseconds: bigint;
  expectedRealPath: string;
  maxBytes: number;
  createdAt: number;
  activeStreams: Set<ReadStream>;
}

export interface OnlyPreviewAssetIssueOptions {
  selectionRevision: number;
  maxBytes: number;
}

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

export const createOnlyPreviewFileResponse = async (params: {
  request: Request;
  fileHandle: FileHandle;
  fileSize: number;
  mimeType: string;
  maxBytes: number;
  responseHeaders?: Readonly<Record<string, string>>;
  beforeStream?: (acceptedBytes: number) => boolean;
  verifyAfterStream?: () => Promise<boolean>;
  onStream?: (stream: ReadStream) => void;
}): Promise<Response> => {
  const closeHandle = async (): Promise<void> => {
    await params.fileHandle.close().catch(() => undefined);
  };
  if (params.request.method !== 'GET' && params.request.method !== 'HEAD') {
    await closeHandle();
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  if (
    !Number.isSafeInteger(params.maxBytes) ||
    params.maxBytes < 0 ||
    params.fileSize > params.maxBytes
  ) {
    await closeHandle();
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
    await closeHandle();
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
      : { start: 0, end: Math.max(0, params.fileSize - 1) };
  const contentLength = params.fileSize === 0 ? 0 : range.end - range.start + 1;
  const headers: Record<string, string> = {
    ...baseHeaders,
    'Content-Length': String(contentLength)
  };
  if (parsedRange.kind === 'range') {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${params.fileSize}`;
  }
  if (params.request.method === 'HEAD' || params.fileSize === 0) {
    await closeHandle();
    return new Response(null, {
      status: parsedRange.kind === 'range' ? 206 : 200,
      headers
    });
  }
  if (params.beforeStream && !params.beforeStream(contentLength)) {
    await closeHandle();
    return new Response(null, { status: 429 });
  }

  const nodeStream = params.fileHandle.createReadStream({
    start: range.start,
    end: range.end,
    autoClose: false,
    signal: params.request.signal
  });
  params.onStream?.(nodeStream);
  let streamedBytes = 0;
  const boundedStream = new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      const chunkBytes = Buffer.isBuffer(chunk)
        ? chunk.byteLength
        : Buffer.byteLength(chunk, encoding);
      streamedBytes += chunkBytes;
      if (streamedBytes > contentLength || streamedBytes > params.maxBytes) {
        callback(new Error('OnlyPreview asset stream exceeded its admitted byte range.'));
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (streamedBytes !== contentLength) {
        callback(new Error('OnlyPreview asset stream ended before its admitted byte range.'));
        return;
      }
      if (!params.verifyAfterStream) {
        callback();
        return;
      }
      void params.verifyAfterStream().then(
        (valid) =>
          callback(
            valid
              ? undefined
              : new Error('OnlyPreview asset identity changed while it was streaming.')
          ),
        (error: unknown) =>
          callback(error instanceof Error ? error : new Error('Asset verification failed.'))
      );
    }
  });
  pipeline(nodeStream, boundedStream, () => {
    // Pipeline consumes source errors and propagates revoke/overflow teardown to the response body.
    void closeHandle();
  });
  const body = Readable.toWeb(boundedStream) as unknown as BodyInit;
  return new Response(body, {
    status: parsedRange.kind === 'range' ? 206 : 200,
    headers
  });
};

export class OnlyPreviewAssetRegistry {
  private readonly assets = new Map<string, AssetTokenRecord>();

  constructor(
    private readonly hosts: OnlyPreviewHostRegistry,
    private readonly workspaces: OnlyPreviewWorkspaceRegistry
  ) {
    hosts.onRevoke((host) => this.revokeHost(host.hostToken));
    workspaces.onRevoke((workspace) => this.revokeWorkspace(workspace.workspaceId));
  }

  issue(
    file: OpenedOnlyPreviewFile,
    mimeType: string,
    options: OnlyPreviewAssetIssueOptions
  ): string {
    if (
      !Number.isSafeInteger(options.selectionRevision) ||
      options.selectionRevision < 1 ||
      !Number.isSafeInteger(options.maxBytes) ||
      options.maxBytes < 0
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Asset byte ceiling is invalid.');
    }
    if (file.size > options.maxBytes) {
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
      hostToken: file.host.hostToken,
      workspaceId: file.workspace.workspaceId,
      relativePath: file.relativePath,
      mimeType,
      selectionRevision: options.selectionRevision,
      expectedSize: file.size,
      expectedDeviceId: file.deviceId,
      expectedInode: file.inode,
      expectedModifiedTimeNanoseconds: file.modifiedTimeNanoseconds,
      expectedRealPath: file.realPath,
      maxBytes: options.maxBytes,
      createdAt: Date.now(),
      activeStreams: new Set()
    });
    return `${ONLY_PREVIEW_SCHEME}://asset/${token}/${encodeURIComponent(basename(file.relativePath))}`;
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
    const token = rawMatch[1];
    const asset = this.assets.get(token);
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
    if (Date.now() - asset.createdAt > ASSET_TOKEN_TTL_MS) {
      this.revokeToken(token);
      return new Response(null, { status: 404 });
    }
    if (!this.hosts.isLive(asset.hostToken)) {
      this.revokeToken(token);
      return new Response(null, { status: 404 });
    }
    let file: Awaited<ReturnType<OnlyPreviewWorkspaceRegistry['openFile']>> | null = null;
    try {
      file = await this.workspaces.openFile(asset.hostToken, {
        workspaceId: asset.workspaceId,
        relativePath: asset.relativePath
      });
      if (
        this.assets.get(token) !== asset ||
        !this.hosts.isLive(asset.hostToken) ||
        Date.now() - asset.createdAt > ASSET_TOKEN_TTL_MS
      ) {
        await file.fileHandle.close().catch(() => undefined);
        return new Response(null, { status: 404 });
      }
      if (
        file.size !== asset.expectedSize ||
        file.deviceId !== asset.expectedDeviceId ||
        file.inode !== asset.expectedInode ||
        file.modifiedTimeNanoseconds !== asset.expectedModifiedTimeNanoseconds ||
        file.realPath !== asset.expectedRealPath
      ) {
        await file.fileHandle.close().catch(() => undefined);
        return new Response(null, { status: 409 });
      }
      if (file.size > asset.maxBytes) {
        await file.fileHandle.close().catch(() => undefined);
        return new Response(null, { status: 413 });
      }
      return await createOnlyPreviewFileResponse({
        request,
        fileHandle: file.fileHandle,
        fileSize: file.size,
        mimeType: asset.mimeType,
        maxBytes: asset.maxBytes,
        verifyAfterStream: async () => {
          const streamedStat = await file.fileHandle.stat({ bigint: true });
          if (
            streamedStat.size !== BigInt(asset.expectedSize) ||
            streamedStat.dev !== asset.expectedDeviceId ||
            streamedStat.ino !== asset.expectedInode ||
            streamedStat.mtimeNs !== asset.expectedModifiedTimeNanoseconds ||
            this.assets.get(token) !== asset ||
            !this.hosts.isLive(asset.hostToken)
          ) {
            return false;
          }
          const current = await this.workspaces.openFile(asset.hostToken, {
            workspaceId: asset.workspaceId,
            relativePath: asset.relativePath
          });
          try {
            return (
              current.size === asset.expectedSize &&
              current.deviceId === asset.expectedDeviceId &&
              current.inode === asset.expectedInode &&
              current.modifiedTimeNanoseconds === asset.expectedModifiedTimeNanoseconds &&
              current.realPath === asset.expectedRealPath &&
              this.assets.get(token) === asset &&
              this.hosts.isLive(asset.hostToken)
            );
          } finally {
            await current.fileHandle.close().catch(() => undefined);
          }
        },
        onStream: (stream) => {
          asset.activeStreams.add(stream);
          stream.once('close', () => asset.activeStreams.delete(stream));
        }
      });
    } catch {
      await file?.fileHandle.close().catch(() => undefined);
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
    for (const stream of asset.activeStreams) stream.destroy();
    asset.activeStreams.clear();
  }
}

export const onlyPreviewAssetRegistry = new OnlyPreviewAssetRegistry(
  onlyPreviewHostRegistry,
  onlyPreviewWorkspaceRegistry
);
