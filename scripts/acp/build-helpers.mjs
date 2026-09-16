import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'

await mkdir('build/acp', { recursive: true })
for (const name of ['acpStdio', 'acpMcp']) {
  await build({
    entryPoints: [`src/main/acp/${name}.main.ts`],
    outfile: `build/acp/${name}.cjs`,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    logLevel: 'warning'
  })
}
