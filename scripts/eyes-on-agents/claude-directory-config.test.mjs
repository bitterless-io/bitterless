import assert from 'node:assert/strict';
import { symlinkSync } from 'node:fs';
import { join, parse } from 'node:path';
import {
  createClaudeDirectoryFixture,
  storedValue
} from './claude-directory-runtime.fixture.mjs';

const fixture = await createClaudeDirectoryFixture();
const { configModule, pathModule, configA, configB, fixtureRoot } = fixture;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

try {
  const missingService = new configModule.ClaudeDirectoryConfigService({
    settings: {
      getStored: async () => ({
        exists: false,
        valid: false,
        value: null,
        serializedValue: null
      }),
      upsert: async () => { assert.fail('a missing setting must not be written on hydrate'); }
    },
    pickDirectory: async () => null
  });
  const missingHydration = await missingService.hydrate();
  assert.equal(missingHydration.state, 'valid');
  assert.equal(missingHydration.config.schemaVersion, 2);
  assert.equal(missingHydration.config.environments.length, 1);
  assert.deepEqual(
    {
      label: missingHydration.config.environments[0].label,
      mode: missingHydration.config.environments[0].mode,
      configDirectory: missingHydration.config.environments[0].configDirectory,
      enabled: missingHydration.config.environments[0].enabled
    },
    { label: 'Default', mode: 'automatic', configDirectory: null, enabled: true },
    'a missing setting must hydrate exactly one default automatic enabled environment'
  );
  assert.ok(UUID_PATTERN.test(missingHydration.config.environments[0].id),
    'the default environment must carry a generated uuid id');

  const migrationWrites = [];
  const migratedService = new configModule.ClaudeDirectoryConfigService({
    settings: {
      getStored: async () => storedValue({
        schemaVersion: 1,
        mode: 'custom',
        configDirectory: configA
      }),
      upsert: async ({ value }) => { migrationWrites.push(value); return 'ok'; }
    },
    pickDirectory: async () => null
  });
  const migratedHydration = await migratedService.hydrate();
  assert.equal(migratedHydration.state, 'valid');
  assert.equal(migratedHydration.config.environments.length, 1);
  assert.deepEqual(
    {
      label: migratedHydration.config.environments[0].label,
      mode: migratedHydration.config.environments[0].mode,
      configDirectory: migratedHydration.config.environments[0].configDirectory,
      enabled: migratedHydration.config.environments[0].enabled
    },
    { label: 'Default', mode: 'custom', configDirectory: configA, enabled: true },
    'a persisted schemaVersion 1 value must migrate into one Default custom enabled environment'
  );
  assert.ok(UUID_PATTERN.test(migratedHydration.config.environments[0].id));
  assert.equal(migrationWrites.length, 1, 'the schemaVersion 1 -> 2 migration must persist exactly once');
  assert.deepEqual(migrationWrites[0], migratedHydration.config,
    'the migrated value must be persisted at the same setting key in the new schemaVersion 2 shape');

  const roundTripValue = {
    schemaVersion: 2,
    environments: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        label: 'Default',
        mode: 'automatic',
        configDirectory: null,
        enabled: true
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        label: 'claude2',
        mode: 'custom',
        configDirectory: configA,
        enabled: false
      }
    ]
  };
  const roundTripService = new configModule.ClaudeDirectoryConfigService({
    settings: {
      getStored: async () => storedValue(roundTripValue),
      upsert: async () => { assert.fail('an already-current schemaVersion 2 value must not be rewritten'); }
    },
    pickDirectory: async () => null
  });
  const roundTripHydration = await roundTripService.hydrate();
  assert.deepEqual(roundTripHydration, { state: 'valid', config: roundTripValue });

  for (const malformed of [
    // schemaVersion 1 malformed shapes.
    { schemaVersion: 1, mode: 'automatic', configDirectory: null, extra: true },
    { schemaVersion: 1, mode: 'custom', configDirectory: 'relative' },
    // schemaVersion 2 malformed shapes.
    { schemaVersion: 2, environments: [] },
    { schemaVersion: 3, environments: [] },
    // a stray schemaVersion 2 tag on the old scalar shape must not be treated as valid.
    { schemaVersion: 2, mode: 'automatic', configDirectory: null },
    {
      schemaVersion: 2,
      environments: [{
        id: 'not-a-uuid',
        label: 'Default',
        mode: 'automatic',
        configDirectory: null,
        enabled: true
      }]
    },
    {
      schemaVersion: 2,
      environments: [{
        id: '11111111-1111-4111-8111-111111111111',
        label: '',
        mode: 'automatic',
        configDirectory: null,
        enabled: true
      }]
    },
    {
      schemaVersion: 2,
      environments: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          label: 'Default',
          mode: 'custom',
          configDirectory: configA,
          enabled: true
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          label: 'Second',
          mode: 'automatic',
          configDirectory: null,
          enabled: true
        }
      ]
    },
    {
      schemaVersion: 2,
      environments: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          label: 'Default',
          mode: 'automatic',
          configDirectory: null,
          enabled: true
        },
        {
          id: '11111111-1111-4111-8111-111111111111',
          label: 'Duplicate',
          mode: 'custom',
          configDirectory: configB,
          enabled: true
        }
      ]
    }
  ]) {
    const service = new configModule.ClaudeDirectoryConfigService({
      settings: {
        getStored: async () => storedValue(malformed),
        upsert: async () => 'ok'
      },
      pickDirectory: async () => null
    });
    assert.equal((await service.hydrate()).state, 'invalid',
      `expected invalid hydration for ${JSON.stringify(malformed)}`);
  }

  const oversizedService = new configModule.ClaudeDirectoryConfigService({
    settings: {
      getStored: async () => ({
        exists: true,
        valid: true,
        value: {},
        serializedValue: 'x'.repeat(65_537)
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
        schemaVersion: 2,
        environments: [{
          id: '33333333-3333-4333-8333-333333333333',
          label: 'Default',
          mode: 'custom',
          configDirectory: configA,
          enabled: true
        }]
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
  const defaultId = mutableConfig.listEnvironments()[0].id;
  assert.equal(await mutableConfig.chooseCustomDirectory({ id: defaultId }), null, 'cancel must be a no-op');
  assert.equal(persistedValues.length, 0);
  selectedDirectory = configA;
  await mutableConfig.chooseCustomDirectory({ id: defaultId });
  assert.equal(persistedValues.length, 0, 'an identical custom choice must not rewrite SQLite');
  selectedDirectory = configB;
  failPersistence = true;
  await assert.rejects(() => mutableConfig.chooseCustomDirectory({ id: defaultId }), /sqlite unavailable/);
  assert.equal(mutableConfig.listEnvironments()[0].configDirectory, configA,
    'persistence failure must leave the previously applied intent intact');
  failPersistence = false;
  const changed = await mutableConfig.chooseCustomDirectory({ id: defaultId });
  assert.equal(changed.configDirectory, configB);
  assert.equal(mutableConfig.listEnvironments()[0].configDirectory, configB);
  const automatic = await mutableConfig.useAutomatic({ id: defaultId });
  assert.deepEqual(
    { mode: automatic.mode, configDirectory: automatic.configDirectory },
    { mode: 'automatic', configDirectory: null }
  );
  assert.deepEqual(persistedValues.at(-1), {
    schemaVersion: 2,
    environments: [{ ...automatic }]
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
