// src/workflows/hawaiiDeadReckon.js
/**
 * THE HAWAII DEAD-RECKON PROBLEM SET.
 *
 * Oahu is the honest place to work this problem. Every source this app carries
 * degrades there in a way it does not degrade over a dense continental
 * receiver network, and it degrades for structural reasons rather than
 * intermittent ones:
 *
 *   - ADS-B reception is island-anchored. The moment a contact leaves the
 *     island's line of sight — the Kaiwi and Kauai channels, anything outbound
 *     over open Pacific — the only position available is PROPAGATED.
 *   - AIS is line-of-sight from shore too, and the deep-water approaches to
 *     Pearl Harbor and Honolulu Harbor run straight out of terrestrial range.
 *   - The Koolau and Waianae ranges mask low-altitude traffic from the exact
 *     sensors that would otherwise hold it.
 *   - Reachback itself is a track: Oahu's decision continuity rides a small
 *     number of submarine cable landings.
 *
 * So the interesting question on this island is never "where is the contact".
 * It is "is that an observation or an estimate, how old is the estimate, and
 * what re-acquires it". That is the problem set below.
 *
 * SCOPE. These are OBSERVATION workflows over public feeds — the same posture
 * as the rest of this repository and as the Dead Reckon project this AOR is
 * drawn from: awareness, fusion, training, and audit. Nothing here targets,
 * cues a weapon, or asserts an affiliation. A contact is a contact.
 *
 * The AOR geometry mirrors the Dead Reckon `oahu` site profile
 * (src/data/sites/oahu.ts in m4ndolore/dead-reckon) so a workflow run here and a
 * scenario replay there frame the same ground.
 *
 * Pure data plus selectors: no layer state, no DOM, no Cesium. The runner in
 * ./workflowRunner.js is what turns a step into an app action.
 */

import { COAST_STATES } from './coastState.js';

/**
 * The Oahu area of responsibility. Bounds and anchors mirror the Dead Reckon
 * `oahu` site profile; `locationId` is this app's own CITY_POIS key, which is
 * what the camera steps fly to.
 */
export const HAWAII_AOR = Object.freeze({
  id: 'oahu',
  locationId: 'hawaii',
  name: 'Oahu Defense Zone',
  center: Object.freeze({ lat: 21.35, lon: -157.95 }),
  boundingBox: Object.freeze({ north: 21.75, south: 21.10, east: -157.60, west: -158.30 }),
  /** Radius, in nautical miles, of the zone the Dead Reckon site profile draws. */
  defenseZoneRadiusNm: 10,
  /**
   * Anchors carry the zone they belong to, because half the point of this AOR
   * is what lies OUTSIDE it. An `aor` anchor sits inside the site-profile box
   * and is where a source is expected to hold; a `gap` anchor is deliberately
   * beyond it, and is where the same source is expected to stop reporting.
   */
  anchors: Object.freeze([
    Object.freeze({ id: 'jbphh', name: 'Joint Base Pearl Harbor-Hickam', lat: 21.3469, lon: -157.9724, zone: 'aor' }),
    Object.freeze({ id: 'hnl', name: 'Daniel K. Inouye International', lat: 21.3187, lon: -157.9225, zone: 'aor' }),
    Object.freeze({ id: 'pearl-entrance', name: 'Pearl Harbor Entrance Channel', lat: 21.2960, lon: -157.9760, zone: 'aor' }),
    Object.freeze({ id: 'kaneohe', name: 'MCB Hawaii Kaneohe Bay', lat: 21.4450, lon: -157.7680, zone: 'aor' }),
    Object.freeze({ id: 'kaena-point', name: 'Kaena Point', lat: 21.5750, lon: -158.2810, zone: 'aor' }),
    Object.freeze({ id: 'kaiwi-channel', name: 'Kaiwi Channel', lat: 21.2500, lon: -157.5000, zone: 'gap' }),
    Object.freeze({ id: 'kauai-channel', name: 'Kauai Channel', lat: 21.7500, lon: -158.6000, zone: 'gap' }),
  ]),
});

