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

const WINDOWS_CLIPBOARD_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$items = New-Object System.Collections.Specialized.StringCollection',
  `[void]$items.Add($env:${ONLY_PREVIEW_WINDOWS_CLIPBOARD_PATH_ENV})`,
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
  targetPath: string,
  environment: NodeJS.ProcessEnv = process.env
): OnlyPreviewClipboardCommand => {
  validateClipboardTarget(platform, targetPath);
  const commonOptions = {
    encoding: 'utf8' as const,
    maxBuffer: ONLY_PREVIEW_CLIPBOARD_MAX_OUTPUT_BYTES,
    shell: false as const,
    timeout: ONLY_PREVIEW_CLIPBOARD_TIMEOUT_MS,
    windowsHide: true as const
  };
  if (platform === 'darwin') {
    return {
      executable: '/usr/bin/osascript',
      args: [
        '-e',
        'on run argv',
        '-e',
        'set the clipboard to POSIX file (item 1 of argv)',
        '-e',
        'end run',
        '--',
        targetPath
      ],
      options: commonOptions
    };
  }
  if (platform === 'win32') {
    return {
      executable: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_CLIPBOARD_SCRIPT],
      options: {
        ...commonOptions,
        env: {
          ...environment,
          [ONLY_PREVIEW_WINDOWS_CLIPBOARD_PATH_ENV]: targetPath
        }
      }
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
    try {
      validateClipboardTarget(this.platform, item.realPath);
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
            createOnlyPreviewClipboardCommand(this.platform, item.realPath, this.environment)
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
      this.textClipboard.writeText(projectClipboardText(item, copyKind));
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
