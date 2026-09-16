import { runAcpStdioBridge } from './helpers/acpStdioBridge'

void runAcpStdioBridge({}).catch((error: unknown) => {
  process.stderr.write(`[bitterless-acp] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
