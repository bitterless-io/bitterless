/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript test helpers. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from '@bgotink/kdl/v1-compat';
import { buildSync } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'zellij-config-defaults-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));
const load = (name) => {
  const outfile = join(directory, `${name}.cjs`);
  buildSync({
    entryPoints: [`src/main/zellij/${name}.ts`],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile
  });
  return createRequire(import.meta.url)(outfile);
};
const { ensureZellijConfigDefaults } = load('zellijConfigDefaults.service');
const { buildZellijDefaultConfig } = load('zellijDefaultConfig');
const { ZellijConfigService } = load('zellijConfig.service');
const { ZELLIJ_CONFIG_VERSION_CODE } = load('zellijDefaultConfig.constant');
const markerFile = (file) => `${file}.bitterless-version.json`;
const markCurrent = (file, versionCode = ZELLIJ_CONFIG_VERSION_CODE) => {
  writeFileSync(
    markerFile(file),
    JSON.stringify({ schemaVersion: 1, versionCode, configFile: file }) + '\n'
  );
};
const legacy =
  '// My shortcuts, including a deliberately unbound default.\nkeybinds clear-defaults=true {\n  normal {\n    bind "Alt h" { NewPane "Left"; }\n    unbind "Super d"\n  }\n}\n';
const find = (source, ...path) =>
  path.reduce(
    (document, name) => document.nodes.find((node) => node.getName() === name)?.children,
    parse(source)
  );

test('a legacy bindings-only config gains defaults without changing or injecting bindings', () => {
  const next = ensureZellijConfigDefaults(legacy, 'darwin');
  assert.ok(next.startsWith(legacy));
  assert.equal(parse(next).nodes.filter((node) => node.getName() === 'keybinds').length, 1);
  assert.doesNotMatch(next, /\bbind "Super d"/);
  assert.equal(find(next, 'web_client', 'theme').nodes.length, 19);
  assert.equal(ensureZellijConfigDefaults(next, 'darwin'), next);
});

test('custom settings, named themes and partial web colors survive completion byte for byte', () => {
  const theme =
    'themes {\r\n    personal { fg 10 20 30; }\r\n    bitterless { bg 20 30 40; }\r\n}\r\n';
  const source =
    '// Owner palette\r\ntheme "personal"\r\nexplicit_theme_hue "light"\r\nweb_server true\r\nweb_sharing "off"\r\n' +
    theme +
    'web_client {\r\n    font "Iosevka" // keep this font\r\n    theme {\r\n        red "#123456" // custom red\r\n        cursor "#abcdef"\r\n    }\r\n}\r\n';
  const next = ensureZellijConfigDefaults(source, 'darwin');
  assert.ok(next.includes(theme));
  assert.ok(
    next.includes(
      'theme "personal"\r\nexplicit_theme_hue "light"\r\nweb_server true\r\nweb_sharing "off"'
    )
  );
  assert.ok(next.includes('    font "Iosevka" // keep this font\r\n'));
  assert.ok(next.includes('        red "#123456" // custom red\r\n        cursor "#abcdef"\r\n'));
  const palette = find(next, 'web_client', 'theme');
  assert.equal(palette.nodes.length, 19);
  assert.equal(palette.nodes.find((node) => node.getName() === 'red').getArguments()[0], '#123456');
  assert.equal(find(next, 'themes', 'bitterless').nodes.length, 1);
  assert.equal(ensureZellijConfigDefaults(next, 'darwin'), next);
  assert.doesNotMatch(next, /(?<!\r)\n/);
});

test('empty sections gain children while comments and slash-dashed overrides remain intact', () => {
  const source =
    '// web_client { theme { red "#000000"; }; }\n/- theme "commented-out"\nweb_client; // retain this comment\nthemes {}\n';
  const next = ensureZellijConfigDefaults(source, 'linux');
  assert.ok(
    next.startsWith('// web_client { theme { red "#000000"; }; }\n/- theme "commented-out"\n')
  );
  assert.ok(next.includes('; // retain this comment\n'));
  assert.equal(find(next, 'web_client', 'theme').nodes.length, 19);
  assert.equal(ensureZellijConfigDefaults(next, 'linux'), next);
});

