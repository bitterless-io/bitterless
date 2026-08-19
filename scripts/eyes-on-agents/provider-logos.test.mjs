import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const cssRule = (source, selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing CSS rule: ${selector}`);
  return match[1];
};

test('official provider logos are pinned local alpha PNG assets', () => {
  const assets = [
    {
      path: 'src/renderer/common/assets/icons/providers/claude.png',
      width: 248,
      height: 248,
      sha256: 'b6eea4faa96962fc5911a3b897f067030dd0c00ca2a1419cee32802e52981cfc',
    },
    {
      path: 'src/renderer/common/assets/icons/providers/codex.png',
      width: 104,
      height: 104,
      sha256: '8e82b26c98a10e45798ce48124515720657f7735fb8d0853b3f087eaa8a6b74e',
    },
  ];
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  for (const asset of assets) {
    const source = readFileSync(join(root, asset.path));
    assert.deepEqual(source.subarray(0, 8), pngSignature, `${asset.path} must remain a PNG`);
    assert.equal(source.toString('ascii', 12, 16), 'IHDR');
    assert.equal(source.readUInt32BE(16), asset.width);
    assert.equal(source.readUInt32BE(20), asset.height);
    assert.equal(source[24], 8, `${asset.path} must remain 8-bit`);
    assert.equal(source[25], 6, `${asset.path} must retain RGBA alpha`);
    assert.equal(createHash('sha256').update(source).digest('hex'), asset.sha256);
  }
});

test('provider logos keep their compact placement, mapping, and accessibility contract', () => {
  const card = read(
    'src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue'
  );
  const search = read(
    'src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue'
  );
  const glyph = read(
    'src/renderer/eyesOnAgents/src/components/ProviderGlyph/ProviderGlyph.vue'
  );
  const glyphStyles = read(
    'src/renderer/eyesOnAgents/src/components/ProviderGlyph/ProviderGlyph.less'
  );

  assert.match(
    card,
    /class="thread-card__title-row">\s*<ProviderGlyph :provider="thread\.provider" \/>\s*<h3 class="thread-card__title"/,
  );
  assert.match(
    search,
    /class="thread-search__result-heading">\s*<ProviderGlyph :provider="thread\.provider" \/>/,
  );
  assert.match(
    glyph,
    /import claudeLogo from '@renderer\/common\/assets\/icons\/providers\/claude\.png';/,
  );
  assert.match(
    glyph,
    /import codexLogo from '@renderer\/common\/assets\/icons\/providers\/codex\.png';/,
  );
  assert.match(
    glyph,
    /v-if="provider === 'codex'"[\s\S]*?provider-glyph__image--codex[\s\S]*?:src="codexLogo"[\s\S]*?alt=""[\s\S]*?aria-hidden="true"[\s\S]*?draggable="false"/,
  );
  assert.match(
    glyph,
    /v-else[\s\S]*?provider-glyph__image--claude[\s\S]*?:src="claudeLogo"[\s\S]*?alt=""[\s\S]*?aria-hidden="true"[\s\S]*?draggable="false"/,
  );
  assert.doesNotMatch(glyph, /@tabler\/icons-vue|IconPrompt|IconSparkles|\.svg|https?:\/\/|data:image/i);
  assert.match(glyph, /role="img"/);
  assert.match(glyph, /:aria-label="providerLabel"/);

  const glyphShell = cssRule(glyphStyles, '.provider-glyph');
  assert.match(glyphShell, /width: 16px/);
  assert.match(glyphShell, /height: 18px/);
  assert.match(glyphShell, /flex: 0 0 16px/);
  const codexLogoRule = cssRule(glyphStyles, '.provider-glyph__image--codex');
  assert.match(codexLogoRule, /width: 16px/);
  assert.match(codexLogoRule, /height: 16px/);
  const claudeLogoRule = cssRule(glyphStyles, '.provider-glyph__image--claude');
  assert.match(claudeLogoRule, /width: 15px/);
  assert.match(claudeLogoRule, /height: 15px/);
  assert.doesNotMatch(glyphStyles, /\bborder\s*:|background|box-shadow/);
});
