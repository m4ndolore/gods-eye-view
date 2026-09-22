import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  DEAD_RECKON_PHASES,
  HAWAII_AOR,
  HAWAII_DEAD_RECKON_WORKFLOWS,
  HAWAII_WORKFLOW_IDS,
  WORKFLOW_STEP_KINDS,
  hawaiiWorkflowById,
  hawaiiWorkflowLayerIds,
  validateHawaiiWorkflows,
} from './hawaiiDeadReckon.js';
import { COAST_STATES } from './coastState.js';
import { REGISTERED_LAYER_IDS } from '../data/layerState.js';
import { CITY_POIS } from '../locations.js';

test('the AOR frames Oahu, and its gap anchors really are outside it', () => {
  const { boundingBox, center, anchors } = HAWAII_AOR;
  assert.ok(boundingBox.north > boundingBox.south);
  assert.ok(boundingBox.east > boundingBox.west);
  assert.ok(center.lat > boundingBox.south && center.lat < boundingBox.north);
  assert.ok(center.lon > boundingBox.west && center.lon < boundingBox.east);
  const inside = (anchor) => anchor.lat >= boundingBox.south && anchor.lat <= boundingBox.north
    && anchor.lon >= boundingBox.west && anchor.lon <= boundingBox.east;
  for (const anchor of anchors) {
    if (anchor.zone === 'aor') {
      assert.ok(inside(anchor), `${anchor.id} claims to be in the AOR but falls outside it`);
    } else if (anchor.zone === 'gap') {
      // A gap anchor that is inside the box is not a gap — it is the thing the
      // workflows say the sensors still hold, and the problem set evaporates.
      assert.ok(!inside(anchor), `${anchor.id} is declared a gap but sits inside coverage`);
    } else {
      assert.fail(`${anchor.id} has no zone`);
    }
  }
  assert.ok(anchors.some((anchor) => anchor.zone === 'gap'), 'the AOR needs at least one gap anchor');
});

test('the AOR points at a location this app can actually fly to', () => {
  // A workflow whose camera step names a city that CITY_POIS does not carry is
  // a mission that silently never frames the problem.
  assert.ok(CITY_POIS[HAWAII_AOR.locationId], 'HAWAII_AOR.locationId must be a CITY_POIS key');
});

test('the catalog is structurally valid against the real layer and location registries', () => {
  const problems = validateHawaiiWorkflows({
    registeredLayerIds: REGISTERED_LAYER_IDS,
    locationIds: Object.keys(CITY_POIS),
  });
  assert.deepEqual(problems, []);
});

test('the validator actually catches the defects it claims to', () => {
  const broken = [{
    id: 'broken', title: 'T', problem: 'P', expect: 'E',
    difficulty: 'nonsense', coastStates: ['sideways'], layerIds: ['flights'],
    steps: [
      { kind: 'teleport', phase: 'hold', text: 'x' },
      { kind: 'layer', phase: 'hold', layerId: 'no-such-layer', text: 'x' },
      { kind: 'view', phase: 'hold', locationId: 'atlantis', text: 'x' },
      { kind: 'hold', phase: 'hold', seconds: 0, text: 'x' },
      { kind: 'brief', phase: 'hold' },
    ],
  }];
  const problems = validateHawaiiWorkflows({
    workflows: broken,
    registeredLayerIds: REGISTERED_LAYER_IDS,
    locationIds: Object.keys(CITY_POIS),
  });
  const joined = problems.join('\n');
  assert.match(joined, /unknown difficulty/);
  assert.match(joined, /unknown coast state/);
  assert.match(joined, /unknown kind "teleport"/);
  assert.match(joined, /unregistered layer "no-such-layer"/);
  assert.match(joined, /unknown locationId "atlantis"/);
  assert.match(joined, /hold step without a positive duration/);
  assert.match(joined, /missing operator text/);
  assert.match(joined, /layerIds .* disagree with its steps/);
  assert.match(joined, /never reaches the gap phase/);
  assert.match(joined, /never reaches the reacquire phase/);
});

test('every workflow walks hold → gap → reacquire, in that order', () => {
  for (const workflow of HAWAII_DEAD_RECKON_WORKFLOWS) {
    const order = workflow.steps.map((step) => DEAD_RECKON_PHASES.indexOf(step.phase));
    for (let i = 1; i < order.length; i += 1) {
      assert.ok(order[i] >= order[i - 1], `${workflow.id} steps back into an earlier phase at ${i}`);
    }
    assert.equal(order[0], 0, `${workflow.id} must start by establishing the hold`);
    assert.ok(order.includes(2), `${workflow.id} must reach reacquire`);
  }
});

