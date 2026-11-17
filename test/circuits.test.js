import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVAL, buildCircuit } from '../src/core/circuits.js';

const EPSILON = 1e-9;

function near(actual, expected, tolerance = EPSILON, message = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message} expected ${expected}, got ${actual}`,
  );
}

test('the oval has an inner and an outer lane with the expected lengths', () => {
  const oval = buildCircuit(OVAL);
  assert.equal(oval.id, 'oval');
  assert.deepEqual(Object.keys(oval.lanes), ['inner', 'outer']);
  near(oval.lanes.inner.length, 4 + 0.7 * Math.PI);
  near(oval.lanes.outer.length, 4 + 0.9 * Math.PI);
  near(oval.track.centerLength, 4 + 0.8 * Math.PI);
});

test('the inner lane is shorter than the outer lane', () => {
  const oval = buildCircuit(OVAL);
  assert.ok(oval.lanes.inner.length < oval.lanes.outer.length);
});

test('the finish line lies in the middle of the main straight', () => {
  const oval = buildCircuit(OVAL);
  for (const lane of Object.values(oval.lanes)) {
    // One meter of straight before and after the line on each lane.
    for (const s of [-1, -0.5, 0, 0.5, 1 - 1e-6]) {
      assert.equal(lane.curvatureAt(s), 0, `s = ${s}`);
    }
    assert.notEqual(lane.curvatureAt(1 + 1e-6), 0);
    assert.notEqual(lane.curvatureAt(-1 - 1e-6), 0);
    near(lane.poseAt(0).heading, 0);
  }
});

test('the lanes fit inside the track width', () => {
  const oval = buildCircuit(OVAL);
  const offsets = Object.values(OVAL.lanes);
  const spacing = Math.max(...offsets) - Math.min(...offsets);
  near(spacing, 0.1);
  for (const offset of offsets) {
    assert.ok(Math.abs(offset) < OVAL.trackWidth / 2);
  }
  assert.equal(oval.trackWidth, 0.2);
});

test('the definition cannot be modified by accident, at any level', () => {
  assert.ok(Object.isFrozen(OVAL));
  assert.ok(Object.isFrozen(OVAL.pieces));
  assert.ok(Object.isFrozen(OVAL.lanes));
  assert.ok(Object.isFrozen(OVAL.start));
  for (const piece of OVAL.pieces) assert.ok(Object.isFrozen(piece));

  // Assignments fail loudly (modules run in strict mode) and change nothing.
  const before = OVAL.pieces[0].length;
  assert.throws(() => { OVAL.pieces[0].length = before + 0.1; }, TypeError);
  assert.throws(() => { OVAL.pieces[1].radius = 1; }, TypeError);
  assert.throws(() => { OVAL.pieces.push({}); }, TypeError);
  assert.throws(() => { OVAL.lanes.inner = 0; }, TypeError);
  assert.equal(OVAL.pieces[0].length, before);
  assert.doesNotThrow(() => buildCircuit(OVAL));
});

test('building a circuit twice gives independent equal results', () => {
  const a = buildCircuit(OVAL);
  const b = buildCircuit(OVAL);
  assert.notEqual(a.track, b.track);
  assert.equal(a.lanes.inner.length, b.lanes.inner.length);
  assert.deepEqual(a.lanes.outer.poseAt(3.3), b.lanes.outer.poseAt(3.3));
});
