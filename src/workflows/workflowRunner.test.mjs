import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADVISORY_STEP_KINDS,
  runHawaiiWorkflow,
  runWorkflowStep,
  summarizeWorkflowRun,
} from './workflowRunner.js';
import { HAWAII_DEAD_RECKON_WORKFLOWS, hawaiiWorkflowById } from './hawaiiDeadReckon.js';

/** A spy over the three app facades, with an instant wait. */
function facades(overrides = {}) {
  const calls = { layers: [], contexts: [], views: [], waits: [] };
  return {
    calls,
    deps: {
      setLayerEnabled: async (layerId, enabled) => {
        calls.layers.push({ layerId, enabled });
        return overrides.layerResult?.(layerId) ?? true;
      },
      setContextMode: async (mode) => {
        calls.contexts.push(mode);
        return overrides.contextResult?.(mode) ?? { ok: true };
      },
      flyToLocation: async (locationId, poiIndex) => {
        calls.views.push({ locationId, poiIndex });
        return overrides.viewResult?.(locationId) ?? true;
      },
      wait: async (ms) => { calls.waits.push(ms); },
      ...overrides.deps,
    },
  };
}

test('a brief step establishes nothing and still reports itself', async () => {
  const spy = facades();
  const outcome = await runWorkflowStep({ kind: 'brief', phase: 'hold', text: 'read this' }, spy.deps);
  assert.equal(outcome.ok, true);
  assert.deepEqual(spy.calls, { layers: [], contexts: [], views: [], waits: [] });
});

test('a layer step reads the DataManager contract: only an explicit false is a failure', async () => {
  const spy = facades({ layerResult: (id) => (id === 'flights' ? undefined : false) });
  const ok = await runWorkflowStep({ kind: 'layer', phase: 'hold', layerId: 'flights' }, spy.deps);
  const bad = await runWorkflowStep({ kind: 'layer', phase: 'hold', layerId: 'cctv' }, spy.deps);
  assert.equal(ok.ok, true, 'undefined means the facade took the call');
  assert.equal(bad.ok, false);
  assert.deepEqual(spy.calls.layers, [
    { layerId: 'flights', enabled: true },
    { layerId: 'cctv', enabled: true },
  ]);
});

test('a layer step can turn a layer OFF, and says which way it went', async () => {
  const spy = facades();
  const outcome = await runWorkflowStep(
    { kind: 'layer', phase: 'gap', layerId: 'traffic', enabled: false }, spy.deps,
  );
  assert.equal(outcome.enabled, false);
  assert.deepEqual(spy.calls.layers, [{ layerId: 'traffic', enabled: false }]);
});

test('a context step is only OK when the facade reports ok', async () => {
  const spy = facades({ contextResult: () => ({ ok: false, failedLayerIds: ['flights'] }) });
  const outcome = await runWorkflowStep({ kind: 'context', phase: 'hold', mode: 'contacts' }, spy.deps);
  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.detail.failedLayerIds, ['flights']);
});

test('a hold waits the step duration in milliseconds and never negative', async () => {
  const spy = facades();
  await runWorkflowStep({ kind: 'hold', phase: 'gap', seconds: 45 }, spy.deps);
  await runWorkflowStep({ kind: 'hold', phase: 'gap', seconds: -12 }, spy.deps);
  await runWorkflowStep({ kind: 'hold', phase: 'gap' }, spy.deps);
  assert.deepEqual(spy.calls.waits, [45_000, 0, 0]);
});

test('a thrown facade becomes a reported failure, not an escaped exception', async () => {
  const boom = new Error('layer exploded');
  const outcome = await runWorkflowStep({ kind: 'layer', phase: 'hold', layerId: 'flights' }, {
    setLayerEnabled: async () => { throw boom; },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, boom);
});

test('a missing facade fails that step by name rather than crashing the run', async () => {
  for (const [step, reason] of [
    [{ kind: 'layer', layerId: 'flights' }, 'no-setLayerEnabled'],
    [{ kind: 'context', mode: 'contacts' }, 'no-setContextMode'],
    [{ kind: 'view', locationId: 'hawaii' }, 'no-flyToLocation'],
  ]) {
    const outcome = await runWorkflowStep(step, {});
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, reason);
  }
});

test('an unknown step kind fails loudly instead of silently passing', async () => {
  const outcome = await runWorkflowStep({ kind: 'teleport', phase: 'gap' }, facades().deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'unknown-step-kind');
});

test('a whole shipped workflow runs its steps in order, sequentially', async () => {
  const spy = facades();
  const order = [];
  const run = await runHawaiiWorkflow('dr-channel-crossing', {
    ...spy.deps,
    onStep: (update) => { if (update.phase === 'done') order.push(update.step.kind); },
  });
  const workflow = hawaiiWorkflowById('dr-channel-crossing');
  assert.equal(run.ok, true);
  assert.equal(run.steps.length, workflow.steps.length);
  assert.deepEqual(order, workflow.steps.map((step) => step.kind));
  assert.deepEqual(spy.calls.layers, [{ layerId: 'flights', enabled: true }]);
  assert.deepEqual(spy.calls.views, [
    { locationId: 'hawaii', poiIndex: 0 },
    { locationId: 'hawaii', poiIndex: 4 },
  ]);
});

