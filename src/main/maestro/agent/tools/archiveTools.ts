import type { AgentToolSpec } from '@maestro-main/agent/runtime/agentRuntime.types'

export interface ArchiveToolHost {
  toolListArchive(sessionKey: string, pathArg: string, password?: string): Promise<string>
  toolExtractArchive(
    sessionKey: string,
    pathArg: string,
    destArg?: string,
    password?: string
  ): Promise<string>
  toolCreateArchive(
    sessionKey: string,
    archiveArg: string,
    inputsArg: string,
    password?: string
  ): Promise<string>
}

const FORMATS =
  'zip, tar variants, 7z, rar (read-only), gz, xz, lzma, bz2, bz3, lz4, zst, sz, and br'

const PASSWORD_NOTE =
  'Passwords work for list/extract. Creating a password-protected archive is refused because the bundled tool would silently create an unencrypted archive.'

export const buildArchiveTools = (
  host: ArchiveToolHost,
  sessionKey: string
): AgentToolSpec[] => [
  {
    name: 'list_archive',
    description:
      `Inspect an archive without unpacking it. Supports ${FORMATS}. ${PASSWORD_NOTE}`,
    params: [
      {
        name: 'path',
        required: true,
        description: 'Attached @/abs/path, any absolute path, or workspace-relative path.'
      },
      { name: 'password', required: false, description: 'Password for an encrypted archive.' }
    ],
    timeoutMs: 200_000,
    timeoutHint: 'listing a very large archive',
    execute: async (args) =>
      await host.toolListArchive(
        sessionKey,
        String(args.path || ''),
        args.password ? String(args.password) : undefined
      )
  },
  {
    name: 'extract_archive',
    description:
      `Unpack an archive into a new or empty workspace folder, then use read_file on extracted files. With no selected workspace, Maestro uses a per-chat default. Links and special filesystem entries are refused. Supports ${FORMATS}. ${PASSWORD_NOTE}`,
    params: [
      {
        name: 'path',
        required: true,
        description: 'Attached @/abs/path, any absolute path, or workspace-relative path.'
      },
      {
        name: 'dest',
        required: false,
        description: 'New or empty workspace-relative destination; defaults to a folder named after the archive.'
      },
      { name: 'password', required: false, description: 'Password for an encrypted archive.' }
    ],
    timeoutMs: 200_000,
    timeoutHint: 'unpacking a very large archive',
    execute: async (args) =>
      await host.toolExtractArchive(
        sessionKey,
        String(args.path || ''),
        args.dest ? String(args.dest) : undefined,
        args.password ? String(args.password) : undefined
      )
  },
  {
    name: 'create_archive',
    description:
      `Pack files or folders. Output format comes from the archive extension and is written inside the selected or per-chat default workspace. ${PASSWORD_NOTE}`,
    params: [
      {
        name: 'archive',
        required: true,
        description: 'Workspace-relative output path whose extension selects the format.'
      },
      {
        name: 'inputs',
        required: true,
        description: 'One or more paths, separated by commas or newlines.'
      },
      {
        name: 'password',
        required: false,
        description: 'Refused: encrypted archive creation is unsupported.'
      }
    ],
    timeoutMs: 200_000,
    timeoutHint: 'packing a very large archive',
    execute: async (args) =>
      await host.toolCreateArchive(
        sessionKey,
        String(args.archive || ''),
        String(args.inputs || ''),
        args.password ? String(args.password) : undefined
      )
  }
]