test('a section at EOF without a newline receives children before new root defaults', () => {
  for (const source of ['web_client', 'themes', 'web_client { theme; }']) {
    const next = ensureZellijConfigDefaults(source, 'darwin');
    assert.equal(find(next, 'web_client', 'theme').nodes.length, 19);
    assert.equal(ensureZellijConfigDefaults(next, 'darwin'), next);
  }
});

test('a complete config is not rewritten, revalidated or backed up on repeated ensure', async () => {
  const folder = mkdtempSync(join(directory, 'complete-'));
  const file = join(folder, 'config.kdl');
  const source = buildZellijDefaultConfig({ platform: 'darwin' });
  writeFileSync(file, source);
  markCurrent(file);
  const before = statSync(file);
  const markerBefore = statSync(markerFile(file));
  const config = new ZellijConfigService(file, {
    platform: 'darwin',
    validate: async () => assert.fail('unchanged config should not be revalidated')
  });
  await config.initialize();
  await config.initialize();
  assert.equal(readFileSync(file, 'utf8'), source);
  assert.equal(statSync(file).mtimeMs, before.mtimeMs);
  assert.equal(statSync(file).ino, before.ino);
  assert.equal(statSync(markerFile(file)).mtimeMs, markerBefore.mtimeMs);
  assert.deepEqual(readdirSync(folder), ['config.kdl', 'config.kdl.bitterless-version.json']);
});

test('initialization validates a temporary candidate then backs up the original with private permissions', async () => {
  const folder = mkdtempSync(join(directory, 'upgrade-'));
  const file = join(folder, 'config.kdl');
  writeFileSync(file, legacy, { mode: 0o640 });
  let validations = 0;
  const config = new ZellijConfigService(file, {
    platform: 'darwin',
    validate: async (candidate) => {
      validations++;
      assert.notEqual(candidate, file);
      assert.equal(readFileSync(file, 'utf8'), legacy);
      assert.equal(
        existsSync(markerFile(file)),
        false,
        'version is not committed before native validation'
      );
      assert.equal(find(readFileSync(candidate, 'utf8'), 'web_client', 'theme').nodes.length, 19);
    }
  });
  await config.initialize();
  assert.equal(readFileSync(file, 'utf8'), buildZellijDefaultConfig({ platform: 'darwin' }));
  assert.deepEqual(JSON.parse(readFileSync(markerFile(file), 'utf8')), {
    schemaVersion: 1,
    versionCode: ZELLIJ_CONFIG_VERSION_CODE,
    configFile: file
  });
  const backup = readdirSync(folder).find((name) => name.includes('.bitterless-backup-'));
  assert.equal(readFileSync(join(folder, backup), 'utf8'), legacy);
  assert.equal(statSync(join(folder, backup)).mode & 0o777, 0o600);
  assert.equal(statSync(file).mode & 0o777, 0o640);
  const before = statSync(file);
  await config.initialize();
  assert.equal(validations, 1);
  assert.equal(statSync(file).mtimeMs, before.mtimeMs);
  assert.equal(readdirSync(folder).length, 3);
});

test('malformed KDL and failed native validation preserve the original and leave no temporary files', async () => {
  for (const source of ['web_client {\n', legacy]) {
    const folder = mkdtempSync(join(directory, 'invalid-'));
    const file = join(folder, 'config.kdl');
    writeFileSync(file, source);
    markCurrent(file);
    const markerBefore = readFileSync(markerFile(file), 'utf8');
    const config = new ZellijConfigService(file, {
      platform: 'darwin',
      validate: async () => {
        throw Error('config-validation-failed');
      }
    });
    await assert.rejects(config.initialize(), /config-invalid|config-validation-failed/);
    assert.equal(readFileSync(file, 'utf8'), source);
    assert.equal(readFileSync(markerFile(file), 'utf8'), markerBefore);
    assert.deepEqual(readdirSync(folder), ['config.kdl', 'config.kdl.bitterless-version.json']);
  }
});

