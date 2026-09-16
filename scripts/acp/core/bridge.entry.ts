import { runAcpMcpBridge } from '../../../src/main/acp/helpers/acpMcpBridge';
import { runAcpStdioBridge } from '../../../src/main/acp/helpers/acpStdioBridge';

const run = process.argv[2] === 'mcp' ? runAcpMcpBridge : runAcpStdioBridge;
void run({ args: process.argv.slice(3) }).catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
