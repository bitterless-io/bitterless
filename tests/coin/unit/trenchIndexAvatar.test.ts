import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasTrenchWalletAvatarImage,
  markTrenchWalletAvatarFailed,
  trenchWalletAvatarInitial,
} from '../../../src/renderer/coin/src/components/TrenchIndexWorkspace/trenchIndexAvatar';

test('wallet avatar initials prefer the trimmed name and otherwise use the canonical address', () => {
  assert.equal(trenchWalletAvatarInitial(' 王小二 ', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), '王');
  assert.equal(trenchWalletAvatarInitial(null, '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'), 'A');
  assert.equal(trenchWalletAvatarInitial('', '7ywhmfk9jze1lm1g1zauhuisxhj7uscb7vvxez2mvwy'), '7');
  assert.equal(trenchWalletAvatarInitial('istanbul', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'I');
  assert.equal(trenchWalletAvatarInitial('ßeta', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'ß');
  assert.equal(trenchWalletAvatarInitial('😀 wallet', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), '😀');
  assert.equal(Array.from(trenchWalletAvatarInitial('ßeta', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).length, 1);
  assert.equal(Array.from(trenchWalletAvatarInitial('😀 wallet', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).length, 1);
  assert.throws(() => trenchWalletAvatarInitial(null, ''));
});

test('an HTTPS avatar stays renderable until its URL fails for the renderer lifetime', () => {
  const avatarUrl = 'https://avatar.example.test/wallet.png';
  const initial = new Set<string>();
  assert.equal(hasTrenchWalletAvatarImage(null, initial), false);
  assert.equal(hasTrenchWalletAvatarImage(avatarUrl, initial), true);

  const failed = markTrenchWalletAvatarFailed(initial, avatarUrl);
  assert.equal(initial.size, 0);
  assert.equal(hasTrenchWalletAvatarImage(avatarUrl, failed), false);
  assert.equal(markTrenchWalletAvatarFailed(failed, avatarUrl), failed);
  assert.equal(hasTrenchWalletAvatarImage('https://avatar.example.test/other.png', failed), true);
});