/**
 * The three phases every workflow below walks. Naming them is not decoration:
 * an operator who cannot say which phase they are in cannot say whether the
 * symbol under the cursor is a measurement or an extrapolation.
 *
 *   HOLD       the source is reporting. Establish the truth you will propagate.
 *   GAP        the source stops. Everything drawn from here is dead reckoned.
 *   REACQUIRE  a second source, or the first one returning, closes the estimate.
 */
export const DEAD_RECKON_PHASES = Object.freeze(['hold', 'gap', 'reacquire']);

export const WORKFLOW_STEP_KINDS = Object.freeze(['brief', 'layer', 'context', 'view', 'hold']);

export const WORKFLOW_DIFFICULTIES = Object.freeze(['introductory', 'intermediate', 'advanced']);

/**
 * @typedef {object} WorkflowStep
 * @property {'brief'|'layer'|'context'|'view'|'hold'} kind
 * @property {'hold'|'gap'|'reacquire'} phase
 * @property {string} text Operator-facing line. Every step has one.
 * @property {string} [layerId] kind=layer: registered layer id.
 * @property {boolean} [enabled] kind=layer: target visibility (default true).
 * @property {string} [mode] kind=context: 'contacts' | 'space-missions'.
 * @property {string} [locationId] kind=view: CITY_POIS key.
 * @property {number} [poiIndex] kind=view: POI within that city.
 * @property {number} [seconds] kind=hold: dwell before the next step.
 */

/**
 * @typedef {object} DeadReckonWorkflow
 * @property {string} id
 * @property {string} title
 * @property {string} problem What degrades, and why it degrades HERE.
 * @property {string} expect The honest outcome — usually a coast state, not a fix.
 * @property {string[]} coastStates Coast states this workflow should produce.
 * @property {string} difficulty
 * @property {string[]} layerIds Every layer the workflow drives, deduped.
 * @property {WorkflowStep[]} steps
 */

