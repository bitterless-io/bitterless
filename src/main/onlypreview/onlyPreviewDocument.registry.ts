import type { ReadStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, posix, relative, sep } from 'node:path';
import {
  normalizeOnlyPreviewRelativePath,
  OnlyPreviewContractError
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES,
  ONLY_PREVIEW_MAX_DOCUMENT_TOTAL_BYTES,
  ONLY_PREVIEW_MAX_HTML_BYTES,
  ONLY_PREVIEW_SCHEME
} from '@shared/onlypreview/onlyPreview.types';
import { createOnlyPreviewFileResponse } from './onlyPreviewAsset.registry';
import { onlyPreviewHostRegistry, type OnlyPreviewHostRegistry } from './onlyPreviewHost.registry';
import type { OpenedOnlyPreviewFile } from './onlyPreviewWorkspace.registry';
import {
  onlyPreviewWorkspaceRegistry,
  type OnlyPreviewWorkspaceRegistry
} from './onlyPreviewWorkspace.registry';

const MAX_DOCUMENT_TOKENS = 64;
const DOCUMENT_TOKEN_TTL_MS = 30 * 60 * 1000;
const DOCUMENT_SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'none'",
    "child-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
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
  selectionRevision: number;
  entryRelativePath: string;
  entryDirectoryRelativePath: string;
  entryDirectoryRealPath: string;
  entryDirectoryDeviceId: bigint;
  entryDirectoryInode: bigint;
  entryRequestPath: string;
  expectedEntrySize: number;
  expectedEntryDeviceId: bigint;
  expectedEntryInode: bigint;
  expectedEntryModifiedTimeNanoseconds: bigint;
  expectedEntryRealPath: string;
  resourceIdentities: Map<
    string,
    {
      size: number;
      deviceId: bigint;
      inode: bigint;
      modifiedTimeNanoseconds: bigint;
      realPath: string;
    }
  >;
  acceptedResponseBytes: number;
  createdAt: number;
  activeStreams: Set<ReadStream>;
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

