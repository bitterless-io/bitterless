import { createInterface } from 'readline/promises'
import { stdin, stdout } from 'process'
import { CliError } from './errors'

export const isInteractiveTerminal = (): boolean => Boolean(stdin.isTTY && stdout.isTTY)

export const promptLine = async (label: string): Promise<string> => {
  if (!isInteractiveTerminal()) throw new CliError(`${label.trim()} is required in non-interactive mode`)
  const terminal = createInterface({ input: stdin, output: stdout })
  try {
    return (await terminal.question(label)).trim()
  } finally {
    terminal.close()
  }
}

export const promptHidden = async (label: string): Promise<string> => {
  if (!isInteractiveTerminal() || typeof stdin.setRawMode !== 'function') {
    throw new CliError('Password is required in non-interactive mode; pass --password or set a realm password environment variable')
  }

  return await new Promise<string>((resolve, reject) => {
    let value = ''
    const finish = (err?: Error): void => {
      stdin.removeListener('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\n')
      if (err) reject(err)
      else resolve(value)
    }
    const onData = (chunk: Buffer | string): void => {
      for (const char of String(chunk)) {
        if (char === '\r' || char === '\n') {
          finish()
          return
        }
        if (char === '\u0003') {
          finish(new CliError('Login cancelled', { exitCode: 130 }))
          return
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1)
          continue
        }
        if (char >= ' ') value += char
      }
    }

    stdout.write(label)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    stdin.on('data', onData)
  })
}