/** @type {ReadonlyArray<DeadReckonWorkflow>} */
export const HAWAII_DEAD_RECKON_WORKFLOWS = Object.freeze([
  Object.freeze({
    id: 'dr-channel-crossing',
    title: 'CHANNEL CROSSING',
    problem:
      'Inter-island traffic leaves Oahu receiver line-of-sight mid-channel. The '
      + 'symbol keeps moving because the client is propagating it, not because '
      + 'anything is still hearing it.',
    expect:
      'The outbound contact holds LIVE on the Oahu side, drops to COASTING over '
      + 'the channel, and comes back LIVE against the far island. Read the age, '
      + 'not the icon.',
    coastStates: Object.freeze(['live', 'coasting']),
    difficulty: 'introductory',
    layerIds: Object.freeze(['flights']),
    steps: Object.freeze([
      Object.freeze({
        kind: 'view', phase: 'hold', locationId: 'hawaii', poiIndex: 0,
        text: 'Frame the Pearl Harbor / HNL complex — the far end of every inter-island departure.',
      }),
      Object.freeze({
        kind: 'layer', phase: 'hold', layerId: 'flights', enabled: true,
        text: 'Aircraft on. Inside the island footprint these are live receiver fixes.',
      }),
      Object.freeze({
        kind: 'brief', phase: 'hold',
        text: 'Pick one outbound inter-island contact and note its callsign, heading and speed. That triple is what you will propagate.',
      }),
      Object.freeze({
        kind: 'view', phase: 'gap', locationId: 'hawaii', poiIndex: 4,
        text: 'Follow it out toward the Kaiwi Channel, past the last high ground that holds a receiver.',
      }),
      Object.freeze({
        kind: 'hold', phase: 'gap', seconds: 45,
        text: 'Watch the fix age climb. From here the position is dead reckoned from the last fix — call it COASTING out loud.',
      }),
      Object.freeze({
        kind: 'brief', phase: 'reacquire',
        text: 'Re-acquire against the far island and compare the new fix with where the propagation had drawn it. That delta is the cost of the gap.',
      }),
    ]),
  }),

  Object.freeze({
    id: 'dr-pearl-approaches',
    title: 'PEARL APPROACHES · AIS GAP',
    problem:
      'AIS is line-of-sight from shore. The deep-water approaches to Pearl Harbor '
      + 'and Honolulu Harbor run out of terrestrial range, and a vessel that stops '
      + 'reporting looks identical to one that is simply out of earshot.',
    expect:
      'A vessel track that ages past its AIS cadence and holds a stable course. '
      + 'The answer is a search area on the last course and speed, not a point.',
    coastStates: Object.freeze(['live', 'coasting', 'stale']),
    difficulty: 'intermediate',
    layerIds: Object.freeze(['ais-live-vessels']),
    steps: Object.freeze([
      Object.freeze({
        kind: 'view', phase: 'hold', locationId: 'hawaii', poiIndex: 2,
        text: 'Frame the Pearl Harbor entrance channel and the outer approaches.',
      }),
      Object.freeze({
        kind: 'layer', phase: 'hold', layerId: 'ais-live-vessels', enabled: true,
        text: 'Vessels on. Note which contacts are moving and which are alongside.',
      }),
      Object.freeze({
        kind: 'brief', phase: 'hold',
        text: 'Choose one inbound vessel. Record its course and speed over ground — the two numbers a dead-reckoned position is built from.',
      }),
      Object.freeze({
        kind: 'hold', phase: 'gap', seconds: 60,
        text: 'AIS cadence is minutes, not seconds. Let the fix age and decide when the track stops being an observation.',
      }),
      Object.freeze({
        kind: 'brief', phase: 'gap',
        text: 'Project the last course and speed forward by the fix age. Say the answer as an area with a radius, never as a position.',
      }),
      Object.freeze({
        kind: 'brief', phase: 'reacquire',
        text: 'When the next report lands, check whether it falls inside the area you called. If it did not, your speed assumption was wrong — not the feed.',
      }),
    ]),
  }),

  Object.freeze({
    id: 'dr-terrain-mask',
    title: 'TERRAIN MASK · KOOLAU INGRESS',
    problem:
      'The Koolau and Waianae ranges cut line of sight for the sensors that would '
      + 'otherwise hold a low-altitude contact. Coverage on this island is a '
      + 'terrain problem before it is a sensor problem.',
    expect:
      'You can name where the track goes dark from the terrain alone, and predict '
      + 'where it should reappear if it held course.',
    coastStates: Object.freeze(['live', 'coasting', 'stale']),
    difficulty: 'intermediate',
    layerIds: Object.freeze(['flights', 'military']),
    steps: Object.freeze([
      Object.freeze({
        kind: 'view', phase: 'hold', locationId: 'hawaii', poiIndex: 3,
        text: 'Frame the windward side and the Koolau spine behind it.',
      }),
      Object.freeze({
        kind: 'layer', phase: 'hold', layerId: 'flights', enabled: true,
        text: 'Aircraft on.',
      }),
      Object.freeze({
        kind: 'layer', phase: 'hold', layerId: 'military', enabled: true,
        text: 'Military contacts on — the windward pattern is where they work.',
      }),
      Object.freeze({
        kind: 'brief', phase: 'gap',
        text: 'Trace the ridgeline against a low-altitude track and mark the valleys where a receiver on the leeward side cannot see. Those are the gaps.',
      }),
      Object.freeze({
        kind: 'hold', phase: 'gap', seconds: 30,
        text: 'Hold on the masked segment. A track that stops updating behind terrain has not stopped flying.',
      }),
      Object.freeze({
        kind: 'brief', phase: 'reacquire',
        text: 'Nominate the reappearance window on the far side. A miss means the contact turned inside the mask — which is the whole point of flying it.',
      }),
    ]),
  }),

  Object.freeze({
    id: 'dr-overhead-cue',
    title: 'OVERHEAD CUE · CROSS-SOURCE HANDOFF',
    problem:
      'A coasting track is only closed by a DIFFERENT source. Overhead passes are '
      + 'the one cue whose availability you can compute in advance instead of '
      + 'waiting for.',
    expect:
      'A re-acquisition plan built on a pass you predicted, with the propagated '
      + 'estimate carried across the handoff and labelled as an estimate the '
      + 'whole way.',
    coastStates: Object.freeze(['coasting', 'stale']),
    difficulty: 'advanced',
    layerIds: Object.freeze(['flights', 'ais-live-vessels', 'satellites']),
    steps: Object.freeze([
      Object.freeze({
        kind: 'context', phase: 'hold', mode: 'contacts',
        text: 'Open Contacts against the AOR so the roster and the map agree on what is being held.',
      }),
      Object.freeze({
        kind: 'view', phase: 'hold', locationId: 'hawaii', poiIndex: 0,
        text: 'Centre the AOR.',
      }),
      Object.freeze({
        kind: 'layer', phase: 'hold', layerId: 'flights', enabled: true,
        text: 'Aircraft on — the roster cannot hold what the map has not loaded.',
      }),
      Object.freeze({
        kind: 'layer', phase: 'hold', layerId: 'ais-live-vessels', enabled: true,
        text: 'Vessels on. Both domains, because a handoff crosses them.',
      }),
      Object.freeze({
        kind: 'layer', phase: 'gap', layerId: 'satellites', enabled: true,
        text: 'Satellites on. The pass geometry is the cue schedule.',
      }),
      Object.freeze({
        kind: 'brief', phase: 'gap',
        text: 'Take one coasting contact from the roster and write down its last fix time, course and speed before you go looking for a cue.',
      }),
      Object.freeze({
        kind: 'brief', phase: 'reacquire',
        text: 'Find the next overhead pass across the AOR and state the window it would cue. Carry the estimate across the handoff still labelled as an estimate.',
      }),
    ]),
  }),

  Object.freeze({
    id: 'dr-reachback',
    title: 'REACHBACK · CABLE LANDINGS',
    problem:
      'Decision continuity on Oahu rides a small number of submarine cable '
      + 'landings. When reachback degrades, the operating picture itself becomes '
      + 'the coasting track — and it ages without saying so.',
    expect:
      'You can name the landings the AOR depends on and say what the console '
      + 'must show about its own freshness when they are degraded.',
    coastStates: Object.freeze(['coasting', 'stale', 'lost']),
    difficulty: 'advanced',
    layerIds: Object.freeze(['telegeography-submarine-cables', 'local-datacenters']),
    steps: Object.freeze([
      Object.freeze({
        kind: 'view', phase: 'hold', locationId: 'hawaii', poiIndex: 0,
        text: 'Centre the AOR.',
      }),
      Object.freeze({
        kind: 'layer', phase: 'hold', layerId: 'telegeography-submarine-cables', enabled: true,
        text: 'Submarine cables on. Follow the trunks that land on Oahu.',
      }),
      Object.freeze({
        kind: 'layer', phase: 'hold', layerId: 'local-datacenters', enabled: true,
        text: 'Datacenters on — where the reachback terminates.',
      }),
      Object.freeze({
        kind: 'brief', phase: 'gap',
        text: 'Count the distinct landing points. That count, not the bandwidth, is the continuity story.',
      }),
      Object.freeze({
        kind: 'brief', phase: 'reacquire',
        text: 'Write the degraded-reachback rule: with no fresh feed, every track on the board is dead reckoned and the console must say so before anyone acts on it.',
      }),
    ]),
  }),
]);

