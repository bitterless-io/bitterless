#!/usr/bin/env node
import { parseArgv, optionBoolean } from './args'
import { resolveCommandRealm, resolveConfig } from './config'
import { CliError } from './errors'
import { helpForCommand } from './manual'
import { runCommand } from './commands'

const VERSION = '0.0.2'

const requestedHelpPath = (positionals: string[], helpOption: boolean): string[] | undefined => {
  if (positionals[0] === 'help') return positionals.slice(1)
  if (positionals[positionals.length - 1] === 'help') return positionals.slice(0, -1)
  if (helpOption) return positionals
  return undefined
}

const main = async (): Promise<void> => {
  const argv = parseArgv(process.argv.slice(2))
  if (optionBoolean(argv, 'version')) {
    console.log(VERSION)
    return
  }
  const helpPath = requestedHelpPath(argv.positionals, optionBoolean(argv, 'help'))
  if (helpPath) {
    const help = helpForCommand(helpPath)
    if (!help) {
      const topic = helpPath.join(' ')
      throw new CliError(`Unknown help topic: ${topic}. Run micromeet modules to list command paths.`)
    }
    console.log(help)
    return
  }
  const config = resolveConfig(argv, resolveCommandRealm(argv))
  await runCommand({ config, argv })
}

main().catch((err: unknown) => {
  const debug = process.argv.includes('--debug')
  if (err instanceof CliError) {
    console.error(`micromeet: ${err.message}`)
    if (err.code !== undefined) console.error(`code: ${String(err.code)}`)
    process.exitCode = err.exitCode
    return
  }
  console.error(`micromeet: ${(err as Error)?.message || String(err)}`)
  if (debug) console.error((err as Error)?.stack || err)
  process.exitCode = 1
})
