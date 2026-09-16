import { runAcpMcpBridge } from './helpers/acpMcpBridge'

void runAcpMcpBridge({}).catch((error: unknown) => {
  process.stderr.write(`[bitterless-acp-mcp] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
