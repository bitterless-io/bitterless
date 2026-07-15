import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import ts from 'typescript'
import { assert, projectRoot } from './_harness.mjs'

const rendererRoot = join(projectRoot, 'src/renderer')
const sourceExtensions = new Set(['.vue', '.ts', '.css', '.less'])

const collectFiles = (directory) =>
  readdirSync(directory)
    .flatMap((name) => {
      const path = join(directory, name)
      return statSync(path).isDirectory() ? collectFiles(path) : [path]
    })
    .filter((path) => sourceExtensions.has(extname(path)))

const exactUtilities = new Set([
  'absolute',
  'antialiased',
  'block',
  'border',
  'capitalize',
  'container',
  'contents',
  'fixed',
  'flex',
  'grid',
  'grow',
  'hidden',
  'inline',
  'inline-block',
  'inline-flex',
  'inline-grid',
  'italic',
  'lowercase',
  'relative',
  'resize',
  'resize-none',
  'rounded',
  'shadow',
  'shrink',
  'sr-only',
  'static',
  'sticky',
  'transform',
  'transition',
  'truncate',
  'underline',
  'uppercase'
])

const utilityPrefixes = [
  'align-', 'animate-', 'aspect-', 'backdrop-', 'basis-', 'bg-', 'blur-', 'border-',
  'bottom-', 'break-', 'col-', 'content-', 'cursor-', 'decoration-', 'delay-', 'divide-',
  'drop-shadow-', 'duration-', 'ease-', 'fill-', 'flex-', 'font-', 'gap-', 'grid-', 'h-',
  'inset-', 'items-', 'justify-', 'leading-', 'left-', 'line-clamp-', 'm-', 'max-h-',
  'max-w-', 'mb-', 'min-h-', 'min-w-', 'ml-', 'mr-', 'mt-', 'mx-', 'my-', 'object-',
  'opacity-', 'order-', 'origin-', 'outline-', 'overflow-', 'overscroll-', 'p-', 'pb-',
  'place-', 'pl-', 'pointer-events-', 'pr-', 'pt-', 'px-', 'py-', 'resize-', 'right-',
  'ring-', 'rotate-', 'rounded-', 'row-', 'scale-', 'select-', 'self-', 'shadow-', 'skew-',
  'space-', 'stroke-', 'text-', 'top-', 'tracking-', 'transition-', 'translate-', 'underline-',
  'via-', 'whitespace-', 'w-', 'will-change-', 'z-'
]

const stripVariants = (token) => {
  const withoutImportant = token.replace(/^!/, '')
  const lastColon = withoutImportant.lastIndexOf(':')
  return lastColon >= 0 ? withoutImportant.slice(lastColon + 1) : withoutImportant
}

const isUtility = (token) => {
  const value = stripVariants(token.trim())
  if (!value || value.includes('__') || value.includes('--')) return false
  if (exactUtilities.has(value)) return true
  if (/^\[(?:--|[a-z-]+:).+\]$/.test(value)) return true
  return utilityPrefixes.some((prefix) => value.startsWith(prefix))
}

const lineNumber = (source, index) => source.slice(0, index).split('\n').length
const failures = []
const report = (path, source, index, message) => {
  failures.push(`${relative(projectRoot, path)}:${lineNumber(source, index)} ${message}`)
}

const classWords = (value) => value.match(/[!A-Za-z0-9_[\].:/%#()-]+/g) || []
const inspectClassValue = (path, source, value, index) => {
  for (const token of classWords(value)) {
    if (isUtility(token)) report(path, source, index, `Tailwind utility class: ${token}`)
    if ((token.match(/__/g) || []).length > 2) {
      report(path, source, index, `BEM class exceeds two __ separators: ${token}`)
    }
  }
}

const classProducerNames = (value) => {
  const wrapped = `const __classValue = (${value})`
  const sourceFile = ts.createSourceFile('class-binding.ts', wrapped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = sourceFile.statements[0]?.declarationList?.declarations?.[0]
  const names = new Set()

  const visit = (node) => {
    if (!node) return
    if (ts.isIdentifier(node)) {
      names.add(node.text)
      return
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) names.add(node.expression.text)
      return
    }
    if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach(visit)
      return
    }
    if (ts.isObjectLiteralExpression(node)) return
    if (ts.isConditionalExpression(node)) {
      visit(node.whenTrue)
      visit(node.whenFalse)
      return
    }
    if (ts.isParenthesizedExpression(node)) {
      visit(node.expression)
      return
    }
    if (ts.isBinaryExpression(node)) {
      visit(node.right)
    }
  }

  visit(declaration?.initializer)
  return names
}

const inspectScriptClassProducers = (path, source, script, producerNames) => {
  if (!producerNames.size) return
  const sourceFile = ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations = new Map()

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          declarations.set(declaration.name.text, declaration.initializer)
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, statement)
    }
  }

  const scriptOffset = source.indexOf(script)
  const visited = new Set()
  const inspectDeclaration = (name) => {
    if (visited.has(name)) return
    visited.add(name)
    const declaration = declarations.get(name)
    if (!declaration) return

    const visit = (node) => {
      if (ts.isStringLiteralLike(node)) {
        inspectClassValue(path, source, node.text, scriptOffset + node.getStart(sourceFile))
      } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        inspectClassValue(path, source, node.text, scriptOffset + node.getStart(sourceFile))
      } else if (ts.isIdentifier(node) && declarations.has(node.text)) {
        inspectDeclaration(node.text)
      }
      ts.forEachChild(node, visit)
    }

    visit(declaration)
  }

  producerNames.forEach(inspectDeclaration)
}

