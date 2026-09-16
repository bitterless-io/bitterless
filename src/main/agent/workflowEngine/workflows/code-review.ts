import { Type } from 'typebox'
import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { makeAdvisoryWorkflow, type Lens } from './advisory'
import { parseAllowedDiffCommand, formatReviewDiffTarget, type ReviewDiffTarget } from './review-diff-target'
const ScopeSchema = Type.Object({
  repositoryRoot: Type.String({ minLength: 1, description: 'Exact Git repository root: absolute or relative to the workflow working directory. Must remain inside that workspace.' }),
  diffCommand: Type.String(), files: Type.Array(Type.String()), summary: Type.String(), conventions: Type.Optional(Type.String())
})
const ANGLES: Lens[] = [
  { label: 'logic-bugs', category: 'bug', text: 'Off-by-one errors, wrong conditionals, incorrect return values, broken control flow.' },
  { label: 'error-paths', category: 'bug', text: 'Unhandled errors, swallowed exceptions, missing awaits, partial failure leaving inconsistent state.' },
  { label: 'edge-cases', category: 'bug', text: 'Empty/null inputs, boundary values, concurrency races, resource leaks.' },
  { label: 'simplification', category: 'cleanup', text: 'Dead code, needless complexity, duplicated logic, clearer equivalents.' },
  { label: 'conventions', category: 'cleanup', text: 'Violations of project naming, idioms or banned patterns established by scope.' }
]
const normalizePath = (path: string) => path.replace(/^[ab]\//, '').replaceAll('\\', '/')
/** Only changed new-side lines are eligible findings; adjacent context allows one-line pinpoint drift. */
export function changedLines(diff: string): Map<string, Set<number>> {
  const byFile = new Map<string, Set<number>>()
  let file: string | null = null, line = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) { file = raw.slice(4).trim() === '/dev/null' ? null : normalizePath(raw.slice(4).trim()); if (file && !byFile.has(file)) byFile.set(file, new Set()) }
    else if (raw.startsWith('@@')) line = Number(/\+(\d+)/.exec(raw)?.[1] ?? 0)
    else if (!file || raw.startsWith('---') || raw.startsWith('\\')) continue
    else if (raw.startsWith('+')) byFile.get(file)!.add(line++)
    else if (!raw.startsWith('-')) line++
  }
  return byFile
}
export function inDiff(diff: string, file: string, line?: number): boolean {
  const set = changedLines(diff).get(normalizePath(file))
  return Boolean(set && (line == null || set.has(line) || set.has(line - 1) || set.has(line + 1)))
}
export async function resolveReviewRepositoryRoot(repositoryRoot: string, workflowCwd: string, signal: AbortSignal): Promise<string> {
  if (!repositoryRoot.trim()) throw new Error('Code-review scope must include an explicit repositoryRoot')
  const workspace = await realpath(workflowCwd)
  const repository = await realpath(resolve(workspace, repositoryRoot))
  const pathFromWorkspace = relative(workspace, repository)
  if (pathFromWorkspace === '..' || pathFromWorkspace.startsWith(`..${sep}`) || isAbsolute(pathFromWorkspace)) {
    throw new Error(`Code-review repository is outside the selected workspace: ${repository}`)
  }
  const result = await promisify(execFile)('git', ['rev-parse', '--show-toplevel'], { cwd: repository, signal, encoding: 'utf8', timeout: 10_000 })
  const gitRoot = await realpath(result.stdout.trim())
  if (gitRoot !== repository) throw new Error(`Code-review repositoryRoot must be the exact Git root: selected ${repository}; Git root is ${gitRoot}`)
  return repository
}
async function capture(target: ReviewDiffTarget, signal: AbortSignal, repositoryRoot: string): Promise<string> {
  const command = target.kind === 'git' ? 'git' : 'gh'
  const args = target.kind === 'git' ? target.args : ['pr', 'diff', String(target.number)]
  const result = await promisify(execFile)(command, args, { cwd: repositoryRoot, signal, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', timeout: 60_000 })
  return result.stdout
}
export function createCodeReview(captureDiff: typeof capture = capture, workflowCwd: () => string = () => process.cwd()) {
  return makeAdvisoryWorkflow({
    name: 'code-review', description: 'Scope a concrete diff, find through independent lenses, verify each candidate, and synthesize advisory findings.', scopeSchema: ScopeSchema, lenses: ANGLES, perLens: 6,
    scopePrompt: () => `Establish the exact code-review scope. Workflow working directory: ${workflowCwd()}. Identify and verify the requested Git repository with git rev-parse --show-toplevel, including a nested repository when the user names a project. Return its exact repositoryRoot (absolute or relative to this working directory, never outside it); do not assume the working directory is the requested repository. Run inspection commands inside that repository. Respect an explicit PR, branch, ref range, or focused files. Use canonical \`git diff -- <path>\` for paths and a single A..B/A...B operand for revisions, never ambiguous \`git diff A B\`. diffCommand must contain only the allowlisted git/gh diff command, without cd, -C, or shell operators; repositoryRoot selects its working directory. Paths in the diff command and files must be repository-relative. With no target, inspect current branch, open PR if available, then main/master base diff or HEAD~1 until a non-empty diff is confirmed. Read project conventions. Return repositoryRoot, exact diffCommand, changed files, summary and conventions. Never widen a user-limited empty diff.`,
    prepare: async (scope, signal) => {
      const target = parseAllowedDiffCommand(String(scope.diffCommand))
      if ('error' in target) throw new Error(`Code-review target rejected: ${target.error}`)
      const repositoryRoot = await resolveReviewRepositoryRoot(String(scope.repositoryRoot ?? ''), workflowCwd(), signal)
      const diff = await captureDiff(target, signal, repositoryRoot)
      if (!diff.trim()) throw new Error(`The selected review diff is empty in repository ${repositoryRoot}: ${formatReviewDiffTarget(target)}. Code-review reviews changes, not unchanged files; provide a non-empty ref range or changed-file target. The selected baseline and path filters were preserved.`)
      return { scope: { ...scope, repositoryRoot, diff }, context: `Review scope: ${JSON.stringify({ ...scope, repositoryRoot })}\nVerified repository root: ${repositoryRoot}\nAgent working directory remains ${workflowCwd()}. For read/grep/find/ls use absolute paths under the verified repository root; for bash run inside that repository explicitly. Candidate locations.file MUST remain repository-relative (for example apps/relay/src/index.ts), never absolute or prefixed with the workspace path.\nExact allowlisted command (captured in that repository): ${formatReviewDiffTarget(target)}\nCaptured diff (review this single snapshot):\n${diff}` }
    },
    keep: (candidate, ready) => {
      const location = candidate.locations[0]
      return Boolean(location && inDiff(String(ready.scope.diff), location.file, location.line))
    },
    finderPrompt: 'Review ONLY changed lines in the captured diff. Read surrounding code for context but never report existing issues outside the diff. Each candidate must name a concrete failure or maintenance scenario; cleanup is separate from correctness.',
    verifierPrompt: 'Independently read the changed lines and surrounding code. Verify the candidate against the captured diff; do not substitute a later different diff. Default toward REFUTED without concrete evidence. Quote relevant lines and the actual failure path.',
    synthesisPrompt: 'Rank correctness bugs above cleanup, and confirmed above plausible. Keep category bug/cleanup distinct from severity low/medium/high. Copy each retained candidate summary exactly so its evidence stays bound; recommendations are advisory directions.'
  })
}
export default createCodeReview()
