import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const readProject = (path) => readFileSync(join(projectRoot, path), 'utf8')
const handlerPath = 'src/main/xpc/todoWindow.handler.ts'
const handlerSource = readProject(handlerPath)
const handlerFile = ts.createSourceFile(
  handlerPath,
  handlerSource,
  ts.ScriptTarget.ESNext,
  true,
  ts.ScriptKind.TS
)

const normalizeExpression = (node) => node.getText(handlerFile).replace(/\s+/g, '')
const preloadExpression = "resolveTodoOutPath('preload','todo.js')"
const rendererExpression = "resolveTodoOutPath('renderer','todo','index.html')"
const preloadInitializers = []
const productionRendererArguments = []
let resolverInitializer = null
let hasChunkRelativeDirname = false

const visit = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(handlerFile) === 'resolveTodoOutPath') {
    resolverInitializer = node.initializer
  }

  if (ts.isPropertyAssignment(node) && node.name.getText(handlerFile) === 'preload') {
    preloadInitializers.push(normalizeExpression(node.initializer))
  }

  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'loadFile'
  ) {
    assert.equal(node.arguments.length, 1, 'Todo production renderer loadFile must take one generated asset path')
    productionRendererArguments.push(normalizeExpression(node.arguments[0]))
  }

  if (ts.isIdentifier(node) && node.text === '__dirname') hasChunkRelativeDirname = true
  ts.forEachChild(node, visit)
}

visit(handlerFile)

assert(resolverInitializer, 'Todo generated assets must use one explicit resolveTodoOutPath resolver')
assert.equal(
  normalizeExpression(resolverInitializer),
  "(...segments:string[]):string=>join(app.getAppPath(),'out',...segments)",
  'Todo generated asset resolver must anchor every path at app.getAppPath()/out'
)
assert.deepEqual(
  preloadInitializers,
  [preloadExpression, preloadExpression],
  'embedded and standalone Todo must both load out/preload/todo.js through the app-root resolver'
)
assert.deepEqual(
  productionRendererArguments,
  [rendererExpression, rendererExpression],
  'embedded and standalone production Todo must both load out/renderer/todo/index.html through the app-root resolver'
)
assert.equal(hasChunkRelativeDirname, false, 'Todo runtime paths must never depend on the handler chunk __dirname')

const viteConfig = readProject('electron.vite.config.ts')
assert(
  viteConfig.includes("todo: resolve('src/preload/todo/todo.preload.ts')"),
  'electron-vite must generate out/preload/todo.js'
)
assert(
  viteConfig.includes("todo: resolve('src/renderer/todo/index.html')"),
  'electron-vite must generate out/renderer/todo/index.html'
)

console.log('[check-todo-window-runtime] ok')
