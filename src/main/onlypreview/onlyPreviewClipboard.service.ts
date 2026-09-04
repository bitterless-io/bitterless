import { execFile } from 'node:child_process';
import { posix, win32 } from 'node:path';
import { clipboard } from 'electron';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';

export type OnlyPreviewClipboardCopyKind =
  | 'item'
  | 'absolute-path'
  | 'relative-path'
  | 'name';

export interface OnlyPreviewClipboardItem {
  realPath: string;
  relativePath: string;
  name?: string;
}

export interface OnlyPreviewClipboardCommand {
  executable: string;
  args: string[];
  options: {
    encoding: 'utf8';
    env?: NodeJS.ProcessEnv;
    maxBuffer: number;
    shell: false;
    timeout: number;
    windowsHide: true;
  };
}

export type OnlyPreviewClipboardCommandExecutor = (
  command: OnlyPreviewClipboardCommand
) => Promise<void>;

interface OnlyPreviewTextClipboard {
  writeText(value: string): void;
}

interface OnlyPreviewClipboardServiceOptions {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  executeCommand?: OnlyPreviewClipboardCommandExecutor;
  textClipboard?: OnlyPreviewTextClipboard;
}

export const ONLY_PREVIEW_CLIPBOARD_TIMEOUT_MS = 5_000;
export const ONLY_PREVIEW_CLIPBOARD_MAX_OUTPUT_BYTES = 16 * 1024;
export const ONLY_PREVIEW_WINDOWS_CLIPBOARD_PATH_ENV =
  'BITTERLESS_ONLYPREVIEW_CLIPBOARD_PATH';
// A larger selection fails visibly rather than pasting a truncated list, which is worse than a
// refusal because nothing on screen says what was dropped.
export const ONLY_PREVIEW_MAX_CLIPBOARD_ITEMS = 200;

// One environment variable per path, plus a count. A single delimited variable would need a
// separator no filename can contain, and a Windows filename may legally contain almost anything the
// reserved-character set does not forbid.
const windowsClipboardScript = (count: number): string =>
  [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$items = New-Object System.Collections.Specialized.StringCollection',
    ...Array.from(
      { length: count },
      (_unused, index) =>
        `[void]$items.Add($env:${ONLY_PREVIEW_WINDOWS_CLIPBOARD_PATH_ENV}_${index})`
    ),
    '[System.Windows.Forms.Clipboard]::SetFileDropList($items)'
  ].join('; ');

const defaultExecuteCommand: OnlyPreviewClipboardCommandExecutor = async (command) => {
  await new Promise<void>((resolveCommand, rejectCommand) => {
    execFile(command.executable, command.args, command.options, (error) => {
      if (error) {
        rejectCommand(error);
        return;
      }
      resolveCommand();
    });
  });
};

const validateClipboardTarget = (platform: NodeJS.Platform, targetPath: string): void => {
  if (
    typeof targetPath !== 'string' ||
    !(platform === 'win32' ? win32.isAbsolute(targetPath) : posix.isAbsolute(targetPath)) ||
    targetPath.length > 32_768 ||
    targetPath.includes('\0')
  ) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Clipboard target is invalid.');
  }
};

