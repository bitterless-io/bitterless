import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const source = ts.createSourceFile(
  'electron.vite.config.ts',
  read('electron.vite.config.ts'),
  ts.ScriptTarget.Latest,
  true
);
const pluginName = 'maestroOverlayDevCspPlugin';
const declaration = source.statements
  .filter(ts.isVariableStatement)
  .flatMap((statement) => [...statement.declarationList.declarations])
  .find((item) => item.name.getText(source) === pluginName);
assert.ok(declaration, 'the Maestro overlay CSP plugin must exist');
const compiled = ts.transpileModule(`const plugin = ${declaration.initializer.getText(source)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const plugin = new Function(`${compiled}\nreturn plugin;`)();

const property = (object, name) => object.properties.find((item) => item.name?.getText(source) === name);

test('Maestro overlay CSP adjustment is registered only for the Vite development server', () => {
  assert.equal(plugin.apply, 'serve');
  const exported = source.statements.find(ts.isExportAssignment).expression;
  const renderer = property(exported.arguments[0], 'renderer').initializer;
  const plugins = property(renderer, 'plugins').initializer.elements;
  assert.ok(plugins.some((item) => item.getText(source) === pluginName));
});

for (const page of ['tabAlias', 'history']) {
  test(`${page} permits localhost hot reload while its packaged HTML stays restrictive`, () => {
    const html = read(`src/renderer/maestro/${page}/index.html`);
    assert.match(html, /connect-src 'none'/);
    assert.doesNotMatch(html, /wss?:\/\/localhost/);
    const transformed = plugin.transformIndexHtml(html, { path: `/maestro/${page}/index.html` });
    const connectSources = transformed.match(/connect-src ([^;"]+)/)?.[1].split(/\s+/);
    assert.deepEqual(connectSources, ["'self'", 'ws://localhost:*', 'wss://localhost:*']);
    assert.equal(
      transformed.replace("connect-src 'self' ws://localhost:* wss://localhost:*", "connect-src 'none'"),
      html,
      'the transform must leave every other CSP directive and page resource unchanged'
    );
  });
}

test('Maestro overlay transform leaves unrelated and privileged renderer policies unchanged', () => {
  for (const page of ['onlypreview/alert', 'maestro/sqlite', 'fileSearch', 'trench-io']) {
    const html = read(`src/renderer/${page}/index.html`);
    assert.equal(plugin.transformIndexHtml(html, { path: `/${page}/index.html` }), html);
  }
});