/** @type {ReadonlyArray<string>} */
export const HAWAII_WORKFLOW_IDS = Object.freeze(
  HAWAII_DEAD_RECKON_WORKFLOWS.map((workflow) => workflow.id),
);

/**
 * Look one workflow up by id.
 * @param {string} id
 * @returns {DeadReckonWorkflow|null}
 */
export function hawaiiWorkflowById(id) {
  return HAWAII_DEAD_RECKON_WORKFLOWS.find((workflow) => workflow.id === id) || null;
}

/**
 * Every layer the whole problem set drives, deduped and in first-use order.
 * This is the set a deployment has to be able to serve for the problem set to
 * be runnable end to end.
 * @param {ReadonlyArray<DeadReckonWorkflow>} [workflows]
 * @returns {string[]}
 */
export function hawaiiWorkflowLayerIds(workflows = HAWAII_DEAD_RECKON_WORKFLOWS) {
  const seen = [];
  for (const workflow of workflows) {
    for (const step of workflow.steps) {
      if (step.kind === 'layer' && step.layerId && !seen.includes(step.layerId)) {
        seen.push(step.layerId);
      }
    }
  }
  return seen;
}

/**
 * Structural validation of the catalog against the app's real layer registry.
 *
 * This exists so the catalog cannot rot silently: a renamed layer, a step kind
 * nothing implements, or a `layerIds` summary that disagrees with the steps it
 * claims to summarize all surface as a problem string rather than as a mission
 * that half-runs in front of an operator.
 *
 * @param {object} [input]
 * @param {ReadonlyArray<DeadReckonWorkflow>} [input.workflows]
 * @param {Iterable<string>} [input.registeredLayerIds] Ids the app can enable.
 * @param {Iterable<string>} [input.locationIds] CITY_POIS keys the camera knows.
 * @returns {string[]} One human-readable problem per defect; empty means clean.
 */