export const createOnlyPreviewClipboardCommand = (
  platform: NodeJS.Platform,
  targetPaths: readonly string[],
  environment: NodeJS.ProcessEnv = process.env
): OnlyPreviewClipboardCommand => {
  if (!targetPaths.length || targetPaths.length > ONLY_PREVIEW_MAX_CLIPBOARD_ITEMS) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Clipboard target count is invalid.');
  }
  for (const targetPath of targetPaths) validateClipboardTarget(platform, targetPath);
  const commonOptions = {
    encoding: 'utf8' as const,
    maxBuffer: ONLY_PREVIEW_CLIPBOARD_MAX_OUTPUT_BYTES,
    shell: false as const,
    timeout: ONLY_PREVIEW_CLIPBOARD_TIMEOUT_MS,
    windowsHide: true as const
  };
  if (platform === 'darwin') {
    // Every path is collected into one AppleScript list, so a multi-selection pastes as several
    // items rather than only the first. Paths still travel as `argv`, never interpolated into the
    // script text.
    return {
      executable: '/usr/bin/osascript',
      args: [
        '-e',
        'on run argv',
        '-e',
        'set items to {}',
        '-e',
        'repeat with argument in argv',
        '-e',
        'set end of items to POSIX file (argument as text)',
        '-e',
        'end repeat',
        '-e',
        'set the clipboard to items',
        '-e',
        'end run',
        '--',
        ...targetPaths
      ],
      options: commonOptions
    };
  }
  if (platform === 'win32') {
    const env: NodeJS.ProcessEnv = { ...environment };
    for (const [index, targetPath] of targetPaths.entries()) {
      env[`${ONLY_PREVIEW_WINDOWS_CLIPBOARD_PATH_ENV}_${index}`] = targetPath;
    }
    return {
      executable: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-Command',
        windowsClipboardScript(targetPaths.length)
      ],
      options: { ...commonOptions, env }
    };
  }
  throw new OnlyPreviewContractError(
    'OPERATION_FAILED',
    'Pasteable filesystem copy is not supported on this platform.'
  );
};

const projectClipboardText = (
  item: OnlyPreviewClipboardItem,
  copyKind: Exclude<OnlyPreviewClipboardCopyKind, 'item'>
): string => {
  if (copyKind === 'absolute-path') return item.realPath;
  if (copyKind === 'relative-path') return item.relativePath || '.';
  return item.name || item.relativePath.split('/').at(-1) || item.relativePath;
};

export class OnlyPreviewClipboardService {
  private readonly platform: NodeJS.Platform;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly executeCommand: OnlyPreviewClipboardCommandExecutor;
  private readonly textClipboard: OnlyPreviewTextClipboard;
  private itemCopyInFlight = false;

  constructor(options: OnlyPreviewClipboardServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.environment = options.environment ?? process.env;
    this.executeCommand = options.executeCommand ?? defaultExecuteCommand;
    this.textClipboard = options.textClipboard ?? clipboard;
  }

  async copyProjectItem(
    item: OnlyPreviewClipboardItem,
    copyKind: OnlyPreviewClipboardCopyKind
  ): Promise<void> {
    await this.copyProjectItems([item], copyKind);
  }

  /**
   * Copy a whole selection.
   *
   * One pasteable list for `item`, and one line per entry in tree order for the three text kinds —
   * a multi-selection that pasted only its first row would be a silent truncation.
   */
  async copyProjectItems(
    items: readonly OnlyPreviewClipboardItem[],
    copyKind: OnlyPreviewClipboardCopyKind
  ): Promise<void> {
    try {
      if (!items.length || items.length > ONLY_PREVIEW_MAX_CLIPBOARD_ITEMS) {
        throw new OnlyPreviewContractError('INVALID_INPUT', 'Clipboard target count is invalid.');
      }
      for (const item of items) validateClipboardTarget(this.platform, item.realPath);
      if (copyKind === 'item') {
        if (this.itemCopyInFlight) {
          throw new OnlyPreviewContractError(
            'OPERATION_FAILED',
            'Another filesystem item copy is already in progress.'
          );
        }
        this.itemCopyInFlight = true;
        try {
          await this.executeCommand(
            createOnlyPreviewClipboardCommand(
              this.platform,
              items.map((item) => item.realPath),
              this.environment
            )
          );
        } finally {
          this.itemCopyInFlight = false;
        }
        return;
      }
      if (
        copyKind !== 'absolute-path' &&
        copyKind !== 'relative-path' &&
        copyKind !== 'name'
      ) {
        throw new OnlyPreviewContractError('INVALID_INPUT', 'Clipboard copy kind is invalid.');
      }
      this.textClipboard.writeText(
        items.map((item) => projectClipboardText(item, copyKind)).join('\n')
      );
    } catch (error) {
      if (error instanceof OnlyPreviewContractError && error.code === 'INVALID_INPUT') throw error;
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'The operating system could not copy this item.'
      );
    }
  }
}

export const onlyPreviewClipboardService = new OnlyPreviewClipboardService();
