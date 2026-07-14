export class CliError extends Error {
  exitCode: number
  code?: string | number

  constructor(message: string, params: { exitCode?: number; code?: string | number } = {}) {
    super(message)
    this.name = 'CliError'
    this.exitCode = params.exitCode ?? 1
    this.code = params.code
  }
}
