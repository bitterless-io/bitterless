import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const load = (path, dependencies) => {
  const result = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), {
    fileName: path, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  });
  assert.equal(result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputText)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected import: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
};

// Real fetch/extraction/formatting modules; only the HTTP transport and host are stubbed.
let response, requests;
const logs = [];
const logging = { moduleLog: () => ({ info() {}, warn: (...args) => logs.push(args) }) };
const policy = load('src/main/net/fetchPolicy.ts', {});
const extraction = load('src/main/net/articleExtract.ts', {
  '@mozilla/readability': require('@mozilla/readability'), linkedom: require('linkedom')
});
const { extractArticle, ExtractError, MAX_HTML_BYTES } = extraction;
const webFetch = load('src/main/net/webFetch.ts', {
  undici: { fetch: async () => { requests++; return response; } },
  '@main/logging/moduleLog': logging,
  '@main/net/fetchPolicy': policy,
  '@main/net/articleExtract': extraction
});
const { fetchWebPage, WebFetchError } = webFetch;
const skill = load('src/main/agent/deepFetch.skill.ts', {});
const { buildWebFetchTools } = load('src/main/agent/tools/webFetchTools.ts', {
  '@main/agent/deepFetch.skill': skill,
  '@main/logging/moduleLog': logging,
  '@main/net/fetchPolicy': policy,
  '@main/net/articleExtract': extraction,
  '@main/net/webFetch': webFetch,
  '@main/net/deepFetch': {
    DeepFetchError: class extends Error {},
    deepFetchPage: async () => { throw new Error('unexpected browser fallback'); }
  },
  '@main/agent/tools/webFetchFormat': load('src/main/agent/tools/webFetchFormat.ts', {})
});
const tool = buildWebFetchTools().find(({ name }) => name === 'web_fetch');
const url = 'https://fixture.example/data';
const json = ' \r\n{\r\n  "count": 900719925474099312345, "rate": 0.1234567890123456789\r\n}\r\n ';
const fixture = (contentType, body, extraHeaders = {}) => {
  requests = 0;
  logs.length = 0;
  response = {
    status: 200,
    headers: new Headers({ 'content-type': contentType, ...extraHeaders }),
    body: [Buffer.from(body)]
  };
};

test('JSON and structured +json MIME types return the exact source and metadata', async () => {
  for (const contentType of [
    'application/json',
    'Application/JSON; Charset=UTF-8',
    'application/problem+json',
    'APPLICATION/LD+JSON ; charset=utf-8',
    'application/vnd.fixture.sheet+json'
  ]) {
    fixture(contentType, json);
    const result = await fetchWebPage(url, 5000);
    assert.equal(result.article.text, json, contentType);
    assert.equal(result.article.fullLength, json.length);
    assert.equal(result.article.truncated, false);
    assert.equal(result.article.fallback, false);
    assert.equal(result.servedAsText, true);
    assert.equal(result.requestedUrl, url);
    assert.equal(result.finalUrl, url);
    assert.equal(result.contentType, contentType.toLowerCase());
    assert.equal(result.bytes, Buffer.byteLength(json));
    assert.equal(result.redirects, 0);
    assert.equal(requests, 1);
  }
});

test('JSON bypasses the HTML parser and its smaller size limit, with bounded output', async () => {
  const body = `{"text":"${'x'.repeat(MAX_HTML_BYTES)}"}`;
  fixture('application/json', body);
  const result = await fetchWebPage(url, 500);
  assert.equal(result.article.text, body.slice(0, 500));
  assert.equal(result.article.fullLength, body.length);
  assert.equal(result.article.truncated, true);
});

test('registered web_fetch preserves JSON numeric literals and discloses clipping', async () => {
  fixture('application/json', json);
  const full = await tool.execute({ url });
  assert.doesNotMatch(full, /^ERROR:/);
  assert.match(full, /900719925474099312345/);
  assert.match(full, /0\.1234567890123456789/);
  assert.match(full, /served text directly \(no HTML extraction needed\)/);
  assert.ok(full.includes(`- url: ${url}`));
  assert.equal(requests, 1);

  const body = `{"id":900719925474099312345,"text":"${'x'.repeat(700)}"}`;
  fixture('application/json', body);
  const clipped = await tool.execute({ url, max_chars: 500 });
  assert.ok(clipped.includes(`> ${body.slice(0, 500)}\n`));
  assert.match(clipped, /\(TRUNCATED\)/);
  assert.ok(clipped.includes(`content truncated at 500 chars of ${body.length}`));
  assert.equal(requests, 1);
});

test('JSON keeps the existing declared and streamed download limits', async () => {
  fixture('application/json', '{}', { 'content-length': String(8 * 1024 * 1024 + 1) });
  await assert.rejects(fetchWebPage(url, 500), err => err instanceof WebFetchError && err.kind === 'too-large');
  fixture('application/json', 'x'.repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(fetchWebPage(url, 500), err => err instanceof WebFetchError && err.kind === 'too-large');
});

test('markdown and plain text retain their existing direct-text normalization', async () => {
  for (const contentType of ['text/plain; charset=utf-8', 'text/markdown', 'text/x-markdown']) {
    fixture(contentType, ' \r\n# Heading\r\n\r\nbody\r\n ');
    const result = await fetchWebPage(url, 500);
    assert.equal(result.article.text, '# Heading\n\nbody');
    assert.equal(result.servedAsText, true);
  }
});

test('HTML still extracts the article and removes navigation', async () => {
  const prose = 'This is the article content, with enough prose for the reader. '.repeat(12);
  fixture('text/html; charset=utf-8', `<html><head><title>Fixture</title></head><body><nav>Navigation menu</nav><article><h1>Fixture</h1><p>${prose}</p></article></body></html>`);
  const result = await fetchWebPage(url, 5000);
  assert.equal(result.servedAsText, false);
  assert.equal(result.article.fallback, false);
  assert.match(result.article.text, /This is the article content/);
  assert.doesNotMatch(result.article.text, /Navigation menu/);
});

test('rootless input produces a typed extraction error through the real parser', () => {
  for (const body of ['{"value":42}', '<!-- no document -->', '<!doctype html>']) {
    assert.throws(() => extractArticle(body, url, 500), err => err instanceof ExtractError && err.reason === 'parse-failed');
  }
});

test('registered tool preserves rootless extraction failure and browser guidance without retrying', async () => {
  fixture('text/html', '<!-- no document -->');
  await assert.rejects(fetchWebPage(url, 500), err => err instanceof ExtractError && err.reason === 'parse-failed');
  fixture('text/html', '<!-- no document -->');
  const result = await tool.execute({ url });
  assert.match(result, /^ERROR: web_fetch failed:/);
  assert.match(result, /no HTML document element/);
  assert.equal(result.split(skill.BROWSER_FETCH_RECOVERY).length - 1, 1);
  assert.doesNotMatch(result, /firstElementChild|TypeError/);
  assert.equal(requests, 1);
  assert.equal(logs.at(-1)[1].kind, 'extract:parse-failed');
});
