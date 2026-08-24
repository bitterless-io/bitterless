import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { characterCount, characterCountGate } from './onlyPreviewRenderingTest.helper.mjs';

test('character count uses grapheme clusters and sums every non-empty selection', () => {
  assert.equal(characterCount.countOnlyPreviewGraphemes(''), 0);
  assert.equal(characterCount.countOnlyPreviewGraphemes('ASCII'), 5);
  assert.equal(characterCount.countOnlyPreviewGraphemes('中文'), 2);
  assert.equal(characterCount.countOnlyPreviewGraphemes('e\u0301'), 1);
  assert.equal(characterCount.countOnlyPreviewGraphemes('👨‍👩‍👧‍👦'), 1);
  assert.equal(characterCount.countOnlyPreviewGraphemes(' \n\t'), 3);
  assert.equal(
    characterCount.countOnlyPreviewSelectionTexts(['A', '', '中文', 'e\u0301', '👨‍👩‍👧‍👦']),
    5
  );
});

test('character count falls back to Unicode code points only without Segmenter', () => {
  assert.equal(characterCount.countOnlyPreviewGraphemes('e\u0301', null), 2);
  assert.equal(characterCount.countOnlyPreviewGraphemes('👨‍👩‍👧‍👦', null), 7);
  assert.equal(characterCount.countOnlyPreviewSelectionTexts(['界', '😀'], null), 2);
});

test('DOM selection counts only when both endpoints remain inside the preview body', () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><article id="preview"><span>hello 世界</span></article><p id="outside">outside</p></body></html>'
  );
  const document = dom.window.document;
  const preview = document.querySelector('#preview');
  const insideText = preview.querySelector('span').firstChild;
  const outsideText = document.querySelector('#outside').firstChild;
  const selection = dom.window.getSelection();

  const insideRange = document.createRange();
  insideRange.setStart(insideText, 0);
  insideRange.setEnd(insideText, 8);
  selection.removeAllRanges();
  selection.addRange(insideRange);
  assert.equal(characterCount.countOnlyPreviewDomSelection(preview, selection), 8);

  const outsideRange = document.createRange();
  outsideRange.setStart(insideText, 0);
  outsideRange.setEnd(outsideText, 3);
  selection.removeAllRanges();
  selection.addRange(outsideRange);
  assert.equal(characterCount.countOnlyPreviewDomSelection(preview, selection), 0);

  selection.collapse(insideText, 2);
  assert.equal(characterCount.countOnlyPreviewDomSelection(preview, selection), 0);
});

test('character-count gates reject deferred old reports until the current source is ready', () => {
  const sourceGate = new characterCountGate.OnlyPreviewCharacterCountSourceGate();
  const hostGate = new characterCountGate.OnlyPreviewCharacterCountHostGate();

  assert.equal(sourceGate.beginTransition('revision-a'), true);
  assert.equal(hostGate.beginTransition('revision-a'), true);
  assert.equal(sourceGate.arm('revision-a'), true);
  assert.equal(hostGate.acceptReady('revision-a'), true);
  assert.equal(hostGate.resume('revision-a'), true);
  assert.equal(sourceGate.canReport('revision-a', 7), true);
  assert.equal(hostGate.canAcceptCount(7), true);

  assert.equal(hostGate.beginTransition('revision-b'), true);
  assert.equal(hostGate.canAcceptCount(0), true, 'old zero may clear but never arms');
  assert.equal(hostGate.canAcceptCount(7), false, 'old nonzero is blocked during restore');
  assert.equal(sourceGate.beginTransition('revision-b'), true);
  assert.equal(sourceGate.canReport('revision-a', 7), false);
  assert.equal(sourceGate.canReport('revision-a', 0), false);

  assert.equal(sourceGate.arm('revision-b'), true);
  assert.equal(hostGate.acceptReady('revision-b'), true);
  assert.equal(hostGate.canAcceptCount(9), false, 'ready waits for Shell restore completion');
  assert.equal(hostGate.canBufferCount(9), true, 'first current selection can wait for Shell');
  assert.equal(hostGate.resume('revision-b'), true);
  assert.equal(sourceGate.canReport('revision-b', 9), true);
  assert.equal(hostGate.canAcceptCount(9), true);
});