export function validateHawaiiWorkflows({
  workflows = HAWAII_DEAD_RECKON_WORKFLOWS,
  registeredLayerIds = null,
  locationIds = null,
} = {}) {
  const problems = [];
  const registered = registeredLayerIds ? new Set(registeredLayerIds) : null;
  const locations = locationIds ? new Set(locationIds) : null;
  const seenIds = new Set();

  for (const workflow of workflows) {
    const where = `workflow "${workflow.id}"`;
    if (!workflow.id || seenIds.has(workflow.id)) problems.push(`${where}: duplicate or missing id`);
    seenIds.add(workflow.id);
    if (!workflow.title) problems.push(`${where}: missing title`);
    if (!workflow.problem) problems.push(`${where}: missing problem statement`);
    if (!workflow.expect) problems.push(`${where}: missing expected outcome`);
    if (!WORKFLOW_DIFFICULTIES.includes(workflow.difficulty)) {
      problems.push(`${where}: unknown difficulty "${workflow.difficulty}"`);
    }
    for (const state of workflow.coastStates || []) {
      if (!COAST_STATES.includes(state)) problems.push(`${where}: unknown coast state "${state}"`);
    }
    if (!workflow.steps?.length) problems.push(`${where}: has no steps`);

    const stepLayerIds = [];
    const phases = new Set();
    for (const [index, step] of (workflow.steps || []).entries()) {
      const stepWhere = `${where} step ${index}`;
      if (!WORKFLOW_STEP_KINDS.includes(step.kind)) {
        problems.push(`${stepWhere}: unknown kind "${step.kind}"`);
      }
      if (!DEAD_RECKON_PHASES.includes(step.phase)) {
        problems.push(`${stepWhere}: unknown phase "${step.phase}"`);
      }
      // A step with no operator-facing line is a state change nobody can audit.
      if (!step.text) problems.push(`${stepWhere}: missing operator text`);
      if (step.kind === 'layer') {
        if (!step.layerId) problems.push(`${stepWhere}: layer step without layerId`);
        else {
          stepLayerIds.push(step.layerId);
          if (registered && !registered.has(step.layerId)) {
            problems.push(`${stepWhere}: unregistered layer "${step.layerId}"`);
          }
        }
      }
      if (step.kind === 'context' && !step.mode) {
        problems.push(`${stepWhere}: context step without mode`);
      }
      if (step.kind === 'view') {
        if (!step.locationId) problems.push(`${stepWhere}: view step without locationId`);
        else if (locations && !locations.has(step.locationId)) {
          problems.push(`${stepWhere}: unknown locationId "${step.locationId}"`);
        }
      }
      if (step.kind === 'hold' && !(step.seconds > 0)) {
        problems.push(`${stepWhere}: hold step without a positive duration`);
      }
      phases.add(step.phase);
    }

    // The declared summary must equal what the steps actually drive — the
    // launcher and the docs read the summary, the runner reads the steps.
    const declared = [...(workflow.layerIds || [])].sort();
    const actual = [...new Set(stepLayerIds)].sort();
    if (declared.join(',') !== actual.join(',')) {
      problems.push(`${where}: layerIds ${JSON.stringify(declared)} disagree with its steps ${JSON.stringify(actual)}`);
    }
    // Every workflow has to reach the gap: a run that never leaves HOLD has not
    // exercised dead reckoning at all.
    if (!phases.has('gap')) problems.push(`${where}: never reaches the gap phase`);
    if (!phases.has('reacquire')) problems.push(`${where}: never reaches the reacquire phase`);
  }
  return problems;
}