test('concurrent opens share one ensure and can retry after a validation failure', async () => {
  const folder = mkdtempSync(join(directory, 'concurrent-'));
  const file = join(folder, 'config.kdl');
  writeFileSync(file, legacy);
  let release;
  let reject = true;
  let validations = 0;
  const config = new ZellijConfigService(file, {
    platform: 'darwin',
    validate: async () => {
      validations++;
      await new Promise((resolve) => {
        release = resolve;
      });
      if (reject) throw Error('config-validation-failed');
    }
  });
  const first = config.initialize();
  assert.equal(config.initialize(), first);
  release();
  await assert.rejects(first, /config-validation-failed/);
  assert.equal(readFileSync(file, 'utf8'), legacy);
  reject = false;
  const retry = config.initialize();
  assert.notEqual(retry, first);
  assert.equal(config.initialize(), retry);
  release();
  await retry;
  assert.equal(validations, 2);
  assert.equal(readdirSync(folder).filter((name) => name.includes('backup-')).length, 1);
});

test('concurrent owner edits or creation during validation are rejected without overwriting or backup', async () => {
  for (const source of [null, legacy]) {
    const folder = mkdtempSync(join(directory, 'drift-'));
    const file = join(folder, 'config.kdl');
    if (source !== null) writeFileSync(file, source);
    const ownerEdit = '// Owner edit made during validation\n';
    const config = new ZellijConfigService(file, {
      platform: 'darwin',
      validate: async () => {
        writeFileSync(file, ownerEdit);
      }
    });
    await assert.rejects(config.initialize(), /config-drift/);
    assert.equal(readFileSync(file, 'utf8'), ownerEdit);
    assert.deepEqual(readdirSync(folder), ['config.kdl']);
  }
});

test(
  'fresh and upgraded configurations pass setup --check with the actual staged binary',
  {
    skip: existsSync('build/maestro-tools/zellij') ? false : 'run yarn tools:init to stage Zellij'
  },
  async () => {
    for (const source of [
      null,
      legacy,
      'web_client',
      'web_client { font "monospace"; theme { red "#123456"; }; }\n'
    ]) {
      const folder = mkdtempSync(join(directory, 'native-'));
      const file = join(folder, 'config.kdl');
      if (source !== null) writeFileSync(file, source);
      // Exercise both full upgrades and surgical completion for an already initialized version.
      if (source?.startsWith('web_client')) markCurrent(file);
      const config = new ZellijConfigService(file, {
        platform: 'darwin',
        validate: async (candidate) => {
          assert.match(
            execFileSync(
              'build/maestro-tools/zellij',
              ['--config', candidate, 'setup', '--check'],
              { encoding: 'utf8' }
            ),
            /\[CONFIG FILE\]: Well defined\./
          );
        }
      });
      await config.initialize();
      assert.equal(find(readFileSync(file, 'utf8'), 'web_client', 'theme').nodes.length, 19);
    }
  }
);

test('older, missing and foreign-file markers trigger full template replacement with a backup', async () => {
  for (const kind of ['old', 'missing', 'foreign']) {
    const folder = mkdtempSync(join(directory, 'version-upgrade-'));
    const file = join(folder, 'config.kdl');
    const source = '// Previous application template\nweb_sharing "off"\n';
    writeFileSync(file, source);
    if (kind === 'old') markCurrent(file, '260901000000');
    if (kind === 'foreign')
      writeFileSync(
        markerFile(file),
        JSON.stringify({
          schemaVersion: 1,
          versionCode: ZELLIJ_CONFIG_VERSION_CODE,
          configFile: join(folder, 'other.kdl')
        })
      );
    const config = new ZellijConfigService(file, { platform: 'darwin', validate: async () => {} });
    await config.initialize();
    assert.equal(readFileSync(file, 'utf8'), buildZellijDefaultConfig({ platform: 'darwin' }));
    const backups = readdirSync(folder).filter((name) => name.includes('backup-'));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(folder, backups[0]), 'utf8'), source);
    assert.equal(JSON.parse(readFileSync(markerFile(file), 'utf8')).configFile, file);
  }
});

