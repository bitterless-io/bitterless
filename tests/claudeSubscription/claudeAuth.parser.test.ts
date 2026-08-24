import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAllowedClaudeAuthNavigation,
  resolveClaudeLoopbackCallbackFence
} from '../../src/main/claudeSubscription/claudeAuth.navigation';
import {
  findClaudeAuthorizationUrl,
  hasClaudeManualCodePrompt,
  parseClaudeAuthorizationOutputChunk
} from '../../src/main/claudeSubscription/claudeAuthLogin.parser';

test('parses chunk-complete ANSI and OSC-8 authorization URLs with BEL or ST terminators', () => {
  const prefix = '\u001b]8;;https://console.anthropic.com/oauth/auth';
  assert.equal(findClaudeAuthorizationUrl(prefix), null);

  const bel = `${prefix}orize?client_id=abc&code_challenge=def\u0007Open\u001b]8;;\u0007`;
  assert.equal(findClaudeAuthorizationUrl(bel)?.hostname, 'console.anthropic.com');

  const st =
    '\u001b]8;;https://claude.com/oauth/authorize?client_id=abc&code_challenge=def\u001b\\Open\u001b]8;;\u001b\\';
  assert.equal(findClaudeAuthorizationUrl(st)?.hostname, 'claude.com');
  assert.equal(
    findClaudeAuthorizationUrl('https://evil.example/oauth/authorize?client_id=bad\n'),
    null
  );
  assert.equal(
    findClaudeAuthorizationUrl('https://user@claude.com/oauth/authorize?client_id=bad\n'),
    null
  );
});

test('retains an incomplete authorization URL only until a later PTY chunk terminates it', () => {
  const first = parseClaudeAuthorizationOutputChunk(
    '',
    '\u001b]8;;https://console.anthropic.com/oauth/auth'
  );
  assert.equal(first.authorizationUrl, null);
  assert.equal(first.completedOutput, '\u001b]8;;');
  assert.equal(first.pendingAuthorizationTail, 'https://console.anthropic.com/oauth/auth');

  const second = parseClaudeAuthorizationOutputChunk(
    first.pendingAuthorizationTail,
    'orize?client_id=abc&code_challenge=def\u0007Open'
  );
  assert.equal(second.authorizationUrl?.hostname, 'console.anthropic.com');
  assert.equal(second.pendingAuthorizationTail, '');
});

test('does not treat token-shaped terminal text as authorization metadata', () => {
  const tokenShaped = 'sk-ant-oat01-abcdefghijklmnopqrstuvwxyz123456\r\n';
  assert.equal(findClaudeAuthorizationUrl(tokenShaped), null);
  assert.equal(hasClaudeManualCodePrompt(tokenShaped), false);
});

test('recognizes a real manual-code prompt through ANSI while rejecting explanatory text', () => {
  assert.equal(
    hasClaudeManualCodePrompt('\u001b[36mPaste authorization code here if prompted:\u001b[0m '),
    true
  );
  assert.equal(hasClaudeManualCodePrompt('You may need an authorization code later.\n'), false);
  assert.equal(hasClaudeManualCodePrompt('Docs mention: paste code examples'), false);
});

test('fences navigation to Anthropic HTTPS and the exact advertised loopback callback', () => {
  const authorizationUrl = new URL(
    'https://claude.ai/oauth/authorize?client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A54545%2Fcallback'
  );
  const fence = resolveClaudeLoopbackCallbackFence(authorizationUrl);
  assert.deepEqual(fence, {
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: '54545',
    pathname: '/callback'
  });
  assert.equal(isAllowedClaudeAuthNavigation(authorizationUrl.href, fence), true);
  assert.equal(
    isAllowedClaudeAuthNavigation('http://127.0.0.1:54545/callback?code=opaque', fence),
    true
  );
  assert.equal(isAllowedClaudeAuthNavigation('http://127.0.0.1:54546/callback', fence), false);
  assert.equal(isAllowedClaudeAuthNavigation('http://localhost:54545/callback', fence), false);
  assert.equal(isAllowedClaudeAuthNavigation('http://127.0.0.1:54545/other', fence), false);
  assert.equal(
    isAllowedClaudeAuthNavigation('https://user@claude.com/oauth/authorize', fence),
    false
  );
  assert.equal(isAllowedClaudeAuthNavigation('file:///tmp/token', fence), false);
});

test('accepts only the exact advertised IPv6 loopback callback without URL credentials', () => {
  const authorizationUrl = new URL(
    'https://claude.com/oauth/authorize?redirect_uri=http%3A%2F%2F%5B%3A%3A1%5D%3A54545%2Fcallback'
  );
  const fence = resolveClaudeLoopbackCallbackFence(authorizationUrl);
  assert.deepEqual(fence, {
    protocol: 'http:',
    hostname: '[::1]',
    port: '54545',
    pathname: '/callback'
  });
  assert.equal(
    isAllowedClaudeAuthNavigation('http://[::1]:54545/callback?code=opaque', fence),
    true
  );
  assert.equal(
    isAllowedClaudeAuthNavigation('http://[::2]:54545/callback?code=opaque', fence),
    false
  );
  assert.equal(
    resolveClaudeLoopbackCallbackFence(
      new URL(
        'https://claude.com/oauth/authorize?redirect_uri=http%3A%2F%2Fuser%40127.0.0.1%3A54545%2Fcallback'
      )
    ),
    null
  );
});
