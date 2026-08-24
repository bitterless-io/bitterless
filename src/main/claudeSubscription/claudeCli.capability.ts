import { execFile } from 'node:child_process';
import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

export const CLAUDE_SECURE_STORAGE_CONFIG_MARKER = 'CLAUDE_SECURESTORAGE_CONFIG_DIR';
const CODESIGN_EXECUTABLE = '/usr/bin/codesign';
const ANTHROPIC_CLAUDE_CODE_REQUIREMENT =
  'anchor apple generic and identifier "com.anthropic.claude-code" and certificate leaf[subject.OU] = "Q6L2SF6YDW"';
const CODESIGN_TIMEOUT_MS = 15_000;

export interface ClaudeCliCapabilityProbeResult {
  canonicalExecutable: string | null;
  isolatedCredentialStorage: boolean;
}

export interface ClaudeCliCapabilityProbeOptions {
  chunkBytes?: number;
  platform?: NodeJS.Platform;
  verifyOfficialExecutable?: (canonicalExecutable: string) => Promise<boolean>;
}

export const verifyOfficialClaudeExecutable = async (
  canonicalExecutable: string,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> => {
  if (platform !== 'darwin') return false;
  return await new Promise<boolean>((resolve) => {
    execFile(
      CODESIGN_EXECUTABLE,
      [
        '--verify',
        '--strict',
        '--test-requirement',
        `=${ANTHROPIC_CLAUDE_CODE_REQUIREMENT}`,
        canonicalExecutable
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024, timeout: CODESIGN_TIMEOUT_MS },
      (error) => resolve(error === null)
    );
  });
};

export const probeClaudeCliCapabilities = async (
  executable: string,
  options: ClaudeCliCapabilityProbeOptions = {}
): Promise<ClaudeCliCapabilityProbeResult> => {
  if (!path.isAbsolute(executable)) {
    return { canonicalExecutable: null, isolatedCredentialStorage: false };
  }
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) {
    return { canonicalExecutable: null, isolatedCredentialStorage: false };
  }

  let canonicalExecutable: string;
  try {
    canonicalExecutable = (await realpath(executable)).normalize('NFC');
    if (!(await stat(canonicalExecutable)).isFile()) {
      return { canonicalExecutable, isolatedCredentialStorage: false };
    }
  } catch {
    return { canonicalExecutable: null, isolatedCredentialStorage: false };
  }

  const verifyOfficialExecutable =
    options.verifyOfficialExecutable ??
    (async (candidate: string) =>
      await verifyOfficialClaudeExecutable(candidate, options.platform ?? process.platform));
  if (!(await verifyOfficialExecutable(canonicalExecutable))) {
    return { canonicalExecutable, isolatedCredentialStorage: false };
  }

  const marker = Buffer.from(CLAUDE_SECURE_STORAGE_CONFIG_MARKER, 'ascii');
  const buffer = Buffer.allocUnsafe(chunkBytes);
  let overlap = Buffer.alloc(0);
  let file: FileHandle | undefined;
  try {
    file = await open(canonicalExecutable, 'r');
    let position = 0;
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const current = Buffer.concat([overlap, buffer.subarray(0, bytesRead)]);
      if (current.indexOf(marker) >= 0) {
        return { canonicalExecutable, isolatedCredentialStorage: true };
      }
      overlap = current.subarray(Math.max(0, current.length - marker.length + 1));
    }
    return { canonicalExecutable, isolatedCredentialStorage: false };
  } catch {
    return { canonicalExecutable, isolatedCredentialStorage: false };
  } finally {
    await file?.close().catch(() => undefined);
  }
};
