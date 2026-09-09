#!/usr/bin/env node
/**
 * Validate the Hawaii dead-reckon problem set against the app's LIVE registries.
 *
 * The catalog in src/workflows/hawaiiDeadReckon.js is data, and data rots
 * quietly: a layer renamed in layerState.js, a location dropped from CITY_POIS,
 * or a trimmed voice enum would leave a mission that half-runs in front of an
 * operator and still reports success. That is the same failure the problem set
 * is about, so it gets its own gate.
 *
 * Run it locally with `npm run hawaii:validate`; CI runs it on every change to
 * the catalog or to anything the catalog points at.
 */
import fs from 'node:fs';
import process from 'node:process';

import {
  HAWAII_AOR,
  HAWAII_DEAD_RECKON_WORKFLOWS,
  hawaiiWorkflowLayerIds,
  validateHawaiiWorkflows,
} from '../src/workflows/hawaiiDeadReckon.js';
import { REGISTERED_LAYER_IDS } from '../src/data/layerState.js';
import { CITY_POIS } from '../src/locations.js';

const problems = validateHawaiiWorkflows({
  registeredLayerIds: REGISTERED_LAYER_IDS,
  locationIds: Object.keys(CITY_POIS),
});

// The voice enum is a NARROWER gate than the layer registry: a layer outside it
// cannot be reached by the hands-free path these workflows are meant to be run
// from, so a workflow that drives one is not actually runnable as designed.
const config = fs.readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
const tool = config.slice(
  config.indexOf("name: 'set_layer_visibility'"),
  config.indexOf("name: 'show_data_layers_menu'"),
);
for (const layerId of hawaiiWorkflowLayerIds()) {
  if (!tool.includes(`'${layerId}'`)) {
    problems.push(`layer "${layerId}" is driven by a workflow but is not in the set_layer_visibility enum`);
  }
}

if (problems.length) {
  console.error(`Hawaii problem set is INVALID (${problems.length} problem(s)):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`AOR       ${HAWAII_AOR.name} (${HAWAII_AOR.id}) via CITY_POIS.${HAWAII_AOR.locationId}`);
console.log(`workflows ${HAWAII_DEAD_RECKON_WORKFLOWS.length}`);
for (const workflow of HAWAII_DEAD_RECKON_WORKFLOWS) {
  console.log(`  ${workflow.id.padEnd(22)} ${workflow.difficulty.padEnd(13)} ${workflow.steps.length} steps  [${workflow.layerIds.join(', ')}]`);
}
console.log(`layers    ${hawaiiWorkflowLayerIds().join(', ')}`);
