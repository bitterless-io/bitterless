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
    .replace(/const snapshotWalker = \(\): \{ title: string; count: number; truncated: boolean; nodes: AriaNode\[] \} =>/, 'const snapshotWalker = () =>')
    .replace(/const clean = \(v: unknown, max = 200\): string =>/g, 'const clean = (v, max = 200) =>')
    .replace(/const css = \(v: unknown\): string =>/g, 'const css = (v) =>')
    .replace(/const directText = \(el: Element\): string =>/g, 'const directText = (el) =>')
    .replace(/const roleOf = \(el: Element\): string \| undefined =>/g, 'const roleOf = (el) =>')
    .replace(/const idText = \(ids: string\): string =>/g, 'const idText = (ids) =>')
    .replace(/const nameOf = \(el: Element, role: string\): string =>/g, 'const nameOf = (el, role) =>')
    .replace(/const isHidden = \(el: Element\): boolean =>/g, 'const isHidden = (el) =>')
    .replace(/const isMeaningful = \(el: Element\): boolean =>/g, 'const isMeaningful = (el) =>')
    .replace(/const stamp = \(el: Element\): string =>/g, 'const stamp = (el) =>')
    .replace(/const identOf = \(el: Element\): \{ kind: 'testid' \| 'id'; value: string \} \| null =>/g, 'const identOf = (el) =>')
    .replace(/const describe = \(el: Element\): AriaNode =>/g, 'const describe = (el) =>')
    .replace(/const node: AriaNode =/g, 'const node =')
    .replace(/const selectOptions = \(el: HTMLSelectElement\): AriaNode\[] =>/g, 'const selectOptions = (el) =>')
    .replace(/const walk = \(el: Element, depth: number\): AriaNode\[] =>/g, 'const walk = (el, depth) =>')
    .replace(/selectOptions\(el as HTMLSelectElement\)/g, 'selectOptions(el)')
    .replace(/\(el as HTMLInputElement\)/g, 'el')
    .replace(/\(el as HTMLSelectElement\)/g, 'el')
    .replace(/\(el as HTMLOptionElement\)/g, 'el')
    .replace(/const collapseWrappers = \(nodes: AriaNode\[]\): AriaNode\[] =>/g, 'const collapseWrappers = (nodes) =>')
    .replace(/const toAriaYaml = \(nodes: AriaNode\[], indent = ''\): string =>/g, "const toAriaYaml = (nodes, indent = '') =>")
    .replace(/const lines: string\[] = \[]/g, 'const lines = []')
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
const source = stripTs([
  extractConstFunction(debuggerCapture, 'snapshotWalker', '\n\n// Render the aria tree'),
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

console.log('[check-snapshot-selects] ok')

