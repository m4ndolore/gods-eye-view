// src/workflows/coastState.js
/**
 * DEAD-RECKON COAST STATE — the honesty contract for a track that has stopped
 * reporting.
 *
 * Every live layer in this app renders a position that is, strictly, a PAST
 * position propagated forward: flights are drawn one polling interval behind so
 * the client can interpolate, and an AIS or ADS-B fix over open water can be
 * minutes old. That is dead reckoning, and it is fine — right up until the
 * interface implies the propagated position is a fresh observation.
 *
 * This module owns the one vocabulary that separates the two. It is pure math on
 * a timestamp: no layer state, no DOM, no Cesium, importable under `node --test`.
 *
 * The states are deliberately coarse, because an operator reads them at kiosk
 * distance and has to act on them:
 *
 *   LIVE      the newest fix is inside the source's own reporting cadence.
 *             The rendered position is an observation.
 *   COASTING  the source has missed its cadence. The rendered position is
 *             PROPAGATED from the last fix — an estimate, still worth acting on.
 *   STALE     propagation has run long enough that cross-track error dominates.
 *             The estimate is a search area, not a position.
 *   LOST      too old to draw as a track at all. Hand off or drop it.
 *
 * The thresholds are per-source because the sources are not comparable: a
 * terrestrial ADS-B receiver on Oahu updates every few seconds, an AIS Class-B
 * transponder every few minutes, and an SGP4 propagation is only as good as the
 * age of its element set.
 */

/** @typedef {'live'|'coasting'|'stale'|'lost'} CoastState */

/** Ordered worst-last so a caller can compare severity by index. */
export const COAST_STATES = Object.freeze(['live', 'coasting', 'stale', 'lost']);

/**
 * Per-source age thresholds in SECONDS. `coastingAfter` ends LIVE, `staleAfter`
 * ends COASTING, `lostAfter` ends the track.
 *
 * These are reporting-cadence budgets, not accuracy claims. They are sized from
 * each source's published/observed update behaviour with headroom for one missed
 * cycle, so a single dropped message does not flap the label.
 */
export const COAST_PROFILES = Object.freeze({
  /** ADS-B via a terrestrial receiver network. Seconds-cadence when in range. */
  adsb: Object.freeze({ coastingAfter: 20, staleAfter: 120, lostAfter: 600 }),
  /** AIS. Class-A moving vessels report often; Class-B and at-anchor do not. */
  ais: Object.freeze({ coastingAfter: 180, staleAfter: 900, lostAfter: 3600 }),
  /** SGP4 propagation from an element set — degrades with element-set age. */
  satellite: Object.freeze({ coastingAfter: 3600, staleAfter: 86_400, lostAfter: 604_800 }),
  /** A fixed camera or sensor that is expected to be continuously available. */
  fixed: Object.freeze({ coastingAfter: 60, staleAfter: 300, lostAfter: 1800 }),
});

/** @type {Readonly<Record<CoastState, string>>} Kiosk-legible labels. */
export const COAST_LABELS = Object.freeze({
  live: 'LIVE',
  coasting: 'COASTING',
  stale: 'STALE ESTIMATE',
  lost: 'TRACK LOST',
});

/** Is this a source profile this module knows how to age? */
export function isCoastProfileId(id) {
  return Object.prototype.hasOwnProperty.call(COAST_PROFILES, id);
}

/**
 * Age one fix into a coast state.
 *
 * A missing, non-finite, or FUTURE-dated fix is treated as `lost`, never as
 * `live`. A clock-skewed source that reports tomorrow must not be able to buy
 * itself a permanent LIVE badge — the honest answer to "I cannot age this" is
 * "do not present it as an observation".
 *
 * @param {object} input
 * @param {number} input.lastFixAtMs Epoch ms of the newest source measurement.
 * @param {number} [input.nowMs] Epoch ms now.
 * @param {string} [input.profileId] Key of COAST_PROFILES.
 * @param {number} [input.skewToleranceSec] Future-dating allowed before `lost`.
 * @returns {{state: CoastState, label: string, ageSec: number|null, profileId: string}}
 */
export function coastStateFor({
  lastFixAtMs,
  nowMs = Date.now(),
  profileId = 'adsb',
  skewToleranceSec = 5,
} = {}) {
  const profile = COAST_PROFILES[profileId] || COAST_PROFILES.adsb;
  const resolvedProfileId = isCoastProfileId(profileId) ? profileId : 'adsb';
  const lost = (ageSec) => ({
    state: /** @type {CoastState} */ ('lost'),
    label: COAST_LABELS.lost,
    ageSec,
    profileId: resolvedProfileId,
  });
  if (!Number.isFinite(lastFixAtMs) || !Number.isFinite(nowMs)) return lost(null);
  const ageSec = (nowMs - lastFixAtMs) / 1000;
  if (ageSec < -Math.abs(skewToleranceSec)) return lost(ageSec);
  const settled = Math.max(0, ageSec);
  const state = settled >= profile.lostAfter ? 'lost'
    : settled >= profile.staleAfter ? 'stale'
      : settled >= profile.coastingAfter ? 'coasting'
        : 'live';
  return { state, label: COAST_LABELS[state], ageSec, profileId: resolvedProfileId };
}

/**
 * Is the rendered position an OBSERVATION, or something this app computed?
 * The single question every readout has to be able to answer.
 * @param {CoastState} state
 * @returns {boolean} true only when the position came from a fresh measurement.
 */
export function isObservedPosition(state) {
  return state === 'live';
}

/**
 * Worst (most degraded) state across contributing sources — how a fused or
 * multi-source picture must be labelled. An empty set is `lost`, not `live`:
 * nothing corroborating a track is the worst case, not the best.
 * @param {CoastState[]} states
 * @returns {CoastState}
 */
export function worstCoastState(states) {
  let worstIndex = -1;
  for (const state of states || []) {
    const index = COAST_STATES.indexOf(state);
    if (index > worstIndex) worstIndex = index;
  }
  return worstIndex < 0 ? 'lost' : COAST_STATES[worstIndex];
}
