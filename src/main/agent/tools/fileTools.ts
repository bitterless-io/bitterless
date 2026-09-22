import type { AgentToolSpec } from '@main/agent/runtime/agentRuntime.types'
import { normalizeOnlyPreviewLine } from '@shared/onlypreview/onlyPreviewLine.shared'

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
  toolPreviewFile(sessionKey: string, pathArg?: string, line?: number): Promise<string>
}

export const buildFileTools = (host: FileToolHost, sessionKey: string): AgentToolSpec[] => [
  {
    name: 'read_file',
    description:
      'Read a LOCAL file and get its content as text. Accepts an attached "@/absolute/path", any absolute path on the user’s machine, ' +
      'or a path relative to the selected workspace (else the user’s home). ' +
      'Supports Word (.doc/.docx/.docm), PowerPoint (.ppt/.pps/.pot/.pptx/.pptm/.ppsx/.ppsm), ' +
      'Excel (.xls/.xlsx/.xlsm/.xlsb), OpenDocument (.odt/.ods/.odp), RTF, EPUB, PDF, ' +
      'and text/code/csv/json/markdown/html. Text/code (including csv) return with line numbers. ' +
      'Other supported documents convert to Markdown. ' +
      'Output is capped at 2000 lines OR 50KB, whichever is hit first; a truncated result states the exact offset to continue from, so page through with offset/limit rather than assuming you saw the whole file. A single line larger than 50KB (minified or base64 content) is not returned at all — the result hands you a bash command for it instead. ' +
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
        description: '1-based start line (default 1). Also pages converted documents.'
      },
      {
        name: 'limit',
        type: 'number',
        required: false,
        description: 'Max lines to return. The 2000-line / 50KB cap still applies — whichever is hit first wins.'
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
    name: 'preview_file',
    description:
      'Show a file or folder to the user IN THE APP, in OnlyPreview, so they can read it next to this conversation. ' +
      'This is the DEFAULT way to put material in front of the user: call it whenever you judge that they should look at ' +
      'something themselves — a file you just wrote, something you unpacked, a document you are citing instead of quoting ' +
      'in full, a result you want them to confirm. You do not need to be asked. ' +
      'Accepts an attached "@/absolute/path", any absolute path, a "~" path, or a workspace-relative path — the same paths ' +
      'read_file takes, and unlike open_workspace_folder it reaches OUTSIDE the workspace too. ' +
      'A workspace file opens inside the Project tree; a file outside the workspace opens in its own preview tab. ' +
      'A FOLDER is fine: it opens as a browsable tree. ' +
      'When you are pointing at a specific place in a text or source file, pass "line" so it opens scrolled to that line. ' +
      'This only opens a view: it reads nothing back to you and changes nothing. It is NOT a way to read a file or to check ' +
      'whether a path exists — use read_file or list_workspace_files for that.',
    params: [
      {
        name: 'path',
        required: true,
        description: 'Attached @/abs/path, any absolute path, a ~ path, or a path relative to the workspace. A folder is allowed.'
      },
      {
        name: 'line',
        required: false,
        // 说清楚它是「建议」而不是「承诺」,模型才不会在没滚动时以为自己失败了、然后重试或道歉。
        description:
          '1-based line to scroll to, for text and source files. Best effort: file types without lines ' +
          '(images, PDF, media), folders, and out-of-range numbers simply open without scrolling — never an error.'
      }
    ],
    execute: async (args) =>
      host.toolPreviewFile(
        sessionKey,
        args.path ? String(args.path) : '',
        // 规范化留给下游那一处入口(`openOnlyPreviewAbsoluteTarget`),这里只把模型给的原值传过去。
        normalizeOnlyPreviewLine(args.line)
      )
  },
  {
    name: 'open_workspace_folder',
    description:
      'Open a folder in OnlyPreview, the local file preview app (Finder or File Explorer when it is unavailable). Empty path opens this chat’s workspace root; with no selected workspace, Maestro creates the chat’s default workspace. ' +
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