test('every shipped workflow runs clean against healthy facades', async () => {
  for (const workflow of HAWAII_DEAD_RECKON_WORKFLOWS) {
    const spy = facades();
    const run = await runHawaiiWorkflow(workflow.id, spy.deps);
    assert.equal(run.ok, true, `${workflow.id} did not complete: ${summarizeWorkflowRun(run)}`);
    assert.deepEqual(run.failed, []);
  }
});

test('framing never fails a run — a refused camera flight is not a failed mission', async () => {
  // The operator grabbed the camera, or Cockpit owns it. The observation is
  // still established; only the framing was declined.
  const spy = facades({ viewResult: () => false });
  const run = await runHawaiiWorkflow('dr-channel-crossing', spy.deps);
  assert.equal(run.ok, true);
  assert.deepEqual(run.failed, []);
  assert.equal(run.steps.filter((outcome) => !outcome.ok).length, 2, 'the refusals are still recorded');
  assert.match(summarizeWorkflowRun(run), /Ran \d+ step/);
});

test('a failed LAYER does fail the run, and the summary names it', async () => {
  const spy = facades({ layerResult: (id) => (id === 'flights' ? false : true) });
  const run = await runHawaiiWorkflow('dr-terrain-mask', spy.deps);
  assert.equal(run.ok, false);
  assert.deepEqual(run.failed.map((outcome) => outcome.layerId), ['flights']);
  assert.match(summarizeWorkflowRun(run), /Could not establish: flights/);
});

test('a run continues past a failed step so the operator sees the whole verdict', async () => {
  // Bailing on the first failure would leave a half-built picture and no
  // account of what else was wrong with it.
  const spy = facades({ layerResult: () => false });
  const run = await runHawaiiWorkflow('dr-reachback', spy.deps);
  const workflow = hawaiiWorkflowById('dr-reachback');
  assert.equal(run.steps.length, workflow.steps.length);
  assert.equal(run.failed.length, 2);
});

test('an aborted run stops where it stopped and reports the stop', async () => {
  const controller = new AbortController();
  const spy = facades();
  const run = await runHawaiiWorkflow('dr-pearl-approaches', {
    ...spy.deps,
    signal: controller.signal,
    onStep: (update) => { if (update.phase === 'done' && update.index === 1) controller.abort(); },
  });
  assert.equal(run.aborted, true);
  assert.equal(run.ok, false);
  assert.equal(run.steps.length, 2);
  assert.match(summarizeWorkflowRun(run), /Stopped after 2 step/);
});

test('an unknown workflow is refused rather than run as an empty success', async () => {
  const run = await runHawaiiWorkflow('dr-nope', facades().deps);
  assert.equal(run.ok, false);
  assert.equal(run.reason, 'unknown-workflow');
  assert.deepEqual(run.steps, []);
});

test('advisory kinds are exactly the ones that must not fail a run', () => {
  assert.deepEqual([...ADVISORY_STEP_KINDS].sort(), ['brief', 'hold', 'view']);
});

test('the default wait really does wait, and an abort cuts it short', async () => {
  // Guards the un-injected path the app actually ships with.
  const controller = new AbortController();
  const started = Date.now();
  const pending = runWorkflowStep({ kind: 'hold', phase: 'gap', seconds: 30 }, { signal: controller.signal });
  controller.abort();
  const outcome = await pending;
  assert.equal(outcome.ok, true);
  assert.ok(Date.now() - started < 5000, 'an aborted hold must not sit out its full duration');
});

test('summaries never claim more than the run did', () => {
  assert.equal(summarizeWorkflowRun(null), 'No run.');
  assert.match(summarizeWorkflowRun({ ok: false, aborted: false, steps: [{ ok: false, advisory: true }], failed: [] }),
    /Run incomplete\..*framing/);
});

test('skipHolds reports the dwell without sitting it out', async () => {
  // What the first-run launcher does: stage the picture now, leave the watching
  // to the operator. The brief still comes through so nobody loses the step.
  const spy = facades();
  const seen = [];
  const run = await runHawaiiWorkflow('dr-channel-crossing', {
    ...spy.deps,
    skipHolds: true,
    onStep: (update) => { if (update.phase === 'done') seen.push(update.outcome); },
  });
  assert.equal(run.ok, true);
  assert.deepEqual(spy.calls.waits, [], 'no dwell may be spent behind a modal');
  const hold = seen.find((outcome) => outcome.kind === 'hold');
  assert.equal(hold.skipped, true);
  assert.equal(hold.seconds, 45, 'the dwell the operator owes is still reported');
});
