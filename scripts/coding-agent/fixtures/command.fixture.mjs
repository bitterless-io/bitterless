const mode = process.argv[2];

if (mode === 'sleep') {
  setInterval(() => {}, 1000);
} else if (mode === 'output') {
  process.stdout.write('x'.repeat(8192));
} else if (mode === 'failure') {
  process.stderr.write('fixture failure');
  process.exitCode = 7;
} else {
  process.stdout.write('ok');
}
