import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const debuggerCapture = readFileSync(join(root, 'main/maestro/capture/debuggerCapture.ts'), 'utf8')
const replayEngine = readFileSync(join(root, 'main/maestro/drive/replayEngine.ts'), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

assert(debuggerCapture.includes("if (tag === 'select') return 'combobox'"), 'native select should appear as combobox in YAML')
assert(debuggerCapture.includes('const selectOptions = (el: HTMLSelectElement): AriaNode[]'), 'closed select options should be enumerated explicitly')
assert(debuggerCapture.includes('Array.from(el.options)'), 'select option enumeration should read HTMLSelectElement.options')
assert(debuggerCapture.includes("const node: AriaNode = { role: 'option', ref: stamp(opt) }"), 'select options should become option nodes with refs')
assert(debuggerCapture.includes('if (opt.value && opt.value !== text) node.value = clean(opt.value, 160)'), 'option value should be preserved when it differs from label')
assert(debuggerCapture.includes('if (opt.selected) node.selected = true'), 'selected option state should be preserved')
assert(debuggerCapture.includes("if (n.value) line += ' [value=' + JSON.stringify(n.value) + ']'"), 'YAML should render value attributes')
assert(debuggerCapture.includes("if (n.selected) line += ' [selected]'"), 'YAML should render selected state')
assert(
  debuggerCapture.includes('- combobox "Item" [value="CT26"] [ref=e9]:') && debuggerCapture.includes('- option "CT Lung" [selected] [ref=e10]'),
  'snapshot docs should show Playwright-style select YAML shape'
)

assert(replayEngine.includes('const selectValue = async (el: Element, rawValue: string)'), 'select executor should have a dedicated helper')
assert(replayEngine.includes('options.find((option) => option.value === value && !option.disabled)'), 'native select should match exact option value')
assert(replayEngine.includes("options.find((option) => (option.textContent || '').trim() === value && !option.disabled)"), 'native select should match exact visible text')
assert(replayEngine.includes('options.find((option) => norm(option.value) === target && !option.disabled)'), 'native select should match normalized value')
assert(replayEngine.includes('options.find((option) => norm(option.textContent) === target && !option.disabled)'), 'native select should match normalized visible text')
assert(replayEngine.includes('options.find((option) => norm(option.label) === target && !option.disabled)'), 'native select should match option label')
assert(replayEngine.includes("document.querySelectorAll('[role=\"option\"],[role=\"menuitem\""), 'custom combobox should search visible option/menuitem nodes')
assert(replayEngine.includes("option.getAttribute('data-value')"), 'custom combobox should match data-value')
assert(replayEngine.includes("option.getAttribute('data-option-value')"), 'custom combobox should match data-option-value')
assert(replayEngine.includes("option.getAttribute('title')"), 'custom combobox should match title')
assert(replayEngine.includes('const parentSelect = el instanceof HTMLOptionElement ? el.closest(\'select\')'), 'select executor should support direct native option refs')
assert(replayEngine.includes('if (isChoiceNode(el) && !isDisabledChoice(el) && (!wanted || optionMatches(el, wanted)))'), 'select executor should support direct custom option refs')
assert(replayEngine.includes('target.dispatchEvent(new Event(\'change\', { bubbles: true }))'), 'custom option click should emit change')

const extractConstFunction = (source, name, nextMarker) => {
  const start = source.indexOf(`const ${name} = `)
  if (start < 0) throw new Error(`missing ${name}`)
  const end = nextMarker ? source.indexOf(nextMarker, start) : -1
  if (end < 0) throw new Error(`missing end marker for ${name}: ${nextMarker}`)
  return source.slice(start, end).trim()
}

const stripTs = (source) =>
  source
    .replace(/interface AriaNode[\s\S]*?\n}\n\n/g, '')
    .replace(/const snapshotWalker = \(\): \{[\s\S]*?\n\} =>/, 'const snapshotWalker = () =>')
    .replace(/const clean = \(v: unknown, max = 200\): string =>/g, 'const clean = (v, max = 200) =>')
    .replace(/const css = \(v: unknown\): string =>/g, 'const css = (v) =>')
    .replace(/const directText = \(el: Element\): string =>/g, 'const directText = (el) =>')
    .replace(/const roleOf = \(el: Element\): string \| undefined =>/g, 'const roleOf = (el) =>')
    .replace(/const idText = \(ids: string\): string =>/g, 'const idText = (ids) =>')
    .replace(/const nameOf = \(el: Element, role: string\): string =>/g, 'const nameOf = (el, role) =>')
    .replace(/const isHidden = \(el: Element\): boolean =>/g, 'const isHidden = (el) =>')
    .replace(/const isBoxlessPassthrough = \(el: Element\): boolean =>/g, 'const isBoxlessPassthrough = (el) =>')
    .replace(/const frameBody = \(el: Element\): Element \| null =>/g, 'const frameBody = (el) =>')
    .replace(/const renderedChildren = \(el: Element\): Element\[] =>/g, 'const renderedChildren = (el) =>')
    .replace(/const soak = \(list: AriaNode\[]\): void =>/g, 'const soak = (list) =>')
    .replace(/const isMeaningful = \(el: Element\): boolean =>/g, 'const isMeaningful = (el) =>')
    .replace(/const stamp = \(el: Element\): string =>/g, 'const stamp = (el) =>')
    .replace(/const identOf = \(el: Element\): \{ kind: 'testid' \| 'id'; value: string \} \| null =>/g, 'const identOf = (el) =>')
    .replace(/const describe = \(el: Element\): AriaNode =>/g, 'const describe = (el) =>')
    .replace(/const node: AriaNode =/g, 'const node =')
    .replace(/const selectOptions = \(el: HTMLSelectElement\): AriaNode\[] =>/g, 'const selectOptions = (el) =>')
    .replace(/const walk = \(el: Element, depth: number, boxless = false\): AriaNode\[] =>/g, 'const walk = (el, depth, boxless = false) =>')
    .replace(/selectOptions\(el as HTMLSelectElement\)/g, 'selectOptions(el)')
    .replace(/\(el as HTMLElement\)/g, 'el')
    .replace(/\(el as HTMLIFrameElement\)/g, 'el')
    .replace(/\(el as HTMLSlotElement\)/g, 'el')
    .replace(/\(root as HTMLElement\)/g, 'root')
    .replace(/\(el as HTMLInputElement\)/g, 'el')
    .replace(/\(el as HTMLSelectElement\)/g, 'el')
    .replace(/\(el as HTMLOptionElement\)/g, 'el')
    .replace(/const collapseWrappers = \(nodes: AriaNode\[]\): AriaNode\[] =>/g, 'const collapseWrappers = (nodes) =>')
    .replace(/const toAriaYaml = \(nodes: AriaNode\[], indent = ''\): string =>/g, "const toAriaYaml = (nodes, indent = '') =>")
    .replace(/const lines: \{ raw: string; key: string }\[] = \[]/g, 'const lines = []')
    .replace(/const lines: string\[] = \[]/g, 'const lines = []')
    .replace(/let missingSample: string\[] = \[]/g, 'let missingSample = []')
    .replace(/const candidates: \{ raw: string; key: string }\[] = \[]/g, 'const candidates = []')
    .replace(/const candidates: string\[] = \[]/g, 'const candidates = []')
    .replace(/const seen: Record<string, true> = \{}/g, 'const seen = {}')
    .replace(/const notes: string\[] = \[]/g, 'const notes = []')
    .replace(/const out: AriaNode\[] = \[]/g, 'const out = []')
    .replace(/let line: string/g, 'let line')
    .replace(/let childNodes: AriaNode\[]/g, 'let childNodes')

