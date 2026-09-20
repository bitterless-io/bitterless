const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const bl = fs.existsSync(path.join(root, 'src/main/agent/maestroAgent.service.ts'))
const engine = 'src/main/agent/workflowEngine'

function load(relative, modules = {}) {
  const filename = path.join(root, relative)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', '__dirname', code)((name) => {
    if (name in modules) return modules[name]
    if (name.startsWith('node:')) return require(name)
    return require(name)
  }, module, module.exports, path.dirname(filename))
  return module.exports
}

// The planner moved out of the retired Kimchi `workflows/` directory when the engine changed. Its
// schema, prompt and renderer came with it unchanged — only the wrapper (one structured-output agent
// plus a formatting step) became a script. These assertions are about that unchanged part, so they
// follow it rather than being deleted with the directory.
const planner = load(`${engine}/dynamic/planScript.ts`)
const { renderWorkflowPlan, WORKFLOW_PLAN_SCHEMA: WorkflowPlanSchema, WORKFLOW_DESIGN_PROMPT } = planner

const plan = {
  goal: '每周把新到的客户资料整理成一份可直接发出的简报。',
  summary: '扫描资料目录，逐份解析，按客户归并，产出简报。',
  acceptanceCriteria: ['每份新资料都在简报里出现', '无法解析的资料单独列出并说明原因'],
  decisions: ['推断：资料目录就是当前工作区的 intake/，因为没有别的候选'],
  openQuestions: ['简报应该发给谁？'],
  name: 'weekly-client-brief',
  steps: [
    { title: '收集本周新资料', purpose: '列出本周新增的文件', receives: [], produces: ['文件清单'], delivers: [] },
    { title: '生成简报', purpose: '产出可直接发送的简报', receives: ['文件清单'], produces: [], delivers: ['简报正文'] }
  ]
}

test('the plan renders as a reviewable proposal that says nothing was created', () => {
  const rendered = renderWorkflowPlan(plan)
  assert.match(rendered, /^# Proposed workflow/)
  assert.match(rendered, /## Acceptance criteria/)
  assert.match(rendered, /1\. \*\*收集本周新资料\*\* — 列出本周新增的文件/)
  // A step with no prior input and a step that delivers must both read correctly.
  assert.match(rendered, /Receives: nothing from an earlier step/)
  assert.match(rendered, /Makes available: no information for later steps/)
  assert.match(rendered, /Delivers here: 简报正文/)
  assert.match(rendered, /Nothing has been created or run/)
  assert.match(rendered, /`weekly-client-brief`/)
})

test('an inference is never presented as something the user confirmed', () => {
  const rendered = renderWorkflowPlan(plan)
  assert.match(rendered, /## Inferred decisions/)
  assert.doesNotMatch(rendered, /Confirmed decisions/, 'without an interviewer nothing here is confirmed')
  assert.match(rendered, /## Worth correcting before this is built/)
  assert.match(rendered, /简报应该发给谁？/)
  // Both optional sections disappear when empty rather than rendering an empty heading.
  const bare = renderWorkflowPlan({ ...plan, decisions: [], openQuestions: [] })
  assert.doesNotMatch(bare, /Inferred decisions/)
  assert.doesNotMatch(bare, /Worth correcting/)
})

test('the design prompt keeps Kimchi\'s ban on implementation detail and forbids silent assumptions', () => {
  assert.match(WORKFLOW_DESIGN_PROMPT, /Design the first useful version of a workflow/)
  assert.match(WORKFLOW_DESIGN_PROMPT, /Do not decide a file name, framework construct, schema, model, timeout, retry count/)
  assert.match(WORKFLOW_DESIGN_PROMPT, /Never present an inference\s+as something the user confirmed/)
  assert.match(WORKFLOW_DESIGN_PROMPT, /Keep it high-level/)
  // There is no interviewer in this host, so the prompt must not tell the model to ask.
  assert.doesNotMatch(WORKFLOW_DESIGN_PROMPT, /Batch as many useful questions/)
  assert.doesNotMatch(WORKFLOW_DESIGN_PROMPT, /Ask only questions/)
})

test('the plan schema keeps the field meanings the renderer and the model both rely on', () => {
  const properties = WorkflowPlanSchema.properties
  for (const key of ['goal', 'summary', 'acceptanceCriteria', 'decisions', 'openQuestions', 'name', 'steps']) {
    assert.ok(properties[key], `${key} is missing from the plan schema`)
  }
  assert.equal(properties.acceptanceCriteria.minItems, 1, 'a plan with no acceptance criteria is not reviewable')
  assert.equal(properties.steps.minItems, 1)
  const step = properties.steps.items.properties
  for (const key of ['title', 'purpose', 'receives', 'produces', 'delivers']) {
    assert.ok(step[key], `${key} is missing from the step schema`)
    assert.equal(typeof step[key].description, 'string')
  }
})

test('the planner plans only: its run gets no write or execute tool', () => {
  const script = planner.planWorkflowScript()
  assert.match(script, /creates and runs nothing/)
  // This engine has NO per-agent tool list — the package's own capability contract names
  // label/phase/schema/model/thinking/tier/isolation/cwd/thread/agentType/timeoutMs/retries and
  // nothing else — so the retired `tools: ['read','grep','find','ls']` could not be carried over as
  // written. Read-only is enforced for the whole RUN instead, which is the right grain: nothing in a
  // planning run should write. Losing this in the port is exactly what this test caught.
  const builtins = fs.readFileSync(path.join(root, `${engine}/builtins.ts`), 'utf8')
  assert.match(builtins, /const READONLY[^=]*=\s*new Set\(\['plan-workflow'\]\)/, 'the planner must be marked read-only')
  const worker = fs.readFileSync(path.join(root, `${engine}/engine.worker.ts`), 'utf8')
  assert.match(worker, /builtinIsReadOnly\(request\.entry\.name\) \? READONLY_TOOLSET/, 'the mark has to actually select the toolset')
  assert.match(worker, /\[READONLY_TOOLSET\]: \(\) => \[\.\.\.createReadOnlyTools\(/, 'and that toolset has to be read-only tools')
})

test('a stopped or failed design reports that, instead of rendering an empty proposal', () => {
  // Same guarantee, now expressed in the generated script: no plan means say so, never render an
  // empty proposal that reads as a real one.
  const script = planner.planWorkflowScript()
  assert.match(script, /Workflow planning did not complete/)
  assert.match(script, /if \(!plan\) return/)
})

test('the planner is registered as a built-in in this app', () => {
  const builtins = fs.readFileSync(path.join(root, `${engine}/builtins.ts`), 'utf8')
  assert.match(builtins, /plan-workflow/)
  const api = fs.readFileSync(path.join(root, 'src/shared/agentWorkflow.api.ts'), 'utf8')
  assert.match(api, /'plan-workflow'/, 'WorkflowBuiltinName must include it or the registry type fails')
  const host = fs.readFileSync(path.join(root, `${engine}/hostIntegration.ts`), 'utf8')
  assert.match(host, /name: 'plan-workflow'/, 'the model cannot pick a workflow that workflow_list never shows')
  assert.ok(bl !== undefined)
})
