import { XpcPreloadHandler } from 'electron-xpc/preload';
import * as fs from 'fs';
import * as path from 'path';

export interface StatResult {
  path: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
  birthtimeMs: number;
  mtimeMs: number;
  atimeMs: number;
  mode: number;
}

export interface DirentResult {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
}

export interface ReaddirResult {
  dirPath: string;
  entries: DirentResult[];
}

export interface ReadFileResult {
  filePath: string;
  totalLines: number;
  returnedLines: string;
  truncated: boolean;
  content: string;
}

export interface WriteFileParams {
  filePath: string;
  content: string;
  encoding?: BufferEncoding;
}

export interface AppendFileParams {
  filePath: string;
  content: string;
  encoding?: BufferEncoding;
}

export interface RenameParams {
  oldPath: string;
  newPath: string;
}

export interface CopyFileParams {
  src: string;
  dest: string;
}

export interface MkdirParams {
  dirPath: string;
  recursive?: boolean;
}

export interface RmdirParams {
  dirPath: string;
  recursive?: boolean;
}

export interface ReaddirParams {
  dirPath: string;
}

export interface StatParams {
  filePath: string;
}

export interface ExistsParams {
  filePath: string;
}

export interface ReadFileParams {
  filePath: string;
  startLine?: number;
  endLine?: number;
  encoding?: BufferEncoding;
}

export interface UnlinkParams {
  filePath: string;
}

export interface MkdirpParams {
  dirPath: string;
}

export interface GlobParams {
  dirPath: string;
  pattern: string;
  maxDepth?: number;
}

export interface GlobResult {
  dirPath: string;
  pattern: string;
  files: string[];
}

const MAX_CHARS = 8000;

class FsHandler extends XpcPreloadHandler {
  async readdir(params: ReaddirParams): Promise<ReaddirResult> {
    const { dirPath } = params;
    const rawEntries = fs.readdirSync(dirPath, { withFileTypes: true });
    const entries: DirentResult[] = rawEntries.map((dirent) => {
      let type: DirentResult['type'] = 'other';
      if (dirent.isFile()) type = 'file';
      else if (dirent.isDirectory()) type = 'directory';
      else if (dirent.isSymbolicLink()) type = 'symlink';
      return { name: dirent.name, type };
    });
    return { dirPath, entries };
  }

  async stat(params: StatParams): Promise<StatResult> {
    const { filePath } = params;
    const s = fs.statSync(filePath);
    return {
      path: filePath,
      isFile: s.isFile(),
      isDirectory: s.isDirectory(),
      isSymbolicLink: s.isSymbolicLink(),
      size: s.size,
      birthtimeMs: s.birthtimeMs,
      mtimeMs: s.mtimeMs,
      atimeMs: s.atimeMs,
      mode: s.mode,
    };
  }

  async exists(params: ExistsParams): Promise<boolean> {
    return fs.existsSync(params.filePath);
  }

  async readFile(params: ReadFileParams): Promise<ReadFileResult> {
    const { filePath, startLine, endLine, encoding = 'utf-8' } = params;
    const raw = fs.readFileSync(filePath, { encoding });
    const lines = raw.split('\n');
    const start = (startLine ?? 1) - 1;
    const end = endLine ?? lines.length;
    const slice = lines.slice(start, end).join('\n');
    const truncated = slice.length > MAX_CHARS;
    return {
      filePath,
      totalLines: lines.length,
      returnedLines: `${start + 1}-${Math.min(end, lines.length)}`,
      truncated,
      content: slice.slice(0, MAX_CHARS),
    };
  }

  async writeFile(params: WriteFileParams): Promise<void> {
    const { filePath, content, encoding = 'utf-8' } = params;
    fs.writeFileSync(filePath, content, { encoding });
  }

  async appendFile(params: AppendFileParams): Promise<void> {
    const { filePath, content, encoding = 'utf-8' } = params;
    fs.appendFileSync(filePath, content, { encoding });
  }

  async unlink(params: UnlinkParams): Promise<void> {
    fs.unlinkSync(params.filePath);
  }

  async rename(params: RenameParams): Promise<void> {
    fs.renameSync(params.oldPath, params.newPath);
  }

  async copyFile(params: CopyFileParams): Promise<void> {
    fs.copyFileSync(params.src, params.dest);
  }

  async mkdir(params: MkdirParams): Promise<void> {
    const { dirPath, recursive = false } = params;
    fs.mkdirSync(dirPath, { recursive });
  }

  async rmdir(params: RmdirParams): Promise<void> {
    const { dirPath, recursive = false } = params;
    fs.rmSync(dirPath, { recursive, force: recursive });
  }

  async glob(params: GlobParams): Promise<GlobResult> {
    const { dirPath, pattern, maxDepth = 5 } = params;
    const files: string[] = [];
    const regex = new RegExp(
      '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$',
    );

    const walk = (currentPath: string, depth: number): void => {
      if (depth > maxDepth) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const relPath = path.relative(dirPath, fullPath);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.isFile() && regex.test(entry.name)) {
          files.push(relPath);
        }
      }
    };

    walk(dirPath, 0);
    return { dirPath, pattern, files };
  }
}

export const fsHandler = new FsHandler();
