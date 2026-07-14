import { CliError } from './errors'
import type { ParsedArgv } from './types'

const booleanShortOptions: Record<string, string> = {
  h: 'help',
  j: 'json',
  i: 'include',
  I: 'head',
  G: 'get'
}

const valueShortOptions: Record<string, string> = {
  X: 'request',
  H: 'header',
  d: 'data',
  o: 'output'
}

const booleanLongOptions = new Set([
  'auth',
  'check',
  'debug',
  'fail',
  'get',
  'head',
  'help',
  'include',
  'json',
  'no-auth',
  'plain',
  'raw',
  'silent',
  'version'
])

const appendOption = (
  options: ParsedArgv['options'],
  key: string,
  value: string | boolean,
  params: { append?: boolean } = {}
): void => {
  if (!params.append) {
    options[key] = value
    return
  }
  const existing = options[key]
  if (existing === undefined) {
    options[key] = typeof value === 'string' ? [value] : value
    return
  }
  if (Array.isArray(existing)) {
    if (typeof value === 'string') existing.push(value)
    else options[key] = value
    return
  }
  if (typeof existing === 'string' && typeof value === 'string') {
    options[key] = [existing, value]
    return
  }
  options[key] = value
}

const readOptionValue = (argv: string[], index: number, option: string): { value: string; nextIndex: number } => {
  const next = argv[index + 1]
  if (next === undefined) throw new CliError(`Option ${option} requires a value`)
  return { value: next, nextIndex: index + 1 }
}

export const parseArgv = (argv: string[]): ParsedArgv => {
  const positionals: string[] = []
  const options: ParsedArgv['options'] = {}

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) {
      const raw = arg.slice(2)
      if (!raw) throw new CliError('Invalid empty option')
      const eq = raw.indexOf('=')
      if (eq >= 0) {
        const key = raw.slice(0, eq)
        const value = raw.slice(eq + 1)
        appendOption(options, key, value, { append: true })
        continue
      }
      const next = argv[i + 1]
      if (booleanLongOptions.has(raw)) {
        appendOption(options, raw, true)
      } else if (next && !next.startsWith('-')) {
        appendOption(options, raw, next, { append: true })
        i += 1
      } else {
        appendOption(options, raw, true)
      }
      continue
    }
    if (arg.startsWith('-') && arg.length >= 2) {
      const flag = arg.slice(1, 2)
      const attached = arg.slice(2)
      const valueKey = valueShortOptions[flag]
      if (valueKey) {
        if (attached) appendOption(options, valueKey, attached, { append: true })
        else {
          const { value, nextIndex } = readOptionValue(argv, i, arg)
          appendOption(options, valueKey, value, { append: true })
          i = nextIndex
        }
        continue
      }
      const booleanKey = booleanShortOptions[flag]
      if (!booleanKey || attached) throw new CliError(`Unknown short option: ${arg}`)
      appendOption(options, booleanKey, true)
      continue
    }
    positionals.push(arg)
  }

  return { positionals, options }
}

export const optionString = (argv: ParsedArgv, key: string): string | undefined => {
  const value = argv.options[key]
  if (Array.isArray(value)) return value[value.length - 1]
  if (typeof value === 'boolean') return value ? '' : undefined
  return value
}

export const optionBoolean = (argv: ParsedArgv, key: string): boolean => argv.options[key] === true

export const optionValues = (argv: ParsedArgv, key: string): string[] => {
  const value = argv.options[key]
  if (value === undefined) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'boolean') return value ? [''] : []
  return [value]
}

export const optionNumber = (
  argv: ParsedArgv,
  key: string,
  defaultValue: number,
  params: { min?: number } = {}
): number => {
  const raw = optionString(argv, key)
  if (raw === undefined) return defaultValue
  const value = Number(raw)
  if (!Number.isInteger(value)) throw new CliError(`--${key} must be an integer`)
  if (params.min !== undefined && value < params.min) {
    throw new CliError(`--${key} must be >= ${params.min}`)
  }
  return value
}
