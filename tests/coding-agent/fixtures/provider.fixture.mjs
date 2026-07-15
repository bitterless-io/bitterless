/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { readFileSync } from 'node:fs';

const statePath = process.env.BITTERLESS_E2E_PROVIDER_STATE;
if (!statePath) {
  process.stderr.write('BITTERLESS_E2E_PROVIDER_STATE is required\n');
  process.exit(64);
}

const readState = () => JSON.parse(readFileSync(statePath, 'utf8'));
const provider = process.argv[2];
const args = process.argv.slice(3);

const fail = (message, code = 1) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

const runClaude = () => {
  const state = readState().claude ?? {};
  const mode = state.mode ?? 'success';
  if (mode === 'failed') fail(state.error ?? 'fixture Claude command failed', 2);

  if (args[0] === 'agents' && args[1] === '--help') {
    if (mode === 'unsupported') {
      process.stdout.write('Usage: claude agents\n');
      return;
    }
    process.stdout.write(
      `Usage: claude agents --json${state.advertiseAll === false ? '' : ' --all'}\n`
    );
    return;
  }

  if (args[0] === 'agents' && args[1] === '--json') {
    if (mode === 'invalid-json') {
      process.stdout.write('{not-json');
      return;
    }
    process.stdout.write(`${JSON.stringify(state.entries ?? [])}\n`);
    return;
  }

  fail(`Unexpected Claude fixture invocation: ${JSON.stringify(args)}`, 65);
};

const runCodex = () => {
  const initialState = readState().codex ?? {};
  if ((initialState.mode ?? 'success') === 'failed') {
    fail(initialState.error ?? 'fixture Codex App Server failed', 2);
  }

  let input = '';
  const handleLine = (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      process.stdout.write(
        `${JSON.stringify({ id: message.id, result: { userAgent: 'bitterless-e2e' } })}\n`
      );
      return;
    }
    if (message.method === 'initialized') return;
    if (message.method === 'thread/list') {
      const state = readState().codex ?? {};
      if (state.mode === 'invalid-json') {
        process.stdout.write('{not-json\n');
        return;
      }
      process.stdout.write(
        `${JSON.stringify({
          id: message.id,
          result: {
            data: state.entries ?? [],
            nextCursor: null
          }
        })}\n`
      );
      return;
    }
    fail(`Unexpected Codex fixture request: ${JSON.stringify(message)}`, 65);
  };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    input += chunk;
    let newline = input.indexOf('\n');
    while (newline >= 0) {
      const line = input.slice(0, newline);
      input = input.slice(newline + 1);
      handleLine(line);
      newline = input.indexOf('\n');
    }
  });
};

if (provider === 'claude') runClaude();
else if (provider === 'codex' && args[0] === 'app-server') runCodex();
else fail(`Unexpected provider fixture invocation: ${provider} ${JSON.stringify(args)}`, 65);
