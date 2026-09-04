import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createClaudeDirectoryFixture } from './claude-directory-runtime.fixture.mjs';

const fixture = await createClaudeDirectoryFixture();
const { configModule, configA, configB, fixtureRoot } = fixture;

// A settings double whose upsert records every write and whose getStored always returns the
// most recently written value (or "missing" before the first write), matching the real
// SettingDao's get-after-set behavior closely enough for this service's own persistence tests.
const createSettings = () => {
  const writes = [];
  return {
    writes,
    getStored: async () => (writes.length === 0
      ? { exists: false, valid: false, value: null, serializedValue: null }
      : {
          exists: true,
          valid: true,
          value: writes.at(-1),
          serializedValue: JSON.stringify(writes.at(-1))
        }),
    upsert: async ({ value }) => { writes.push(value); return 'ok'; }
  };
};

try {
  const logCalls = [];
  const logger = { info: (message) => logCalls.push(message) };
  let pickedDirectory = null;
  const settings = createSettings();
  const service = new configModule.ClaudeDirectoryConfigService({
    settings,
    pickDirectory: async () => pickedDirectory,
    logger
  });

  await service.hydrate();
  const [defaultEnvironment] = service.listEnvironments();
  assert.equal(defaultEnvironment.mode, 'automatic');
  assert.equal(defaultEnvironment.enabled, true);

  // add: always mode 'custom', appended after the default, fresh id.
  // Task 091/092: addEnvironment takes only the directory; the label is derived from the canonical
  // path's basename, so the caller no longer names what it just identified by path.
  const added = await service.addEnvironment({ configDirectory: configA });
  assert.equal(added.mode, 'custom');
  assert.equal(added.configDirectory, configA);
  assert.equal(added.label, 'config-a', 'the label is derived from the directory basename');
  assert.equal(added.enabled, true);
  assert.notEqual(added.id, defaultEnvironment.id);
  let environments = service.listEnvironments();
  assert.equal(environments.length, 2);
  assert.equal(environments[0].id, defaultEnvironment.id, 'the default environment must stay first');
  assert.equal(environments[1].id, added.id);
  assert.equal(environments[0].configDirectory, null,
    'adding a second environment must not mutate the default environment');

  // add validation: a nonexistent directory must be rejected without mutating state. (There is no
  // longer an empty-label case to reject — the label is derived, not supplied.)
  const writesBeforeInvalidAdd = settings.writes.length;
  await assert.rejects(() => service.addEnvironment({
    configDirectory: join(fixtureRoot, 'does-not-exist')
  }));
  assert.equal(settings.writes.length, writesBeforeInvalidAdd,
    'a rejected addEnvironment call must not persist anything');
  assert.equal(service.listEnvironments().length, 2);

  // rename: mutates only the targeted environment; an identical label is a no-op.
  await service.renameEnvironment({ id: added.id, label: 'renamed' });
  assert.equal(service.listEnvironments()[1].label, 'renamed');
  assert.equal(service.listEnvironments()[0].label, 'Default');
  const writesAfterRename = settings.writes.length;
  await service.renameEnvironment({ id: added.id, label: 'renamed' });
  assert.equal(settings.writes.length, writesAfterRename,
    'renaming to the same label must not rewrite the setting');
  await assert.rejects(() => service.renameEnvironment({ id: 'unknown', label: 'x' }));

  // setEnvironmentEnabled: mutates only the targeted environment; an identical value is a no-op.
  await service.setEnvironmentEnabled({ id: added.id, enabled: false });
  assert.equal(service.listEnvironments()[1].enabled, false);
  assert.equal(service.listEnvironments()[0].enabled, true);
  const writesAfterDisable = settings.writes.length;
  await service.setEnvironmentEnabled({ id: added.id, enabled: false });
  assert.equal(settings.writes.length, writesAfterDisable,
    'setting the same enabled value must not rewrite the setting');
  await service.setEnvironmentEnabled({ id: added.id, enabled: true });
  assert.equal(service.listEnvironments()[1].enabled, true);

  // Task 092: setCustomDirectory takes the pasted path and mutates only the targeted environment.
  const chosen = await service.setCustomDirectory({ id: added.id, configDirectory: configB });
  assert.equal(chosen.configDirectory, configB);
  assert.equal(service.listEnvironments()[1].configDirectory, configB);
  assert.equal(service.listEnvironments()[0].configDirectory, null,
    'setCustomDirectory on the second environment must not touch the default environment');
  // Repointing must NOT re-derive the label — a user who renamed this environment keeps that name.
  assert.equal(service.listEnvironments()[1].label, 'renamed',
    'changing the directory must not overwrite a user-chosen label');
  const writesAfterSameDirectory = settings.writes.length;
  await service.setCustomDirectory({ id: added.id, configDirectory: configB });
  assert.equal(settings.writes.length, writesAfterSameDirectory,
    'setting the same directory must not rewrite the setting');
  await assert.rejects(
    () => service.setCustomDirectory({ id: 'unknown', configDirectory: configB }),
    /Claude environment was not found/
  );
  await assert.rejects(
    () => service.setCustomDirectory({ id: added.id, configDirectory: join(fixtureRoot, 'nope') }),
    'a nonexistent directory must be rejected'
  );
  // The picker entry point survives for the legacy sentinel path and now delegates to the same
  // persist logic, so a cancelled picker is still a no-op.
  pickedDirectory = null;
  assert.equal(await service.chooseCustomDirectory({ id: added.id }), null, 'a cancelled picker is a no-op');

  // useAutomatic: only the default (environments[0]) is eligible.
  await assert.rejects(
    () => service.useAutomatic({ id: added.id }),
    /Only the default Claude environment/,
    'useAutomatic on a non-default environment must reject with a clear error'
  );
  assert.equal(service.listEnvironments()[1].mode, 'custom',
    'a rejected useAutomatic call must not mutate the target environment');
  // Switch the default environment to custom and back so useAutomatic exercises a genuine
  // automatic <- custom mode change (a no-op mode change must not persist or log).
  await service.setCustomDirectory({ id: defaultEnvironment.id, configDirectory: configA });
  assert.equal(service.listEnvironments()[0].mode, 'custom');
  pickedDirectory = null;
  const automatic = await service.useAutomatic({ id: defaultEnvironment.id });
  assert.equal(automatic.mode, 'automatic');
  assert.equal(automatic.configDirectory, null);
  const writesBeforeNoopAutomatic = settings.writes.length;
  await service.useAutomatic({ id: defaultEnvironment.id });
  assert.equal(settings.writes.length, writesBeforeNoopAutomatic,
    'useAutomatic on an already-automatic environment must not rewrite the setting');

  // removeEnvironment: only the last remaining environment cannot be removed.
  await assert.rejects(() => service.removeEnvironment({ id: 'unknown' }), /was not found/);
  const writesBeforeRemove = settings.writes.length;
  await service.removeEnvironment({ id: defaultEnvironment.id });
  assert.equal(settings.writes.length, writesBeforeRemove + 1);
  environments = service.listEnvironments();
  assert.equal(environments.length, 1);
  assert.equal(environments[0].id, added.id);

  const writesBeforeLastRemoval = settings.writes.length;
  await assert.rejects(
    () => service.removeEnvironment({ id: added.id }),
    /last remaining Claude environment cannot be removed/
  );
  assert.equal(settings.writes.length, writesBeforeLastRemoval,
    'a rejected last-environment removal must not persist or mutate state');
  assert.deepEqual(service.listEnvironments().map((environment) => environment.id), [added.id]);

  // Logging: every lifecycle mutation above logged a [claude-environment] line carrying only
  // id/label — never a configDirectory value.
  assert.ok(logCalls.length > 0);
  for (const message of logCalls) {
    assert.match(message, /^\[claude-environment\] action=\S+ id=\S+ label="/);
    assert.doesNotMatch(message, new RegExp(configA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(message, new RegExp(configB.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const actions = logCalls.map((message) => /action=(\S+)/.exec(message)[1]);
  for (const expected of ['add', 'rename', 'disable', 'enable', 'directory-change', 'mode-change', 'remove']) {
    assert.ok(actions.includes(expected), `expected a logged "${expected}" action, saw: ${actions.join(',')}`);
  }

  console.log('EyesOnAgents Claude environment config tests passed');
} finally {
  fixture.cleanup();
}
