import readline from 'node:readline';

const mode = process.argv[2] || 'normal';

if (mode === 'timeout') {
  setInterval(() => {}, 1000);
} else if (mode === 'output') {
  process.stdout.write('x'.repeat(8192));
  setInterval(() => {}, 1000);
} else {
  const lines = readline.createInterface({ input: process.stdin });
  let page = 0;
  lines.on('line', (line) => {
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      process.stdout.write(
        `${JSON.stringify({ id: message.id, result: { userAgent: 'fixture' } })}\n`
      );
      return;
    }
    if (message.method === 'thread/list') {
      if (message.params?.useStateDbOnly !== true || message.params?.limit !== 100) {
        process.stdout.write(
          `${JSON.stringify({ id: message.id, error: { message: 'not read only' } })}\n`
        );
        return;
      }
      page += 1;
      const id =
        page === 1
          ? '11111111-1111-4111-8111-111111111111'
          : '22222222-2222-4222-8222-222222222222';
      process.stdout.write(
        `${JSON.stringify({
          id: message.id,
          result: {
            data: [{ id }],
            nextCursor: page === 1 ? 'page-2' : null,
            backwardsCursor: null
          }
        })}\n`
      );
    }
  });
}
