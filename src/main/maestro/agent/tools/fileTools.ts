import type { AgentToolSpec } from '@maestro-main/agent/runtime/agentRuntime.types'

export interface FileToolHost {
  toolReadFile(
    sessionKey: string,
    pathArg: string,
    options: { offset?: number; limit?: number }
  ): Promise<string>
  toolListWorkspaceFiles(
    sessionKey: string,
    pathArg?: string,
    maxEntriesArg?: number
  ): Promise<string>
  toolSearchWorkspaceFiles(
    sessionKey: string,
    queryArg: string,
    pathArg?: string,
    maxResultsArg?: number
  ): Promise<string>
  toolWriteWorkspaceFile(sessionKey: string, pathArg: string, contentArg: string): string
  toolCreateArtifact(sessionKey: string, artifactJson: string): Promise<string>
  toolWorkspaceContext(sessionKey: string, actionArg: string): Promise<string>
  toolOpenWorkspaceFolder(sessionKey: string, pathArg?: string): Promise<string>
}

export const buildFileTools = (host: FileToolHost, sessionKey: string): AgentToolSpec[] => [
  {
    name: 'read_file',
    description:
      'Read a LOCAL file and get its content as text. Accepts an attached "@/absolute/path", any absolute path on the user’s machine, ' +
      'or a path relative to the selected workspace (else the user’s home). ' +
      'Supports Word (.doc/.docx/.docm), PowerPoint (.ppt/.pps/.pot/.pptx/.pptm/.ppsx/.ppsm), ' +
      'Excel (.xls/.xlsx/.xlsm/.xlsb), OpenDocument (.odt/.ods/.odp), RTF, EPUB, PDF, ' +
      'and text/code/csv/json/markdown/html. Text/code (including csv) return with line numbers; ' +
      'use offset/limit to page through large files. Other supported documents convert to Markdown. ' +
      'A scanned PDF without a text layer returns a needs-OCR message.',
    params: [
      {
        name: 'path',
        required: true,
        description: 'Attached @/abs/path, any absolute path, or a path relative to the workspace/home.'
      },
      {
        name: 'offset',
        type: 'number',
        required: false,
        description: 'Text files only: 1-based start line (default 1).'
      },
      {
        name: 'limit',
        type: 'number',
        required: false,
        description: 'Text files only: max lines to return (default 2000).'
      }
    ],
    execute: async (args) =>
      host.toolReadFile(sessionKey, String(args.path ?? ''), {
        offset: args.offset != null ? Number(args.offset) : undefined,
        limit: args.limit != null ? Number(args.limit) : undefined
      })
  },
  {
    name: 'list_workspace_files',
    description:
      'List files and directories. Path may be any absolute directory or relative to the selected workspace; ' +
      'empty means workspace root (or home when none is selected). Returned external paths are absolute and can be passed to read_file.',
    params: [
      {
        name: 'path',
        required: false,
        description: 'Absolute directory or workspace-relative path. Empty = workspace root or home.'
      },
      {
        name: 'max_entries',
        type: 'number',
        required: false,
        description: 'Max entries to return (default 120, max 300).'
      }
    ],
    execute: async (args) =>
      host.toolListWorkspaceFiles(
        sessionKey,
        args.path ? String(args.path) : '',
        args.max_entries != null ? Number(args.max_entries) : undefined
      )
  },
  {
    name: 'search_files',
    description:
      'Search filenames and small text/code contents under any absolute directory or the selected workspace. ' +
      'Multi-word queries match all terms; external results use absolute paths that round-trip to read_file.',
    params: [
      { name: 'query', required: true, description: 'Text to search for.' },
      {
        name: 'path',
        required: false,
        description: 'Absolute directory or workspace-relative path. Empty = workspace root or home.'
      },
      {
        name: 'max_results',
        type: 'number',
        required: false,
        description: 'Max hits to return (default 60).'
      }
    ],
    execute: async (args) =>
      host.toolSearchWorkspaceFiles(
        sessionKey,
        String(args.query ?? ''),
        args.path ? String(args.path) : '',
        args.max_results != null ? Number(args.max_results) : undefined
      )
  },
  {
    name: 'write_file',
    description:
      'Create or update a UTF-8 text file inside the selected workspace. The target must stay under that workspace and is returned as an artifact.',
    params: [
      { name: 'path', required: true, description: 'Workspace-relative file path.' },
      { name: 'content', required: true, description: 'Full UTF-8 file content.' }
    ],
    execute: async (args) =>
      host.toolWriteWorkspaceFile(
        sessionKey,
        String(args.path ?? ''),
        String(args.content ?? '')
      )
  },
  {
    name: 'create_artifact',
    description:
      'Create a generated xlsx, docx, pdf, html, md, txt, or json artifact. Relative filenames use the selected workspace; otherwise Maestro uses its artifacts directory.',
    params: [
      {
        name: 'artifact_json',
        required: true,
        description: 'JSON object with type, optional filename/title, and type-specific content.'
      }
    ],
    execute: async (args) =>
      host.toolCreateArtifact(sessionKey, String(args.artifact_json ?? ''))
  },
  {
    name: 'open_workspace_folder',
    description:
      'Open a folder in Finder or File Explorer. Empty path opens this chat’s workspace root; with no selected workspace, Maestro creates the chat’s default workspace. ' +
      'A relative subfolder opens directly, while a relative file is revealed. This reads no content and changes no file.',
    params: [
      {
        name: 'path',
        required: false,
        description: 'Workspace-relative folder or file. Empty = workspace root.'
      }
    ],
    execute: async (args) =>
      host.toolOpenWorkspaceFolder(sessionKey, args.path ? String(args.path) : '')
  },
  {
    name: 'workspace_context',
    description:
      'Inspect or update the selected local project workspace for this chat. Use status, clear, or choose; choose opens the native directory picker.',
    params: [
      { name: 'action', required: true, description: 'One of: status, clear, choose.' }
    ],
    execute: async (args) =>
      host.toolWorkspaceContext(sessionKey, String(args.action ?? 'status'))
  }
]