const inspectVue = (path, source) => {
  const template = (source.match(/<template>([\s\S]*)<\/template>/)?.[1] || '').replace(/<!--[\s\S]*?-->/g, '')
  const classAttribute = /(?:^|\s)(:class|class)\s*=\s*(["'])([\s\S]*?)\2/g
  const producerNames = new Set()
  for (const match of template.matchAll(classAttribute)) {
    const value = match[3]
    if (match[1] === 'class') inspectClassValue(path, source, value, match.index)
    for (const literal of value.matchAll(/(["'`])([\s\S]*?)\1/g)) {
      inspectClassValue(path, source, literal[2], match.index + literal.index)
    }
    if (match[1] === ':class') {
      classProducerNames(value).forEach((name) => producerNames.add(name))
    }
  }

  const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] || ''
  inspectScriptClassProducers(path, source, script, producerNames)

  if (path.includes('/src/renderer/maestro/') && /\sstyle\s*=\s*["']/.test(template)) {
    report(path, source, source.indexOf(template) + template.search(/\sstyle\s*=/), 'static style attribute must move to sibling Less')
  }
}

const inspectTypeScript = (path, source) => {
  if (!path.endsWith('/src/renderer/maestro/control/src/record/record.format.ts')) return
  for (const literal of source.matchAll(/(["'`])([^\n]*?)\1/g)) {
    inspectClassValue(path, source, literal[2], literal.index)
  }
}

const inspectStyle = (path, source) => {
  for (const selector of source.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
    const className = selector[1]
    if (path.includes('/src/renderer/maestro/') && isUtility(className)) {
      report(path, source, selector.index, `Tailwind utility selector: .${className}`)
    }
    if ((className.match(/__/g) || []).length > 2) {
      report(path, source, selector.index, `BEM selector exceeds two __ separators: .${className}`)
    }
  }
}

const forbiddenSyntax = /(?:@import\s+["']tailwindcss|@reference\s+["']tailwindcss|@apply\b|@tailwind\b|@tailwindcss\/vite|["']tailwindcss["']|\btailwindcss\s*\()/
const files = [
  ...collectFiles(rendererRoot),
  join(projectRoot, 'electron.vite.config.ts')
]

for (const path of files) {
  const source = readFileSync(path, 'utf8')
  const forbidden = source.search(forbiddenSyntax)
  if (forbidden >= 0) report(path, source, forbidden, 'forbidden Tailwind import, directive, plugin, or package')

  if (path.endsWith('.vue')) inspectVue(path, source)
  else if (path.endsWith('.ts')) inspectTypeScript(path, source)
  else if (path.endsWith('.css') || path.endsWith('.less')) inspectStyle(path, source)
}

const packageJsonPath = join(projectRoot, 'package.json')
const packageJsonSource = readFileSync(packageJsonPath, 'utf8')
const packageJson = JSON.parse(packageJsonSource)
const expectedDevDependencies = {
  '@tailwindcss/vite': '^4.3.0',
  tailwindcss: '^4.3.0'
}

for (const [name, version] of Object.entries(expectedDevDependencies)) {
  if (packageJson.devDependencies?.[name] !== version) {
    report(
      packageJsonPath,
      packageJsonSource,
      Math.max(packageJsonSource.indexOf('"devDependencies"'), 0),
      `dormant dependency must be declared in devDependencies: ${name}@${version}`
    )
  }
  if (packageJson.dependencies?.[name]) {
    report(
      packageJsonPath,
      packageJsonSource,
      Math.max(packageJsonSource.indexOf(`"${name}"`), 0),
      `dormant dependency must not be declared in dependencies: ${name}`
    )
  }
}

const yarnLockPath = join(projectRoot, 'yarn.lock')
const yarnLockSource = readFileSync(yarnLockPath, 'utf8')
const expectedLockEntries = [
  [/@tailwindcss\/vite@\^4\.3\.0":\n  version "4\.3\.\d+"/, '@tailwindcss/vite@^4.3.0'],
  [/^tailwindcss@[^\n]*tailwindcss@\^4\.3\.0:\n  version "4\.3\.\d+"/m, 'tailwindcss@^4.3.0']
]

for (const [pattern, entry] of expectedLockEntries) {
  if (!pattern.test(yarnLockSource)) {
    report(yarnLockPath, yarnLockSource, 0, `missing dormant dependency lock entry: ${entry}`)
  }
}

assert(failures.length === 0, `renderer Tailwind/BEM source guard failed:\n${failures.join('\n')}`)
console.log('[check-no-tailwind] ok')