test('every workflow says what degrades and what the honest answer looks like', () => {
  for (const workflow of HAWAII_DEAD_RECKON_WORKFLOWS) {
    assert.ok(workflow.problem.length > 40, `${workflow.id}: problem statement is too thin to brief from`);
    assert.ok(workflow.expect.length > 40, `${workflow.id}: expected outcome is too thin to score against`);
    assert.ok(workflow.coastStates.length > 0, `${workflow.id}: names no coast state`);
    for (const state of workflow.coastStates) assert.ok(COAST_STATES.includes(state));
  }
});

test('no workflow claims a fix where the point is that there is no fix', () => {
  // The whole problem set exists because a propagated position is not an
  // observation. A workflow whose expected outcome is a live position has
  // quietly reintroduced the lie.
  for (const workflow of HAWAII_DEAD_RECKON_WORKFLOWS) {
    assert.ok(
      workflow.coastStates.some((state) => state !== 'live'),
      `${workflow.id} never leaves live and so exercises no dead reckoning`,
    );
  }
});

test('ids are unique, stable and addressable', () => {
  assert.equal(new Set(HAWAII_WORKFLOW_IDS).size, HAWAII_WORKFLOW_IDS.length);
  for (const id of HAWAII_WORKFLOW_IDS) {
    assert.equal(hawaiiWorkflowById(id)?.id, id);
    assert.match(id, /^dr-[a-z-]+$/, 'ids are the stable handle docs and CI reference');
  }
  assert.equal(hawaiiWorkflowById('nope'), null);
  assert.equal(hawaiiWorkflowById(undefined), null);
});

test('the problem set drives only layers the app registers AND voice can enable', () => {
  const layerIds = hawaiiWorkflowLayerIds();
  assert.ok(layerIds.length > 0);
  const registered = new Set(REGISTERED_LAYER_IDS);
  // The voice tool's enum is the narrower gate: a layer outside it cannot be
  // reached by the hands-free path these workflows are meant to be run from.
  const config = fs.readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  const tool = config.slice(
    config.indexOf("name: 'set_layer_visibility'"),
    config.indexOf("name: 'show_data_layers_menu'"),
  );
  for (const layerId of layerIds) {
    assert.ok(registered.has(layerId), `${layerId} is not a registered layer`);
    assert.ok(tool.includes(`'${layerId}'`), `${layerId} is not in the set_layer_visibility enum`);
  }
});

test('step kinds are exactly the ones the runner implements', async () => {
  const runner = await import('./workflowRunner.js');
  const source = fs.readFileSync(new URL('./workflowRunner.js', import.meta.url), 'utf8');
  for (const kind of WORKFLOW_STEP_KINDS) {
    assert.ok(source.includes(`case '${kind}'`), `runWorkflowStep has no branch for "${kind}"`);
  }
  // And the advisory list may only name kinds that exist.
  for (const kind of runner.ADVISORY_STEP_KINDS) {
    assert.ok(WORKFLOW_STEP_KINDS.includes(kind), `${kind} is advisory but is not a step kind`);
  }
});

test('the AOR geometry stays in step with the Dead Reckon site profile it mirrors', () => {
  // Recorded here because the two repositories are the reason these numbers are
  // what they are: a drift on either side has to be a deliberate edit here.
  assert.equal(HAWAII_AOR.id, 'oahu');
  assert.equal(HAWAII_AOR.defenseZoneRadiusNm, 10);
  assert.deepEqual({ ...HAWAII_AOR.center }, { lat: 21.35, lon: -157.95 });
  assert.deepEqual({ ...HAWAII_AOR.boundingBox }, {
    north: 21.75, south: 21.10, east: -157.60, west: -158.30,
  });
  const anchorIds = HAWAII_AOR.anchors.map((anchor) => anchor.id);
  assert.ok(anchorIds.includes('jbphh') && anchorIds.includes('hnl'));
});

test('the problem set stays an observation posture — no targeting vocabulary', () => {
  // Same posture as the Dead Reckon project this AOR comes from: awareness,
  // fusion, training and audit. This assertion is the tripwire on scope drift.
  const source = fs.readFileSync(new URL('./hawaiiDeadReckon.js', import.meta.url), 'utf8');
  const briefs = HAWAII_DEAD_RECKON_WORKFLOWS.flatMap(
    (workflow) => [workflow.title, workflow.problem, workflow.expect, ...workflow.steps.map((step) => step.text)],
  ).join('\n').toLowerCase();
  for (const word of ['engage', 'weapon', 'strike', 'kill', 'hostile', 'intercept']) {
    assert.ok(!briefs.includes(word), `workflow copy must not read as targeting ("${word}")`);
  }
  assert.match(source, /SCOPE\./);
});
