import assert from 'node:assert/strict';
import { symlinkSync } from 'node:fs';
import { join, parse } from 'node:path';
import {
  createClaudeDirectoryFixture,
  storedValue
} from './claude-directory-runtime.fixture.mjs';

const fixture = await createClaudeDirectoryFixture();
const { configModule, pathModule, configA, configB, fixtureRoot } = fixture;

try {
  const missingService = new configModule.ClaudeDirectoryConfigService({
    settings: {
      getStored: async () => ({
        exists: false,
        valid: false,
        value: null,
        serializedValue: null
      }),
      upsert: async () => 'ok'
    },
    pickDirectory: async () => null
  });
  assert.deepEqual(await missingService.hydrate(), {
    state: 'valid',
    config: { schemaVersion: 1, mode: 'automatic', configDirectory: null }
  }, 'a missing setting must hydrate the exact automatic schema-v1 intent');

  const validCustomService = new configModule.ClaudeDirectoryConfigService({
    settings: {
      getStored: async () => storedValue({
        schemaVersion: 1,
        mode: 'custom',
        configDirectory: configA
      }),
      upsert: async () => 'ok'
    },
    pickDirectory: async () => null
  });
  assert.equal((await validCustomService.hydrate()).config.configDirectory, configA);

  for (const malformed of [
    { schemaVersion: 2, mode: 'automatic', configDirectory: null },
    { schemaVersion: 1, mode: 'automatic', configDirectory: null, extra: true },
    { schemaVersion: 1, mode: 'custom', configDirectory: 'relative' }
  ]) {
    const service = new configModule.ClaudeDirectoryConfigService({
      settings: {
        getStored: async () => storedValue(malformed),
        upsert: async () => 'ok'
      },
      pickDirectory: async () => null
    });
    assert.equal((await service.hydrate()).state, 'invalid');
  }

  const oversizedService = new configModule.ClaudeDirectoryConfigService({
    settings: {
      getStored: async () => ({
        exists: true,
        valid: true,
        value: {},
        serializedValue: 'x'.repeat(8_193)
      }),
      upsert: async () => 'ok'
    },
    pickDirectory: async () => null
  });
  assert.equal((await oversizedService.hydrate()).state, 'invalid');

  const symlinkPath = join(fixtureRoot, 'linked-config');
  symlinkSync(configA, symlinkPath);
  const symlinkService = new configModule.ClaudeDirectoryConfigService({
    settings: {
      getStored: async () => storedValue({
        schemaVersion: 1,
        mode: 'custom',
        configDirectory: symlinkPath
      }),
      upsert: async () => 'ok'
    },
    pickDirectory: async () => null
  });
  assert.equal((await symlinkService.hydrate()).state, 'invalid');

  let selectedDirectory = null;
  const persistedValues = [];
  let failPersistence = false;
  const mutableConfig = new configModule.ClaudeDirectoryConfigService({
    settings: {
      getStored: async () => storedValue({
        schemaVersion: 1,
        mode: 'custom',
        configDirectory: configA
      }),
      upsert: async ({ value }) => {
        if (failPersistence) throw new Error('sqlite unavailable');
        persistedValues.push(value);
        return 'ok';
      }
    },
    pickDirectory: async () => selectedDirectory
  });
  await mutableConfig.hydrate();
  assert.equal(await mutableConfig.chooseCustom(), null, 'cancel must be a no-op');
  assert.equal(persistedValues.length, 0);
  selectedDirectory = configA;
  await mutableConfig.chooseCustom();
  assert.equal(persistedValues.length, 0, 'an identical custom choice must not rewrite SQLite');
  selectedDirectory = configB;
  failPersistence = true;
  await assert.rejects(() => mutableConfig.chooseCustom(), /sqlite unavailable/);
  assert.equal(mutableConfig.getCurrent().configDirectory, configA,
    'persistence failure must leave the previously applied intent intact');
  failPersistence = false;
  assert.equal((await mutableConfig.chooseCustom()).configDirectory, configB);
  assert.equal(mutableConfig.getCurrent().configDirectory, configB);
  assert.deepEqual(await mutableConfig.useAutomatic(), {
    schemaVersion: 1,
    mode: 'automatic',
    configDirectory: null
  });

  assert.throws(
    () => pathModule.requireCanonicalClaudeConfigDirectory(symlinkPath),
    /non-symlink/
  );
  assert.throws(
    () => pathModule.requireCanonicalClaudeConfigDirectory(parse(configA).root),
    /filesystem root/,
    'a filesystem root must not become a Claude config root'
  );

  console.log('EyesOnAgents Claude directory config tests passed');
} finally {
  fixture.cleanup();
}
