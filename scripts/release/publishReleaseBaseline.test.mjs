/* eslint-disable @typescript-eslint/explicit-function-return-type */
// 契约:docs/issues/publish-bumps-from-a-stale-local-version.md
//
// `resolveReleaseBaseline` 是「起跳之前本地该被改成什么」的**全部**判据 —— `alignLocalReleaseBaseline`
// 只负责读远端、落盘、打印。四格判据逐格钉死,尤其是 2026-09-22 真实撞上的那一格
// (同版本、不同 version_code)。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveReleaseBaseline } = require('../publish.js');

const local = (version, versionCode) => ({ _version: version, version, version_code: versionCode });
const remote = (version, versionCode) => ({ version, versionCode });

test('a first publish has nothing to align against', () => {
  assert.equal(resolveReleaseBaseline(local('0.0.1', '260101000000'), null), null);
});

test('a local record behind the channel adopts the published version and code', () => {
  const baseline = resolveReleaseBaseline(local('0.0.125', '260922143524'), remote('0.0.126', '260922210845'));
  assert.equal(baseline?.version, '0.0.126');
  assert.equal(baseline?.versionCode, '260922210845');
  assert.match(baseline.reason, /behind the published 0\.0\.126/);
});

test('the 2026-09-22 case: the version matches but the local code lost the published one', () => {
  // 这正是那次失败的现场 —— patch.js 起跳到 0.0.126 并写了一个新 code,而 0.0.126 已经发过。
  const baseline = resolveReleaseBaseline(local('0.0.126', '260923001823'), remote('0.0.126', '260922210845'));
  assert.equal(baseline?.version, '0.0.126');
  assert.equal(baseline?.versionCode, '260922210845');
  assert.match(baseline.reason, /already published as 260922210845/);
});

test('a local record ahead of the channel is left alone', () => {
  // 上一次发布中途失败留下的领先是有意义的,回退它只会让下一发撞上它自己。
  assert.equal(resolveReleaseBaseline(local('0.0.130', '260923010000'), remote('0.0.126', '260922210845')), null);
});

test('an already-aligned record is left alone', () => {
  assert.equal(resolveReleaseBaseline(local('0.0.126', '260922210845'), remote('0.0.126', '260922210845')), null);
});

test('a malformed remote manifest still throws rather than being adopted', () => {
  assert.throws(
    () => resolveReleaseBaseline(local('0.0.125', '260922143524'), remote('0.0.126', 'not-a-code')),
    /invalid versionCode/
  );
  assert.throws(
    () => resolveReleaseBaseline(local('0.0.125', '260922143524'), remote('nonsense', '260922210845')),
    /Invalid release version comparison/
  );
});

test('the realigned baseline lets patch.js land clear of the channel', () => {
  // 端到端的那一句话:对齐 → 起跳 → 四条判据全部放行。用真正的 compare-versions 算,不手推。
  const { compareVersions } = require('compare-versions');
  const baseline = resolveReleaseBaseline(local('0.0.125', '260922143524'), remote('0.0.126', '260922210845'));
  const bumped = baseline.version.split('.');
  bumped[2] = String(Number(bumped[2]) + 1);
  const nextVersion = bumped.join('.');
  const nextCode = '260923002210';
  assert.equal(nextVersion, '0.0.127');
  assert.ok(compareVersions(nextCode, baseline.versionCode) > 0, 'patch.js needs a strictly later code');
  const versionOrder = compareVersions(nextVersion, '0.0.126');
  const codeOrder = compareVersions(nextCode, '260922210845');
  assert.ok(versionOrder > 0, 'no semantic downgrade');
  assert.ok(!(versionOrder === 0 && codeOrder !== 0), 'no semantic version reuse');
  assert.ok(codeOrder > 0, 'no version_code downgrade');
  assert.ok(!(versionOrder > 0 && codeOrder === 0), 'no version_code reuse');
});
