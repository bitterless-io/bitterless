import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import { runWorkflow } from '@kimchi-dev/kimchi-workflows/engine'

const engineRoot = fileURLToPath(new URL('../../src/main/agent/workflowEngine/', import.meta.url))
const resolver = createJiti(import.meta.url)
const alias = {}
for (const name of ['typebox', 'typebox/value', 'typebox/compile', '@kimchi-dev/kimchi-workflows', '@kimchi-dev/kimchi-workflows/flow', '@kimchi-dev/kimchi-workflows/engine']) alias[name] = fileURLToPath(resolver.esmResolve(name))
const jiti = createJiti(import.meta.url, { alias, fsCache: false })
const { createCodeReview, resolveReviewRepositoryRoot } = await jiti.import(join(engineRoot, 'workflows/code-review.ts'))
const { KimchiHost } = await jiti.import(join(engineRoot, 'kimchiHost.ts'))
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const commit = cwd => git(cwd, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture')
const location = { file: 'apps/relay/index.ts', line: 1 }
const candidate = { summary: 'Zero quantity uses one', category: 'bug', locations: [location], impact: 'Incorrect zero value' }

async function fixtureRepos() {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'review-repositories-')))
  const workspace = join(temp, 'workspace'), repository = join(workspace, 'projects', 'child')
  await mkdir(repository, { recursive: true })
  git(workspace, 'init', '-b', 'main')
  await writeFile(join(workspace, '.gitignore'), 'projects/\n')
  git(workspace, 'add', '.gitignore'); commit(workspace)
  git(repository, 'init', '-b', 'fixture')
  await mkdir(join(repository, 'apps/relay'), { recursive: true })
  await writeFile(join(repository, 'apps/relay/index.ts'), 'export const quantity = input.quantity\n')
  git(repository, 'add', '.'); commit(repository)
  git(repository, 'update-ref', 'refs/heads/main', 'HEAD')
  await writeFile(join(repository, 'apps/relay/index.ts'), 'export const quantity = input.quantity || 1\n')
  git(repository, 'add', '.'); commit(repository)
  return { temp, workspace, repository }
}

async function runReview(workspace, scope) {
  const definition = createCodeReview(undefined, () => workspace)
  const events = [], controller = new AbortController()
  let host
  host = new KimchiHost(definition, { sessionId: 'chat', entry: { kind: 'builtin', name: 'code-review' }, input: 'Review child relay', cwd: workspace }, { id: 'run', sessionId: 'chat' }, { providerId: 'fixture', modelId: 'fixture', thinkingLevel: 'low', authPath: '/unused', systemPrompt: '', tools: [] }, controller.signal, event => {
    events.push(event)
    queueMicrotask(() => {
      if (event.type === 'attempt.cancel') host.handle({ type: 'attempt.result', id: event.id })
      if (event.type !== 'attempt.start') return
      const attempt = event.attempt, properties = attempt.opts.outputSchema.anyOf[0].properties.output.properties
      const output = properties.repositoryRoot ? scope
        : properties.candidates ? { candidates: [candidate] }
        : properties.verdict ? { verdict: 'CONFIRMED', evidence: ['apps/relay/index.ts:1 uses quantity || 1'], confidence: 'high' }
        : { summary: 'Verified finding', findings: [], nextSteps: [] }
      host.handle({ type: 'attempt.turn.result', id: attempt.id, turnId: attempt.turnId, result: { text: '', submitted: { tool: 'workflow_submit_result', arguments: { result: { status: 'completed', output } } } } })
    })
  })
  const result = await runWorkflow(definition, 'Review child relay', host, { signal: controller.signal })
  await host.drain()
  return { result, attempts: events.filter(event => event.type === 'attempt.start').map(event => event.attempt) }
}

test('code-review captures the scoped nested repository and keeps repository-relative evidence', async () => {
  const { temp, workspace, repository } = await fixtureRepos()
  const originalCwd = process.cwd()
  try {
    assert.equal(git(workspace, 'diff', 'main...HEAD', '--', 'apps/relay'), '')
    assert.match(git(repository, 'diff', 'main...HEAD', '--', 'apps/relay'), /input.quantity \|\| 1/)
    const { result, attempts } = await runReview(workspace, { repositoryRoot: 'projects/child', diffCommand: 'git diff main...HEAD -- apps/relay', files: [location.file], summary: 'Relay changes' })
    assert.equal(result.status, 'completed', result.error)
    assert.equal(result.output.stats.kept, 1)
    assert.deepEqual(result.output.findings[0].locations, [location])
    assert.deepEqual(result.output.findings[0].evidence, ['apps/relay/index.ts:1 uses quantity || 1'])
    const investigators = attempts.filter(attempt => / finder |independent verifier/.test(attempt.prompt))
    assert.equal(investigators.length, 6)
    for (const attempt of investigators) {
      assert(attempt.prompt.includes(`Verified repository root: ${repository}`))
      assert(attempt.prompt.includes('Candidate locations.file MUST remain repository-relative'))
      assert(attempt.prompt.includes('+export const quantity = input.quantity || 1'))
    }
    assert(attempts[0].prompt.includes(`Workflow working directory: ${workspace}`))
    assert.equal(process.cwd(), originalCwd)
  } finally { await rm(temp, { recursive: true, force: true }) }
})

test('empty nested diff reports exact repository and unchanged filters without widening', async () => {
  const { temp, workspace, repository } = await fixtureRepos()
  try {
    const { result, attempts } = await runReview(workspace, { repositoryRoot: repository, diffCommand: 'git diff main...HEAD -- apps/other', files: [], summary: 'Explicit empty target' })
    assert.equal(result.status, 'crashed')
    assert(result.error.includes(repository))
    assert(result.error.includes('apps/other'))
    assert(result.error.includes('Code-review reviews changes, not unchanged files'))
    assert.equal(attempts.length, 1)
  } finally { await rm(temp, { recursive: true, force: true }) }
})

test('review root is explicit, exact, canonical and cannot escape workspace through symlinks', async () => {
  const { temp, workspace, repository } = await fixtureRepos()
  const signal = new AbortController().signal
  try {
    assert.equal(await resolveReviewRepositoryRoot('projects/child', workspace, signal), repository)
    await assert.rejects(resolveReviewRepositoryRoot('', workspace, signal), /explicit repositoryRoot/)
    await assert.rejects(resolveReviewRepositoryRoot('projects/child/apps/relay', workspace, signal), /exact Git root/)
    const outside = join(temp, 'outside'); await mkdir(outside)
    await symlink(outside, join(workspace, 'outside-link'))
    await assert.rejects(resolveReviewRepositoryRoot('../outside', workspace, signal), /outside the selected workspace/)
    await assert.rejects(resolveReviewRepositoryRoot('outside-link', workspace, signal), /outside the selected workspace/)
  } finally { await rm(temp, { recursive: true, force: true }) }
})
