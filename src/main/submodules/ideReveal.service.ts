// Revealing a submodule in the IDE is a *file* operation, not a project operation. WebStorm's own
// launcher documents exactly two shapes — `webstorm /project/dir` opens that directory **as a
// project**, and `webstorm /project/dir file` opens the file *in the context of* that project. So a
// submodule directory handed to the launcher can only ever become a second project window, while the
// file form lands as a tab in the window that already owns the workspace and lets the Project view
// select the submodule. The watched root is therefore the only project target: an IDE that is not
// running yet cold-starts on the workspace, never on the submodule.
//
// Every submodule must therefore have exactly one predictable file to open: its README when it has
// one, otherwise an empty `.BL_ANCHOR` this service creates. The anchor is a Bitterless artifact, not
// repository content, so it is registered in that repository's own `info/exclude`.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/** Case-insensitive `README`, with or without one extension: `README.md`, `readme`, `ReadMe.rst`. */
const README_PATTERN = /^readme(\.[^.]+)?$/i;

/** Created empty inside a submodule that carries no README, so every row has a file to open. */
export const ANCHOR_FILE_NAME = '.BL_ANCHOR';

export interface IdeRevealPlan {
  /** Launcher argv: the workspace root first, then the file whose tab performs the reveal. */
  args: string[];
  /** Null only when the submodule directory is gone, so nothing inside it can be opened. */
  anchorPath: string | null;
}

const isFile = (candidate: string): boolean => {
  try {
    // statSync, not the dirent flag: a symlinked file is a perfectly good reveal anchor.
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const isMarkdown = (name: string): boolean => name.toLowerCase().endsWith('.md');

const findReadme = (directory: string): string | null => {
  let names: string[] = [];
  try {
    names = readdirSync(directory).filter((name) => README_PATTERN.test(name));
  } catch {
    return null;
  }
  // `README.md` wins over an extensionless `README` or an `.rst` twin; ties break alphabetically.
  names.sort((a, b) => Number(isMarkdown(b)) - Number(isMarkdown(a)) || a.localeCompare(b));
  for (const name of names) {
    const candidate = join(directory, name);
    if (isFile(candidate)) return candidate;
  }
  return null;
};

/**
 * A registered submodule keeps a `.git` pointer file (`gitdir: ../../.git/modules/<name>`) while an
 * independently cloned one keeps a real `.git` directory, and a linked worktree keeps its shared
 * state in `commondir`. Resolved here instead of imported from the scanner so this service depends
 * on nothing but `node:*` and stays directly unit-testable.
 */
const resolveGitInfoDirectory = (submodulePath: string): string | null => {
  const gitPath = join(submodulePath, '.git');
  let gitDirectory: string | null = null;
  try {
    const stats = statSync(gitPath);
    if (stats.isDirectory()) gitDirectory = gitPath;
    else if (stats.isFile()) {
      const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitPath, 'utf8').trim());
      const target = match?.[1]?.trim();
      if (target) gitDirectory = isAbsolute(target) ? target : resolve(submodulePath, target);
    }
  } catch {
    return null;
  }
  if (!gitDirectory) return null;

  try {
    const common = readFileSync(join(gitDirectory, 'commondir'), 'utf8').trim();
    if (common) gitDirectory = isAbsolute(common) ? common : resolve(gitDirectory, common);
  } catch {
    // No `commondir` is the normal case: this Git directory already holds `info/exclude`.
  }
  return join(gitDirectory, 'info');
};

/**
 * Keeps the anchor out of `git status` and out of a `git add -A` sync by listing it in the
 * repository's local `info/exclude` — never in a tracked `.gitignore`, so a shared or third-party
 * repository is not modified. Best effort: losing the exclusion must not cost the reveal.
 */
const excludeAnchorFromGit = (submodulePath: string): void => {
  const infoDirectory = resolveGitInfoDirectory(submodulePath);
  if (!infoDirectory) return;
  const excludePath = join(infoDirectory, 'exclude');
  try {
    const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
    if (current.split('\n').some((line) => line.trim() === ANCHOR_FILE_NAME)) return;
    mkdirSync(infoDirectory, { recursive: true });
    const separator = current && !current.endsWith('\n') ? '\n' : '';
    writeFileSync(excludePath, `${current}${separator}${ANCHOR_FILE_NAME}\n`);
  } catch {
    // A read-only or absent Git directory only costs the exclusion.
  }
};

const ensureAnchorFile = (directory: string): string | null => {
  const anchor = join(directory, ANCHOR_FILE_NAME);
  if (!isFile(anchor)) {
    try {
      // `wx`: an existing non-file entry of that name is left alone instead of being clobbered.
      writeFileSync(anchor, '', { flag: 'wx' });
    } catch {
      return null;
    }
  }
  excludeAnchorFromGit(directory);
  return anchor;
};

/**
 * The file that carries the reveal for a submodule directory: its README, otherwise the empty
 * `.BL_ANCHOR` created for exactly this purpose. Null means the directory itself could not be
 * written to — a missing submodule — so only the workspace root can be handed to the IDE.
 */
export const resolveAnchorFile = (directory: string): string | null =>
  findReadme(directory) ?? ensureAnchorFile(directory);

export const planIdeReveal = (params: {
  rootPath: string;
  submodulePath: string;
}): IdeRevealPlan => {
  const anchorPath = resolveAnchorFile(params.submodulePath);
  return {
    args: anchorPath ? [params.rootPath, anchorPath] : [params.rootPath],
    anchorPath
  };
};
