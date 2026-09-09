// src/workflows/workflowRunner.js
/**
 * Runs one dead-reckon workflow against the app's existing facades.
 *
 * The runner deliberately owns NO app state. It is handed the same three
 * facades the first-run mission launcher uses — setContextMode, setLayerEnabled,
 * flyToLocation — plus a wait, and it turns a step list into calls on them. That
 * keeps layer-state ownership, persistence origin, and Contacts arbitration in
 * the one place that already gets them right, and keeps this module importable
 * under `node --test`.
 *
 * TWO RULES CARRY THE WHOLE DESIGN:
 *
 * 1. FRAMING NEVER FAILS A RUN. A camera flight is how the operator is shown
 *    the problem, not the problem itself. A superseded or refused flight (the
 *    operator grabbed the camera, Cockpit owns it, the app is mid-transition)
 *    leaves the run OK and the workflow continues. Only a layer or context step
 *    that could not be established can fail a run, because those are the
 *    conditions the observation depends on.
 *
 * 2. A RUN THAT STOPS EARLY SAYS SO. Every step returns an outcome, the run
 *    accumulates them, and an aborted run reports the step it reached. An
 *    operator must never be left looking at a half-established picture that the
 *    interface is presenting as the whole workflow — that is the same failure
 *    the problem set is about.
 */

import { hawaiiWorkflowById } from './hawaiiDeadReckon.js';

/** Steps whose failure is advisory rather than fatal to a run. */
export const ADVISORY_STEP_KINDS = Object.freeze(['view', 'brief', 'hold']);

/**
 * Default dwell implementation. Injected in tests so a 60-second hold does not
 * cost 60 seconds of suite time.
 * @param {number} ms
 * @param {{aborted?: boolean, addEventListener?: Function}} [signal]
 * @returns {Promise<void>}
 */
