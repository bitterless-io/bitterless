import assert from 'node:assert/strict';
import test from 'node:test';
import { OnlyPreviewDeferredIndexService } from '../../src/renderer/onlypreview/shell/src/onlyPreviewDeferredIndex.service.ts';

const createHarness = () => {
  const scheduled = [];
  const events = [];
  let now = 0;
  let sequence = 0;
  const diagnostics = {
    nextTag: (prefix) => `${prefix}${++sequence}`,
    now: () => now,
    elapsed: (startedAt) => now - startedAt,
    emit: (event, fields) => {
      events.push({ event, ...fields });
      return true;
    }
  };
  const service = new OnlyPreviewDeferredIndexService(
    diagnostics,
    (run) => scheduled.push(run)
  );
  return {
    events,
    scheduled,
    service,
    setNow: (value) => { now = value; }
  };
};

test('restored Project index dispatch is queued without a renderer timer', async () => {
  const harness = createHarness();
  let runs = 0;

  await harness.service.run(true, () => true, () => { runs += 1; });

  assert.equal(runs, 0);
  assert.equal(harness.scheduled.length, 1);
  assert.deepEqual(harness.events.map(({ phase }) => phase), ['scheduled']);

  harness.setNow(1);
  harness.scheduled.shift()();
  assert.equal(runs, 1);
  assert.deepEqual(harness.events.map(({ phase }) => phase), ['scheduled', 'start']);
});

test('workspace replacement cancels the queued generation and keeps a single current kickoff', async () => {
  const harness = createHarness();
  let staleRuns = 0;
  let currentRuns = 0;

  await harness.service.run(true, () => true, () => { staleRuns += 1; });
  assert.equal(harness.service.cancel(), true);
  await harness.service.run(false, () => true, () => { currentRuns += 1; });
  harness.scheduled.shift()();

  assert.equal(staleRuns, 0);
  assert.equal(currentRuns, 1);
  assert.deepEqual(harness.events.map(({ phase }) => phase), ['scheduled', 'cancel']);
});