class FakeTextNode {
  nodeType = 3
  constructor(value) {
    this.nodeValue = value
  }
}

class FakeElement {
  nodeType = 1
  attributes = new Map()
  children = []
  childNodes = []
  parentElement = null
  id = ''
  value = ''
  selected = false
  checked = false
  disabled = false

  constructor(tagName, attrs = {}, children = []) {
    this.tagName = tagName.toUpperCase()
    for (const [key, value] of Object.entries(attrs)) this.setAttribute(key, value)
    for (const child of children) this.append(child)
  }

  append(child) {
    if (typeof child === 'string') {
      this.childNodes.push(new FakeTextNode(child))
      return
    }
    child.parentElement = this
    this.children.push(child)
    this.childNodes.push(child)
  }

  get textContent() {
    return this.childNodes.map((child) => child.nodeType === 3 ? child.nodeValue : child.textContent).join('')
  }

  get options() {
    return this.children.filter((child) => child.tagName.toLowerCase() === 'option')
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    if (name === 'id') this.id = String(value)
    if (name === 'value') this.value = String(value)
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  hasAttribute(name) {
    return this.attributes.has(name)
  }

  getClientRects() {
    return [{}]
  }

  matches(selector) {
    return selector === ':disabled' ? this.disabled : false
  }

  closest(selector) {
    if (selector === 'label') {
      let node = this.parentElement
      while (node) {
        if (node.tagName.toLowerCase() === 'label') return node
        node = node.parentElement
      }
    }
    return null
  }
}

const label = new FakeElement('label', { for: 'department' }, ['Department'])
const optCardio = new FakeElement('option', { value: 'cardio' }, ['Cardiology'])
const optDental = new FakeElement('option', { value: 'dental' }, ['Dental'])
optCardio.selected = true
const select = new FakeElement('select', { id: 'department', name: 'department' }, [optCardio, optDental])
select.value = 'cardio'
const body = new FakeElement('body', {}, [label, select])

const document = {
  title: 'Snapshot Test',
  body,
  documentElement: body,
  getElementById: (id) => (id === 'department' ? select : null),
  querySelector: (selector) => selector === 'label[for="department"]' ? label : null,
  querySelectorAll: (selector) => selector === '[data-coach-ref]' ? [] : []
}
const window = { CSS: { escape: (value) => String(value) } }
// snapshotWalker 的收尾锚点跟着它后面那个声明走：`// Render the aria tree` 之间现在隔着
// comparePayload（`/page_snapshot_compare` 的页内探针），照旧锚会把它一起抽进来。
const source = stripTs([
  extractConstFunction(debuggerCapture, 'snapshotWalker', '\n\n/** 一处剪枝点'),
  extractConstFunction(debuggerCapture, 'collapseWrappers', '\n\nconst toAriaYaml'),
  extractConstFunction(debuggerCapture, 'toAriaYaml', '\n\nconst toStepYaml'),
  'const raw = snapshotWalker();',
  'const yaml = toAriaYaml(collapseWrappers(raw.nodes));',
  '({ raw, yaml });'
].join('\n\n'))
const result = vm.runInNewContext(source, {
  window,
  document,
  CSS: window.CSS,
  Element: FakeElement,
  HTMLInputElement: FakeElement,
  HTMLSelectElement: FakeElement,
  HTMLOptionElement: FakeElement,
  HTMLTextAreaElement: FakeElement,
  Array,
  String,
  JSON,
  Number,
  RegExp
})

assert(result.raw.count === 1, 'behavior snapshot should count the native select and skip label wrapper')
assert(result.yaml.includes('- combobox "Department" [value="cardio"] [name="department"] [ref=e'), 'behavior snapshot should render select as named combobox with selected value and ref')
assert(result.yaml.includes('- option "Cardiology"') && result.yaml.includes('[selected]') && result.yaml.includes('[value="cardio"]'), 'behavior snapshot should render selected option child')
assert(result.yaml.includes('- option "Dental"') && result.yaml.includes('[value="dental"]'), 'behavior snapshot should render non-selected option child')
assert(select.getAttribute('data-coach-ref'), 'snapshot should stamp the select with data-coach-ref for ui_act')
assert(optCardio.getAttribute('data-coach-ref') && optDental.getAttribute('data-coach-ref'), 'snapshot should stamp option refs too')

// ---------------------------------------------------------------------------------------
// Blind spots: content that IS on screen but that the walk used to drop silently.
// A ChatGPT billing page full of transactions was reported to the user as empty because
// of exactly this (docs/issues/page-snapshot-drops-visible-subtrees.md). Each case below
// is one gate that must let visible content through — and the two "secret" ones are the
// reverse guard: genuinely hidden content must STILL be dropped.
const boxless = new FakeElement('div', {}, [new FakeElement('span', {}, ['B-ROW'])])
boxless.getClientRects = () => []
boxless.__display = 'contents'

const shadowHost = new FakeElement('div', { id: 'host' })
shadowHost.shadowRoot = new FakeElement('div', {}, [new FakeElement('span', {}, ['C-ROW'])])

const crossFrame = new FakeElement('iframe', { src: 'https://elsewhere.example/embed' })
crossFrame.contentDocument = null

const ariaHidden = new FakeElement('div', { 'aria-hidden': 'true' }, [new FakeElement('span', {}, ['G-SECRET'])])

// Source text "Demo Center" under CSS text-transform: uppercase. The tree records the source
// (nameOf → textContent, directText → nodeValue); innerText below records what RENDERS. The
// self-check compares the two, so without case folding this reads as a gap that is not there —
// which is what our own demo site did (docs/issues/page-snapshot-incomplete-false-positive-on-text-transform.md).
const cased = new FakeElement('div', {}, ['Demo Center'])

const blindBody = new FakeElement('body', {}, [boxless, shadowHost, crossFrame, ariaHidden, cased])
// What the browser says is visible. The two unreachable lines stand in for blind spots we have
// not found yet: they render, the tree never reaches them, and the self-check must say so.
// "Unreachable Row 42" is deliberately mixed-case — it proves the samples are reported verbatim
// and not in whatever form the comparison happened to normalise them to.
blindBody.innerText = 'B-ROW\nC-ROW\nG-SECRET\nDEMO CENTER\nMISSING-LINE\nUnreachable Row 42'

const blindDocument = {
  title: 'Blind Spots',
  body: blindBody,
  documentElement: blindBody,
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: (selector) =>
    selector === '[aria-hidden="true"],[hidden]' ? [ariaHidden] : []
}
const blindWindow = {
  CSS: { escape: (value) => String(value) },
  getComputedStyle: (el) => ({ display: el.__display || 'block' })
}
const blindSource = stripTs([
  extractConstFunction(debuggerCapture, 'snapshotWalker', '\n\n/** 一处剪枝点'),
  extractConstFunction(debuggerCapture, 'collapseWrappers', '\n\nconst toAriaYaml'),
  extractConstFunction(debuggerCapture, 'toAriaYaml', '\n\nconst toStepYaml'),
  'const raw = snapshotWalker();',
  'const yaml = toAriaYaml(collapseWrappers(raw.nodes));',
  '({ raw, yaml });'
].join('\n\n'))
const blind = vm.runInNewContext(blindSource, {
  window: blindWindow,
  document: blindDocument,
  CSS: blindWindow.CSS,
  Element: FakeElement,
  HTMLInputElement: FakeElement,
  HTMLSelectElement: FakeElement,
  HTMLOptionElement: FakeElement,
  HTMLTextAreaElement: FakeElement,
  Array,
  String,
  JSON,
  Number,
  RegExp,
  Object
})

assert(blind.yaml.includes('B-ROW'), 'display:contents generates no box of its own, but its children render — they must stay in the tree')
assert(blind.yaml.includes('C-ROW'), 'an open shadow root is what actually renders under its host — its content must be walked')
assert(blind.yaml.includes('- iframe'), 'an iframe must appear even when unreadable, or the agent cannot know that region exists')
assert(blind.yaml.includes('cross-origin frame'), 'an unreadable frame must say so on the node instead of vanishing')
assert(!blind.yaml.includes('G-SECRET'), 'aria-hidden content must still be dropped — this gate is not what broke')
assert(blind.raw.missingLines === 2, `self-check should report exactly the two unreachable lines, got ${blind.raw.missingLines}`)
assert(blind.raw.missingSample.includes('MISSING-LINE'), 'self-check should name the visible text the tree never reached')
assert(!blind.raw.missingSample.includes('G-SECRET'), 'aria-hidden text must not be reported as a gap — a warning that always fires is ignored')
assert(
  !blind.raw.missingSample.some((line) => line.toLowerCase() === 'demo center'),
  'text differing from the tree only by CSS text-transform is NOT a gap — reporting it turns the one blind-spot alarm into noise'
)
// The sample is what the agent is told to go look for on the page. Normalising for the
// comparison is fine; leaking that normalisation into the message is not.
for (const line of blind.raw.missingSample) {
  assert(
    blindBody.innerText.indexOf(line) >= 0,
    `missingSample must quote the rendered line verbatim, got ${JSON.stringify(line)}`
  )
}

// ---------------------------------------------------------------------------------------
// Glued inline text (docs/issues/page-snapshot-incomplete-false-positive-on-glued-inline-text.md).
// innerText puts NO separator between adjacent inline elements that have no whitespace between
// them in the DOM (typical JSX), while the capture joins its pieces with spaces — so lines whose
// every piece IS in the tree were reported as gaps. The direct-text pass reads the walk's stamps
// back and asks for computed visibility, so this page models both: [data-coach-ref] comes back in
// document order, and visibility inherits down the tree the way CSS does.
const inDocumentOrder = (el) => [el, ...el.children.flatMap((child) => inDocumentOrder(child))]

// Links with no whitespace between them: innerText renders ONE line, "HomeAboutPricing".
const gluedNav = new FakeElement('nav', {}, [
  new FakeElement('a', { href: '/' }, ['Home']),
  new FakeElement('a', { href: '/about' }, ['About']),
  new FakeElement('a', { href: '/pricing' }, ['Pricing'])
])
// The same with buttons: "SaveCancel".
const gluedButtons = new FakeElement('div', {}, [
  new FakeElement('button', {}, ['Save']),
  new FakeElement('button', {}, ['Cancel'])
])
// innerText drops visibility:hidden text AND that block's line breaks, gluing the buttons either
// side into one line — while the walk keeps the hidden link, so its text sits between them.
const hiddenMenu = new FakeElement('ul', {}, [
  new FakeElement('li', {}, [new FakeElement('a', { href: '/logout' }, ['Hidden menu: Log out'])])
])
hiddenMenu.__visibility = 'hidden'
const underModal = new FakeElement('div', {}, [
  new FakeElement('button', {}, ['Under modal button']),
  hiddenMenu,
  new FakeElement('button', {}, ['Invisible button'])
])
// A filled search box: innerText renders "SearchGo" (never the value), while the label reaches the
// tree only as the textbox's name — so its value, right after that name, used to split the line.
const searchLabel = new FakeElement('label', { for: 'q' }, ['Search'])
const searchRow = new FakeElement('div', {}, [
  searchLabel,
  new FakeElement('input', { id: 'q', type: 'text', value: 'ct' }),
  new FakeElement('button', {}, ['Go'])
])
// A REAL gap glued to text the tree does have: "UNREACHED-7" is nowhere in the tree, so dropping
// whitespace must not let the covered half ("Home") carry the whole line.
const gapRow = new FakeElement('div', {}, [new FakeElement('a', { href: '/home' }, ['Home'])])
// aria-hidden text still renders, so innerText has it while the tree (correctly) does not; the
// exclusion must compare with whitespace dropped too, or every multi-word hidden line is a gap.
const hiddenApp = new FakeElement('div', { 'aria-hidden': 'true' }, [new FakeElement('p', {}, ['Order 1042 shipped'])])

const gluedBody = new FakeElement('body', {}, [gluedNav, gluedButtons, underModal, searchRow, gapRow, hiddenApp])
gluedBody.innerText = 'HomeAboutPricing\nSaveCancel\nUnder modal buttonInvisible button\nSearchGo\nHomeUNREACHED-7\nOrder 1042 shipped'

const gluedDocument = {
  title: 'Glued Inline Text',
  body: gluedBody,
  documentElement: gluedBody,
  getElementById: () => null,
  querySelector: (selector) => (selector === 'label[for="q"]' ? searchLabel : null),
  querySelectorAll: (selector) => {
    const all = inDocumentOrder(gluedBody)
    if (selector === '[data-coach-ref]') return all.filter((el) => el.hasAttribute('data-coach-ref'))
    if (selector === '[aria-hidden="true"],[hidden]') {
      return all.filter((el) => el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('hidden'))
    }
    return []
  }
}
const gluedWindow = {
  CSS: { escape: (value) => String(value) },
  getComputedStyle: (el) => {
    let from = el
    while (from && !from.__visibility) from = from.parentElement
    return { display: el.__display || 'block', visibility: from ? from.__visibility : 'visible' }
  }
}
const glued = vm.runInNewContext(source, {
  window: gluedWindow,
  document: gluedDocument,
  CSS: gluedWindow.CSS,
  Element: FakeElement,
  HTMLInputElement: FakeElement,
  HTMLSelectElement: FakeElement,
  HTMLOptionElement: FakeElement,
  HTMLTextAreaElement: FakeElement,
  Array,
  String,
  JSON,
  Number,
  RegExp,
  Object
})

// Precondition for the visibility:hidden case: the walk does not read visibility, so the hidden
// link IS in the tree. If that ever changes, that case stops testing anything — rework it then.
assert(
  glued.yaml.includes('Hidden menu: Log out'),
  'glued page: the visibility:hidden link should still be in the tree — the visibility case below depends on it'
)
// Same for the search box: named by its label AND carrying its value, or the SearchGo case proves nothing.
assert(
  glued.yaml.includes('- textbox "Search" [value="ct"]'),
  'glued page: the search box should be in the tree, named by its label and carrying its value — the SearchGo case below depends on it'
)
// The reverse for the aria-hidden paragraph: the walk must prune it, or the exclusion case proves nothing.
assert(
  !glued.yaml.includes('Order 1042 shipped'),
  'glued page: the aria-hidden paragraph must NOT be in the tree — the exclusion case below depends on it'
)
assert(
  !glued.raw.missingSample.includes('HomeAboutPricing'),
  'links with no whitespace between them render as ONE innerText line; every piece is in the tree, so it is NOT a gap'
)
assert(
  !glued.raw.missingSample.includes('SaveCancel'),
  'buttons with no whitespace between them render as ONE innerText line; both are in the tree, so it is NOT a gap'
)
assert(
  !glued.raw.missingSample.includes('Under modal buttonInvisible button'),
  'innerText skips visibility:hidden text and glues its neighbours; the direct-text pass must skip it too, or the kept hidden text splits the line'
)
assert(
  !glued.raw.missingSample.includes('SearchGo'),
  'innerText never renders form-control values; a value placed right after its label-derived name splits "SearchGo" — values must not sit between names'
)
assert(
  !glued.raw.missingSample.includes('Order 1042 shipped'),
  'aria-hidden text is excluded from the gaps even when it spans several words — the exclusion must drop whitespace like the line key does'
)
assert(
  glued.raw.missingSample.includes('HomeUNREACHED-7'),
  'a line only PARTLY in the tree is still a gap — dropping whitespace must not let "Home" cover "HomeUNREACHED-7"'
)
assert(
  glued.raw.missingLines === 1,
  `glued page should report exactly the one real gap, got ${glued.raw.missingLines}: ${JSON.stringify(glued.raw.missingSample)}`
)

console.log('[check-snapshot-selects] ok')

