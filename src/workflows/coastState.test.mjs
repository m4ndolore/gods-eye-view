import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COAST_LABELS,
  COAST_PROFILES,
  COAST_STATES,
  coastStateFor,
  isCoastProfileId,
  isObservedPosition,
  worstCoastState,
} from './coastState.js';

const NOW = 1_760_000_000_000;

test('states are ordered best-first so severity compares by index', () => {
  assert.deepEqual(COAST_STATES, ['live', 'coasting', 'stale', 'lost']);
  for (const state of COAST_STATES) assert.ok(COAST_LABELS[state], `${state} needs a label`);
});

test('every profile is a strictly widening ladder', () => {
  for (const [id, profile] of Object.entries(COAST_PROFILES)) {
    assert.ok(profile.coastingAfter > 0, `${id}: coastingAfter must be positive`);
    assert.ok(profile.staleAfter > profile.coastingAfter, `${id}: stale must follow coasting`);
    assert.ok(profile.lostAfter > profile.staleAfter, `${id}: lost must follow stale`);
  }
});

test('an ADS-B fix ages live → coasting → stale → lost at its own thresholds', () => {
  const at = (ageSec) => coastStateFor({ lastFixAtMs: NOW - ageSec * 1000, nowMs: NOW, profileId: 'adsb' }).state;
  assert.equal(at(0), 'live');
  assert.equal(at(19), 'live');
  assert.equal(at(20), 'coasting');
  assert.equal(at(119), 'coasting');
  assert.equal(at(120), 'stale');
  assert.equal(at(599), 'stale');
  assert.equal(at(600), 'lost');
});

test('AIS is aged on its own much slower cadence, not ADS-B thresholds', () => {
  const ais = coastStateFor({ lastFixAtMs: NOW - 150_000, nowMs: NOW, profileId: 'ais' });
  const adsb = coastStateFor({ lastFixAtMs: NOW - 150_000, nowMs: NOW, profileId: 'adsb' });
  // Two and a half minutes is nothing for a Class-B transponder and an eternity
  // for a terrestrial ADS-B receiver. One timestamp, two honest answers.
  assert.equal(ais.state, 'live');
  assert.equal(adsb.state, 'stale');
});

test('the reported age is the real age even when the state has bottomed out', () => {
  const aged = coastStateFor({ lastFixAtMs: NOW - 7_200_000, nowMs: NOW, profileId: 'adsb' });
  assert.equal(aged.state, 'lost');
  assert.equal(aged.ageSec, 7200);
});

test('an unusable or future-dated fix is lost, never live', () => {
  // A clock-skewed source must not be able to buy itself a permanent LIVE badge.
  assert.equal(coastStateFor({ lastFixAtMs: NOW + 600_000, nowMs: NOW }).state, 'lost');
  assert.equal(coastStateFor({ lastFixAtMs: undefined, nowMs: NOW }).state, 'lost');
  assert.equal(coastStateFor({ lastFixAtMs: Number.NaN, nowMs: NOW }).state, 'lost');
  // No fix at all has no age to report — null, not 0, which would read as fresh.
  assert.equal(coastStateFor({}).ageSec, null);
});

test('small clock skew inside tolerance still reads live', () => {
  assert.equal(coastStateFor({ lastFixAtMs: NOW + 2000, nowMs: NOW }).state, 'live');
});

test('an unknown profile falls back to ADS-B and reports the fallback it used', () => {
  const result = coastStateFor({ lastFixAtMs: NOW - 30_000, nowMs: NOW, profileId: 'no-such-source' });
  assert.equal(result.profileId, 'adsb');
  assert.equal(result.state, 'coasting');
  assert.equal(isCoastProfileId('no-such-source'), false);
  assert.equal(isCoastProfileId('ais'), true);
});

test('only a live state counts as an observed position', () => {
  assert.equal(isObservedPosition('live'), true);
  for (const state of ['coasting', 'stale', 'lost', undefined]) {
    assert.equal(isObservedPosition(state), false, `${state} is propagated, not observed`);
  }
});

test('a multi-source picture is labelled by its worst contributor', () => {
  assert.equal(worstCoastState(['live', 'coasting']), 'coasting');
  assert.equal(worstCoastState(['stale', 'live', 'lost']), 'lost');
  assert.equal(worstCoastState(['live', 'live']), 'live');
});

test('no contributing source at all is lost, not live', () => {
  // The empty case is the one that matters: an unsourced track is the worst
  // case, and defaulting it to LIVE is exactly the lie this module prevents.
  assert.equal(worstCoastState([]), 'lost');
  assert.equal(worstCoastState(undefined), 'lost');
  assert.equal(worstCoastState(['not-a-state']), 'lost');
});