test('same-version custom edits survive later opens and missing defaults are completed once', async () => {
  const folder = mkdtempSync(join(directory, 'version-custom-'));
  const file = join(folder, 'config.kdl');
  const source = legacy + 'web_sharing "off"\nweb_client { theme { red "#123456"; }; }\n';
  writeFileSync(file, source);
  markCurrent(file);
  const markerBefore = statSync(markerFile(file));
  let validations = 0;
  const config = new ZellijConfigService(file, {
    platform: 'darwin',
    validate: async () => {
      validations++;
    }
  });
  await config.initialize();
  const next = readFileSync(file, 'utf8');
  assert.ok(next.startsWith(legacy));
  assert.ok(next.includes('web_sharing "off"'));
  assert.ok(next.includes('red "#123456"'));
  assert.equal(find(next, 'web_client', 'theme').nodes.length, 19);
  const before = statSync(file);
  await config.initialize();
  assert.equal(validations, 1);
  assert.equal(statSync(file).ino, before.ino);
  assert.equal(statSync(file).mtimeMs, before.mtimeMs);
  assert.equal(statSync(markerFile(file)).ino, markerBefore.ino);
  assert.equal(statSync(markerFile(file)).mtimeMs, markerBefore.mtimeMs);
});

test('an outdated malformed template can be backed up and upgraded, while current malformed KDL is rejected', async () => {
  const folder = mkdtempSync(join(directory, 'version-malformed-'));
  const file = join(folder, 'config.kdl');
  const source = 'web_client {\n';
  writeFileSync(file, source);
  const config = new ZellijConfigService(file, { platform: 'darwin', validate: async () => {} });
  assert.doesNotThrow(() => config.read(), 'outdated config must reach its authorized upgrade');
  await config.initialize();
  const backup = readdirSync(folder).find((name) => name.includes('backup-'));
  assert.equal(readFileSync(join(folder, backup), 'utf8'), source);
  writeFileSync(file, source);
  await assert.rejects(config.initialize(), /config-invalid/);
  assert.equal(readFileSync(file, 'utf8'), source);
});

test('failed upgrade validation leaves the previous version and configuration untouched', async () => {
  const folder = mkdtempSync(join(directory, 'version-rejected-'));
  const file = join(folder, 'config.kdl');
  writeFileSync(file, legacy);
  markCurrent(file, '260901000000');
  const markerBefore = readFileSync(markerFile(file), 'utf8');
  const config = new ZellijConfigService(file, {
    platform: 'darwin',
    validate: async () => {
      throw Error('config-validation-failed');
    }
  });
  await assert.rejects(config.initialize(), /config-validation-failed/);
  assert.equal(readFileSync(file, 'utf8'), legacy);
  assert.equal(readFileSync(markerFile(file), 'utf8'), markerBefore);
  assert.equal(readdirSync(folder).length, 2);
});

test('marker edits during validation reject an upgrade without writing config or claiming the version', async () => {
  const folder = mkdtempSync(join(directory, 'version-drift-'));
  const file = join(folder, 'config.kdl');
  writeFileSync(file, legacy);
  markCurrent(file, '260901000000');
  const config = new ZellijConfigService(file, {
    platform: 'darwin',
    validate: async () => {
      markCurrent(file, '260902000000');
    }
  });
  await assert.rejects(config.initialize(), /config-drift/);
  assert.equal(readFileSync(file, 'utf8'), legacy);
  assert.equal(JSON.parse(readFileSync(markerFile(file), 'utf8')).versionCode, '260902000000');
  assert.equal(readdirSync(folder).length, 2);
});

test('a stale marker without its config file does not suppress recreation', async () => {
  const folder = mkdtempSync(join(directory, 'version-missing-file-'));
  const file = join(folder, 'config.kdl');
  markCurrent(file);
  const config = new ZellijConfigService(file, { platform: 'darwin', validate: async () => {} });
  await config.initialize();
  assert.equal(readFileSync(file, 'utf8'), buildZellijDefaultConfig({ platform: 'darwin' }));
  assert.equal(
    JSON.parse(readFileSync(markerFile(file), 'utf8')).versionCode,
    ZELLIJ_CONFIG_VERSION_CODE
  );
});
