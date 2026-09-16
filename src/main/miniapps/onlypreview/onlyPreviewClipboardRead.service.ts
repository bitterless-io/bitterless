import { execFile } from 'node:child_process';
import { posix, win32 } from 'node:path';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';

export const createOnlyPreviewClipboardReadCommand = (
  platform: NodeJS.Platform
): { executable: string; args: string[] } => {
  if (platform === 'darwin') {
    return {
      executable: '/usr/bin/osascript',
      args: [
        '-l',
        'JavaScript',
        '-e',
        [
          "ObjC.import('AppKit');",
          'function run() {',
          '  const urls = $.NSPasteboard.generalPasteboard.readObjectsForClassesOptions(',
          '    $([$.NSURL]), $({ NSPasteboardURLReadingFileURLsOnlyKey: true }));',
          '  const paths = [];',
          '  if (urls) for (let i = 0; i < urls.count; i++) {',
          '    const url = urls.objectAtIndex(i);',
          '    if (url.isFileURL) paths.push(ObjC.unwrap(url.path));',
          '  }',
          '  return JSON.stringify(paths);',
          '}'
        ].join('\n')
      ]
    };
  }
  if (platform === 'win32') {
    return {
      executable: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ConvertTo-Json -Compress -InputObject @([System.Windows.Forms.Clipboard]::GetFileDropList())'
      ]
    };
  }
  throw new OnlyPreviewContractError(
    'OPERATION_FAILED',
    'File paste is unavailable on this platform.'
  );
};

export const parseOnlyPreviewClipboardFiles = (
  output: string,
  platform: NodeJS.Platform
): string[] => {
  const values: unknown = JSON.parse(output.replace(/^\uFEFF/u, '').trim());
  const path = platform === 'win32' ? win32 : posix;
  if (
    !Array.isArray(values) ||
    values.length > 200 ||
    values.some(
      (value) =>
        typeof value !== 'string' || !value || value.includes('\0') || !path.isAbsolute(value)
    )
  ) {
    throw new OnlyPreviewContractError(
      'INVALID_INPUT',
      'Clipboard file list is invalid or too large.'
    );
  }
  return [...new Set(values as string[])];
};

export const readOnlyPreviewClipboardFiles = async (): Promise<string[]> => {
  const command = createOnlyPreviewClipboardReadCommand(process.platform);
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      command.executable,
      command.args,
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        shell: false,
        timeout: 5000,
        windowsHide: true
      },
      (error, stdout) => {
        if (error) {
          reject(
            new OnlyPreviewContractError(
              'OPERATION_FAILED',
              'The operating system could not read copied files.'
            )
          );
        } else resolve(stdout);
      }
    );
  });
  return parseOnlyPreviewClipboardFiles(output, process.platform);
};