function defaultWait(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Node keeps the process alive for a pending timer; a browser does not care.
    timer?.unref?.();
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/**
 * Execute exactly one step. Never throws: a thrown facade becomes ok:false with
 * the error attached, because one broken layer must not abandon the operator
 * mid-workflow with no explanation.
 *
 * @param {object} step
 * @param {object} deps
 * @param {(mode: string) => Promise<any>} [deps.setContextMode]
 * @param {(layerId: string, enabled: boolean) => Promise<any>} [deps.setLayerEnabled]
 * @param {(locationId: string, poiIndex: number) => Promise<any>} [deps.flyToLocation]
 * @param {(ms: number, signal?: object) => Promise<void>} [deps.wait]
 * @param {boolean} [deps.skipHolds] Report holds without sitting them out.
 * @param {object} [deps.signal] AbortSignal-shaped cancel handle.
 * @returns {Promise<{ok: boolean, kind: string, advisory: boolean, detail?: object, error?: Error}>}
 */
export async function runWorkflowStep(step, deps = {}) {
  const advisory = ADVISORY_STEP_KINDS.includes(step?.kind);
  const base = { kind: step?.kind, phase: step?.phase, advisory };
  const {
    setContextMode, setLayerEnabled, flyToLocation, wait = defaultWait, skipHolds = false, signal,
  } = deps;
  try {
    switch (step?.kind) {
      case 'brief':
        // Nothing to establish — the text IS the step. It is reported so a
        // caller can render the brief and so a run log shows what was asked.
        return { ...base, ok: true };
      case 'layer': {
        if (typeof setLayerEnabled !== 'function') return { ...base, ok: false, reason: 'no-setLayerEnabled' };
        const enabled = step.enabled !== false;
        const result = await setLayerEnabled(step.layerId, enabled);
        // The DataManager facade reports failure as an explicit `false`; any
        // other shape (undefined, a handle, a result object) means it took.
        return { ...base, ok: result !== false, layerId: step.layerId, enabled, detail: result };
      }
      case 'context': {
        if (typeof setContextMode !== 'function') return { ...base, ok: false, reason: 'no-setContextMode' };
        const result = await setContextMode(step.mode);
        return { ...base, ok: Boolean(result?.ok), mode: step.mode, detail: result };
      }
      case 'view': {
        if (typeof flyToLocation !== 'function') return { ...base, ok: false, reason: 'no-flyToLocation' };
        const result = await flyToLocation(step.locationId, step.poiIndex ?? 0);
        return { ...base, ok: result !== false, locationId: step.locationId, detail: result };
      }
      case 'hold': {
        // A dwell belongs to the OPERATOR, not to whatever staged the picture.
        // The first-run launcher stages a workflow behind a modal card, and a
        // 45-second wait there is a hung tile, not an observation — so it skips
        // the sitting-out while still surfacing the brief that says to watch.
        if (!skipHolds) await wait(Math.max(0, (step.seconds || 0) * 1000), signal);
        return { ...base, ok: true, seconds: step.seconds, skipped: skipHolds };
      }
      default:
        return { ...base, ok: false, reason: 'unknown-step-kind' };
    }
  } catch (error) {
    return { ...base, ok: false, error };
  }
}

/**
 * Run a whole workflow, in order.
 *
 * Steps run SEQUENTIALLY on purpose. The problem set is about time — a hold that
 * lets a fix age, then a re-frame — and firing the steps concurrently would
 * collapse exactly the interval the operator is supposed to watch.
 *
 * @param {string|object} workflowOrId
 * @param {object} deps See runWorkflowStep, plus:
 * @param {(update: object) => void} [deps.onStep] Progress sink (render the brief).
 * @param {object} [deps.signal] AbortSignal-shaped cancel handle.
 * @returns {Promise<{ok: boolean, id: string, aborted: boolean, steps: object[], failed: object[]}>}
 */
export async function runHawaiiWorkflow(workflowOrId, deps = {}) {
  const workflow = typeof workflowOrId === 'string'
    ? hawaiiWorkflowById(workflowOrId)
    : workflowOrId;
  if (!workflow?.steps?.length) {
    return { ok: false, id: String(workflowOrId?.id ?? workflowOrId ?? ''), aborted: false, steps: [], failed: [], reason: 'unknown-workflow' };
  }
  const { onStep, signal } = deps;
  const steps = [];
  let aborted = false;

  for (const [index, step] of workflow.steps.entries()) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }
    onStep?.({ phase: 'start', index, total: workflow.steps.length, step });
    const outcome = { index, step, ...(await runWorkflowStep(step, deps)) };
    steps.push(outcome);
    onStep?.({ phase: 'done', index, total: workflow.steps.length, step, outcome });
  }

  // Advisory failures are recorded but never decide the verdict — see rule 1.
  const failed = steps.filter((outcome) => !outcome.ok && !outcome.advisory);
  return {
    ok: !aborted && failed.length === 0 && steps.length === workflow.steps.length,
    id: workflow.id,
    aborted,
    steps,
    failed,
  };
}

/**
 * Compact, operator-readable summary of a finished run. Used by the launcher
 * status line and by anything that logs a run: it names what did NOT establish,
 * because that is the part an operator has to know before reading the map.
 * @param {{ok: boolean, aborted: boolean, steps: object[], failed: object[]}} run
 * @returns {string}
 */
export function summarizeWorkflowRun(run) {
  if (!run) return 'No run.';
  if (run.aborted) return `Stopped after ${run.steps.length} step(s).`;
  if (run.ok) return `Ran ${run.steps.length} step(s).`;
  const names = run.failed.map((outcome) => outcome.layerId || outcome.mode || outcome.kind);
  const advisory = run.steps.filter((outcome) => !outcome.ok && outcome.advisory).length;
  const tail = advisory ? ` (${advisory} framing step(s) also did not complete)` : '';
  return names.length
    ? `Could not establish: ${names.join(', ')}.${tail}`
    : `Run incomplete.${tail}`;
}