const isContainedRealPath = (root: string, candidate: string): boolean => {
  const child = relative(root, candidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
};

export class OnlyPreviewDocumentRegistry {
  private readonly documents = new Map<string, DocumentTokenRecord>();

  constructor(
    private readonly hosts: OnlyPreviewHostRegistry,
    private readonly workspaces: OnlyPreviewWorkspaceRegistry
  ) {
    hosts.onRevoke((host) => this.revokeHost(host.hostToken));
    workspaces.onRevoke((workspace) => this.revokeWorkspace(workspace.workspaceId));
  }

  async issue(file: OpenedOnlyPreviewFile, selectionRevision: number): Promise<string> {
    if (!Number.isSafeInteger(selectionRevision) || selectionRevision < 1) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Document revision is invalid.');
    }
    if (file.size > ONLY_PREVIEW_MAX_HTML_BYTES) {
      throw new OnlyPreviewContractError('PROTOCOL_ERROR', 'HTML preview is limited to 1 MiB.');
    }
    while (this.documents.size >= MAX_DOCUMENT_TOKENS) {
      const oldest = this.documents.keys().next().value as string | undefined;
      if (!oldest) break;
      this.revokeToken(oldest);
    }

    const token = randomBytes(32).toString('hex');
    const entryDirectoryRelativePath = posix.dirname(file.relativePath);
    const normalizedDirectory =
      entryDirectoryRelativePath === '.' ? '' : entryDirectoryRelativePath;
    const entryRequestPath = posix.basename(file.relativePath);
    const entryDirectoryRealPath = await realpath(dirname(file.realPath));
    const entryDirectoryStat = await stat(entryDirectoryRealPath, { bigint: true });
    if (
      !entryDirectoryStat.isDirectory() ||
      entryDirectoryRealPath !== dirname(file.realPath) ||
      !isContainedRealPath(file.workspace.rootRealPath, entryDirectoryRealPath)
    ) {
      throw new OnlyPreviewContractError(
        'PATH_OUTSIDE_WORKSPACE',
        'The HTML entry directory is no longer available.'
      );
    }
    this.documents.set(token, {
      token,
      hostToken: file.host.hostToken,
      workspaceId: file.workspace.workspaceId,
      selectionRevision,
      entryRelativePath: file.relativePath,
      entryDirectoryRelativePath: normalizedDirectory,
      entryDirectoryRealPath,
      entryDirectoryDeviceId: entryDirectoryStat.dev,
      entryDirectoryInode: entryDirectoryStat.ino,
      entryRequestPath,
      expectedEntrySize: file.size,
      expectedEntryDeviceId: file.deviceId,
      expectedEntryInode: file.inode,
      expectedEntryModifiedTimeNanoseconds: file.modifiedTimeNanoseconds,
      expectedEntryRealPath: file.realPath,
      resourceIdentities: new Map(),
      acceptedResponseBytes: 0,
      createdAt: Date.now(),
      activeStreams: new Set()
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
    if (!(await this.matchesEntryDirectory(document))) {
      this.revokeToken(document.token);
      return new Response(null, { status: 409 });
    }
    const requestingEntry = parsed.relativePath === document.entryRequestPath;
    if (!requestingEntry && !(await this.matchesEntryIdentity(document))) {
      this.revokeToken(document.token);
      return new Response(null, { status: 409 });
    }

    const workspaceRelativePath = document.entryDirectoryRelativePath
      ? `${document.entryDirectoryRelativePath}/${parsed.relativePath}`
      : parsed.relativePath;
    let opened: Awaited<ReturnType<OnlyPreviewWorkspaceRegistry['openFile']>> | null = null;
    try {
      opened = await this.workspaces.openFile(document.hostToken, {
        workspaceId: document.workspaceId,
        relativePath: normalizeOnlyPreviewRelativePath(workspaceRelativePath)
      });
      if (this.documents.get(document.token) !== document || !this.isLive(document)) {
        await opened.fileHandle.close().catch(() => undefined);
        return new Response(null, { status: 404 });
      }
      if (!(await this.matchesEntryDirectory(document))) {
        await opened.fileHandle.close().catch(() => undefined);
        this.revokeToken(document.token);
        return new Response(null, { status: 409 });
      }
      if (!requestingEntry && !(await this.matchesEntryIdentity(document))) {
        await opened.fileHandle.close().catch(() => undefined);
        this.revokeToken(document.token);
        return new Response(null, { status: 409 });
      }
      if (!isContainedRealPath(document.entryDirectoryRealPath, opened.realPath)) {
        await opened.fileHandle.close().catch(() => undefined);
        return new Response(null, { status: 404 });
      }

      const isEntry = opened.relativePath === document.entryRelativePath;
      if (parsed.relativePath === document.entryRequestPath && !isEntry) {
        await opened.fileHandle.close().catch(() => undefined);
        return new Response(null, { status: 409 });
      }
      if (isEntry) {
        if (
          opened.size !== document.expectedEntrySize ||
          opened.deviceId !== document.expectedEntryDeviceId ||
          opened.inode !== document.expectedEntryInode ||
          opened.modifiedTimeNanoseconds !== document.expectedEntryModifiedTimeNanoseconds ||
          opened.realPath !== document.expectedEntryRealPath
        ) {
          await opened.fileHandle.close().catch(() => undefined);
          this.revokeToken(document.token);
          return new Response(null, { status: 409 });
        }
      } else {
        const identity = document.resourceIdentities.get(opened.relativePath);
        if (
          identity &&
          (opened.size !== identity.size ||
            opened.deviceId !== identity.deviceId ||
            opened.inode !== identity.inode ||
            opened.modifiedTimeNanoseconds !== identity.modifiedTimeNanoseconds ||
            opened.realPath !== identity.realPath)
        ) {
          await opened.fileHandle.close().catch(() => undefined);
          return new Response(null, { status: 409 });
        }
        if (!identity) {
          document.resourceIdentities.set(opened.relativePath, {
            size: opened.size,
            deviceId: opened.deviceId,
            inode: opened.inode,
            modifiedTimeNanoseconds: opened.modifiedTimeNanoseconds,
            realPath: opened.realPath
          });
        }
      }
      const expectedIdentity = isEntry
        ? {
            size: document.expectedEntrySize,
            deviceId: document.expectedEntryDeviceId,
            inode: document.expectedEntryInode,
            modifiedTimeNanoseconds: document.expectedEntryModifiedTimeNanoseconds,
            realPath: document.expectedEntryRealPath
          }
        : document.resourceIdentities.get(opened.relativePath)!;
      const byteLimit = isEntry
        ? ONLY_PREVIEW_MAX_HTML_BYTES
        : ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES;
      if (opened.size > byteLimit) {
        await opened.fileHandle.close().catch(() => undefined);
        return new Response(null, { status: 413 });
      }

      return await createOnlyPreviewFileResponse({
        request,
        fileHandle: opened.fileHandle,
        fileSize: opened.size,
        mimeType: mimeTypeFor(opened.relativePath),
        maxBytes: byteLimit,
        responseHeaders: DOCUMENT_SECURITY_HEADERS,
        beforeStream: (acceptedBytes) => {
          if (this.documents.get(document.token) !== document || !this.isLive(document)) {
            return false;
          }
          if (
            acceptedBytes < 0 ||
            document.acceptedResponseBytes + acceptedBytes > ONLY_PREVIEW_MAX_DOCUMENT_TOTAL_BYTES
          ) {
            return false;
          }
          document.acceptedResponseBytes += acceptedBytes;
          return true;
        },
        verifyAfterStream: async () => {
          const streamedStat = await opened.fileHandle.stat({ bigint: true });
          if (
            streamedStat.size !== BigInt(expectedIdentity.size) ||
            streamedStat.dev !== expectedIdentity.deviceId ||
            streamedStat.ino !== expectedIdentity.inode ||
            streamedStat.mtimeNs !== expectedIdentity.modifiedTimeNanoseconds ||
            this.documents.get(document.token) !== document ||
            !this.isLive(document)
          ) {
            return false;
          }
          const current = await this.workspaces.openFile(document.hostToken, {
            workspaceId: document.workspaceId,
            relativePath: opened.relativePath
          });
          try {
            return (
              current.realPath === opened.realPath &&
              current.realPath === expectedIdentity.realPath &&
              (await this.matchesEntryDirectory(document)) &&
              (isEntry || (await this.matchesEntryIdentity(document))) &&
              isContainedRealPath(document.entryDirectoryRealPath, current.realPath) &&
              current.size === expectedIdentity.size &&
              current.deviceId === expectedIdentity.deviceId &&
              current.inode === expectedIdentity.inode &&
              current.modifiedTimeNanoseconds === expectedIdentity.modifiedTimeNanoseconds &&
              this.documents.get(document.token) === document &&
              this.isLive(document)
            );
          } finally {
            await current.fileHandle.close().catch(() => undefined);
          }
        },
        onStream: (stream) => {
          document.activeStreams.add(stream);
          stream.once('close', () => document.activeStreams.delete(stream));
        }
      });
    } catch {
      await opened?.fileHandle.close().catch(() => undefined);
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

  private async matchesEntryDirectory(document: DocumentTokenRecord): Promise<boolean> {
    try {
      const currentRealPath = await realpath(document.entryDirectoryRealPath);
      if (currentRealPath !== document.entryDirectoryRealPath) return false;
      const currentStat = await stat(currentRealPath, { bigint: true });
      return (
        currentStat.isDirectory() &&
        currentStat.dev === document.entryDirectoryDeviceId &&
        currentStat.ino === document.entryDirectoryInode
      );
    } catch {
      return false;
    }
  }

  private async matchesEntryIdentity(document: DocumentTokenRecord): Promise<boolean> {
    let entry: Awaited<ReturnType<OnlyPreviewWorkspaceRegistry['openFile']>> | null = null;
    try {
      entry = await this.workspaces.openFile(document.hostToken, {
        workspaceId: document.workspaceId,
        relativePath: document.entryRelativePath
      });
      return (
        entry.realPath === document.expectedEntryRealPath &&
        entry.size === document.expectedEntrySize &&
        entry.deviceId === document.expectedEntryDeviceId &&
        entry.inode === document.expectedEntryInode &&
        entry.modifiedTimeNanoseconds === document.expectedEntryModifiedTimeNanoseconds &&
        this.documents.get(document.token) === document &&
        this.isLive(document)
      );
    } catch {
      return false;
    } finally {
      await entry?.fileHandle.close().catch(() => undefined);
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
    for (const stream of document.activeStreams) stream.destroy();
    document.activeStreams.clear();
  }
}

export const onlyPreviewDocumentRegistry = new OnlyPreviewDocumentRegistry(
  onlyPreviewHostRegistry,
  onlyPreviewWorkspaceRegistry
);
