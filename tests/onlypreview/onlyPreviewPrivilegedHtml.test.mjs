import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { transformPrivilegedRendererHtml } from '../../src/shared/security/blankPrivilegedRendererHtml.service.ts';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('privileged blank renderer transform removes Vite and Monaco scripts without weakening CSP', () => {
  const source = readFileSync(join(projectRoot, 'src/renderer/fileSearch/index.html'), 'utf8');
  const injected =
    source.replace(
      '<meta charset="UTF-8" />',
      `<script>self.MonacoEnvironment = {};</script>
       <script type="module" src="/@vite/client"></script>
       <meta charset="UTF-8" />`
    );
  const transformed = transformPrivilegedRendererHtml(injected, '/fileSearch/index.html');

  assert.match(transformed, /default-src 'none'/);
  assert.match(transformed, /<body>\s*<\/body>/);
  assert.doesNotMatch(transformed, /<script\b|\/@vite\/client|MonacoEnvironment/);
  assert.doesNotMatch(
    transformPrivilegedRendererHtml(injected, '/trench-io/index.html'),
    /<script\b/
  );
  assert.equal(transformPrivilegedRendererHtml(injected, '/onlypreview/shell/index.html'), injected);
});

test('Electron Vite runs the privileged transform post-injection and audits only builds', () => {
  const vite = readFileSync(join(projectRoot, 'electron.vite.config.ts'), 'utf8');

  assert.match(vite, /privilegedRuntimeBlankHtmlPlugin[\s\S]*order: 'post'/);
  assert.match(vite, /transformPrivilegedRendererHtml\(html, context\.path\)/);
  assert.match(
    vite,
    /privilegedRuntimeBlankHtmlAuditPlugin[\s\S]*apply: 'build' as const/
  );
  assert.match(vite, /\['trench-io', 'fileSearch'\]/);
});