test('opaque revisions reject rapid stale readiness and resynchronize either renderer', () => {
  const sourceGate = new characterCountGate.OnlyPreviewCharacterCountSourceGate();
  const hostGate = new characterCountGate.OnlyPreviewCharacterCountHostGate();

  assert.equal(hostGate.beginTransition('revision-b'), true);
  assert.equal(sourceGate.beginTransition('revision-b'), true);
  assert.equal(hostGate.beginTransition('revision-c'), true);
  assert.equal(sourceGate.beginTransition('revision-c'), true);
  assert.equal(sourceGate.arm('revision-b'), false);
  assert.equal(hostGate.acceptReady('revision-b'), false);
  assert.equal(hostGate.resume('revision-b'), false);
  assert.equal(sourceGate.arm('revision-c'), true);
  assert.equal(hostGate.acceptReady('revision-c'), true);
  assert.equal(hostGate.resume('revision-c'), true);
  assert.equal(hostGate.canAcceptCount(12), true);

  const reloadedSource = new characterCountGate.OnlyPreviewCharacterCountSourceGate();
  assert.equal(hostGate.isSuspended(), false);
  assert.equal(
    hostGate.beginTransition('revision-d'),
    true,
    'a live host rotates on Preview reload'
  );
  assert.equal(hostGate.resume('revision-d'), true);
  assert.equal(reloadedSource.beginTransition(hostGate.revisionForSync()), true);
  assert.equal(reloadedSource.arm('revision-d'), true);
  assert.equal(hostGate.acceptReady('revision-d'), true);

  const reloadedHost = new characterCountGate.OnlyPreviewCharacterCountHostGate();
  assert.equal(reloadedHost.beginTransition('revision-e'), true);
  assert.equal(reloadedSource.beginTransition('revision-e'), true);
  assert.equal(reloadedSource.arm('revision-e'), true);
  assert.equal(reloadedHost.acceptReady('revision-e'), true);
  assert.equal(reloadedHost.resume('revision-e'), true);
  assert.equal(reloadedHost.canAcceptCount(4), true);
});

test('a local pending revision invalidates an older selection restore before Main responds', () => {
  const sourceGate = new characterCountGate.OnlyPreviewCharacterCountSourceGate();
  const hostGate = new characterCountGate.OnlyPreviewCharacterCountHostGate();

  assert.equal(hostGate.beginTransition('event-b'), true);
  assert.equal(sourceGate.beginTransition('event-b'), true);
  assert.equal(sourceGate.arm('event-b'), true);
  assert.equal(hostGate.acceptReady('event-b'), true);

  assert.equal(
    hostGate.beginTransition('pending-c'),
    true,
    'local C click rotates without broadcast'
  );
  assert.equal(hostGate.resume('event-b'), false, 'B finally cannot re-arm after the C click');
  assert.equal(hostGate.acceptReady('event-b'), false);
  assert.equal(hostGate.canAcceptCount(8), false);
  assert.equal(sourceGate.canReport('event-b', 8), true, 'Preview remains B until Main confirms C');

  assert.equal(hostGate.beginTransition('event-c'), true);
  assert.equal(sourceGate.beginTransition('event-c'), true);
  assert.equal(sourceGate.arm('event-c'), true);
  assert.equal(hostGate.acceptReady('event-c'), true);
  assert.equal(hostGate.resume('event-c'), true);
  assert.equal(hostGate.canAcceptCount(11), true);

  assert.equal(hostGate.beginTransition('pending-d'), true);
  assert.equal(hostGate.resume('event-c'), false);
  assert.equal(
    hostGate.beginTransition('recovery-c'),
    true,
    'failed D gets a fresh recovery fence'
  );
  assert.equal(sourceGate.beginTransition('recovery-c'), true);
  assert.equal(sourceGate.arm('recovery-c'), true);
  assert.equal(hostGate.acceptReady('recovery-c'), true);
  assert.equal(hostGate.resume('recovery-c'), true);
});

test('a native refresh transition reloads Preview before accepting its next count', () => {
  const sourceGate = new characterCountGate.OnlyPreviewCharacterCountSourceGate();
  const hostGate = new characterCountGate.OnlyPreviewCharacterCountHostGate();

  assert.equal(hostGate.beginTransition('before-refresh'), true);
  assert.equal(sourceGate.beginTransition('before-refresh'), true);
  assert.equal(sourceGate.arm('before-refresh'), true);
  assert.equal(hostGate.acceptReady('before-refresh'), true);
  assert.equal(hostGate.resume('before-refresh'), true);

  assert.equal(hostGate.beginTransition('native-refresh'), true);
  assert.equal(hostGate.canAcceptCount(6), false);
  assert.equal(sourceGate.beginTransition('native-refresh'), true);
  assert.equal(sourceGate.canReport('before-refresh', 6), false);
  assert.equal(sourceGate.arm('native-refresh'), true);
  assert.equal(hostGate.acceptReady('native-refresh'), true);
  assert.equal(hostGate.canBufferCount(7), true);
  assert.equal(hostGate.resume('native-refresh'), true);
  assert.equal(hostGate.canAcceptCount(7), true);
});
