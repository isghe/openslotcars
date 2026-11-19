import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHICANE,
  CIRCUITS,
  OVAL,
  TEARDROP,
  buildCircuit,
  circuitById,
} from '../src/core/circuits.js';

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

const TILT = Math.asin(0.2);
const STRAIGHT = Math.sqrt(1.5 ** 2 - 0.3 ** 2);

// Expected lane lengths, worked out by hand from the pieces of each circuit.
const EXPECTED_LENGTHS = {
  oval: { inner: 4 + 0.7 * Math.PI, outer: 4 + 0.9 * Math.PI },
  speedway: { inner: 6 + 0.7 * Math.PI, outer: 6 + 0.9 * Math.PI },
  // 2 m of straights, two half circles and, per chicane, a right curve and a
  // left curve of 30 degrees whose lane radii add up to 1 m.
  chicane: {
    inner: 2 + 0.7 * Math.PI + Math.PI / 3,
    outer: 2 + 0.9 * Math.PI + Math.PI / 3,
  },
  teardrop: {
    inner: 2 * STRAIGHT + 0.25 * (Math.PI - 2 * TILT) + 0.55 * (Math.PI + 2 * TILT),
    outer: 2 * STRAIGHT + 0.35 * (Math.PI - 2 * TILT) + 0.65 * (Math.PI + 2 * TILT),
  },
};

test('the circuits are listed in order and found by identifier', () => {
  assert.deepEqual(
    CIRCUITS.map((circuit) => circuit.id),
    ['oval', 'speedway', 'chicane', 'teardrop'],
  );
  assert.ok(Object.isFrozen(CIRCUITS));
  for (const circuit of CIRCUITS) assert.equal(circuitById(circuit.id), circuit);
  assert.throws(() => circuitById('nowhere'), RangeError);
  assert.throws(() => circuitById(undefined), RangeError);
});

test('every circuit has its own readable name, which the built circuit keeps', () => {
  const names = CIRCUITS.map((circuit) => circuit.name);
  for (const name of names) assert.ok(typeof name === 'string' && name.trim() === name && name !== '');
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, ['Oval', 'Speedway', 'Chicane', 'Teardrop']);
  for (const definition of CIRCUITS) {
    assert.equal(buildCircuit(definition).name, definition.name);
  }
});

test('every circuit closes and has the expected lane lengths', () => {
  for (const definition of CIRCUITS) {
    const circuit = buildCircuit(definition);
    const expected = EXPECTED_LENGTHS[definition.id];
    assert.ok(expected, `no expected lengths for ${definition.id}`);
    assert.deepEqual(Object.keys(circuit.lanes), ['inner', 'outer']);
    near(circuit.lanes.inner.length, expected.inner, 1e-9, `${definition.id} inner`);
    near(circuit.lanes.outer.length, expected.outer, 1e-9, `${definition.id} outer`);
    assert.ok(circuit.lanes.inner.length < circuit.lanes.outer.length, definition.id);
  }
});

test('the lanes of every circuit fit inside the track and its curves', () => {
  for (const definition of CIRCUITS) {
    const half = definition.trackWidth / 2;
    for (const offset of Object.values(definition.lanes)) {
      assert.ok(Math.abs(offset) < half, `${definition.id} lane ${offset}`);
    }
    for (const piece of definition.pieces) {
      if (piece.type === 'curve') {
        // The inner lane of a curve must keep a positive radius on either side.
        assert.ok(piece.radius > half, `${definition.id} radius ${piece.radius}`);
      }
    }
  }
});

test('the finish line of every circuit lies on a straight, heading along it', () => {
  for (const definition of CIRCUITS) {
    const first = definition.pieces[0];
    const last = definition.pieces[definition.pieces.length - 1];
    assert.equal(first.type, 'straight', definition.id);
    assert.equal(last.type, 'straight', definition.id);
    const clear = Math.min(first.length, last.length);
    for (const lane of Object.values(buildCircuit(definition).lanes)) {
      for (const fraction of [-1, -0.5, 0, 0.5, 1 - 1e-6]) {
        assert.equal(lane.curvatureAt(fraction * clear), 0, `${definition.id} ${fraction}`);
      }
      near(lane.poseAt(0).heading, definition.start.heading);
    }
  }
});

test('the chicane sends the track to the right and then back to its heading', () => {
  const track = buildCircuit(CHICANE).track;
  const [, right, left, ...rest] = track.pieces;
  assert.ok(right.angle < 0 && left.angle > 0);
  near(right.end.heading + (left.angle), left.end.heading);
  near(left.end.heading, CHICANE.start.heading);
  // Right of travel is below the axis (y grows upwards in the model).
  assert.ok(left.end.y < 0);
  near(left.end.y, -2 * 0.5 * (1 - Math.cos(Math.PI / 6)));
  assert.ok(rest.length > 0);
});

test('the teardrop has a hairpin and a wide curve that add up to a full turn', () => {
  const [, hairpin, , wide] = buildCircuit(TEARDROP).track.pieces;
  assert.equal(hairpin.radius, 0.3);
  assert.equal(wide.radius, 0.6);
  near(hairpin.angle + wide.angle, 2 * Math.PI);
  assert.ok(hairpin.angle < Math.PI && wide.angle > Math.PI);
});

test('every definition is frozen at any level', () => {
  for (const definition of CIRCUITS) {
    assert.ok(Object.isFrozen(definition), definition.id);
    assert.ok(Object.isFrozen(definition.pieces), definition.id);
    assert.ok(Object.isFrozen(definition.lanes), definition.id);
    assert.ok(Object.isFrozen(definition.start), definition.id);
    for (const piece of definition.pieces) assert.ok(Object.isFrozen(piece), definition.id);
  }
});

test('building a circuit twice gives independent equal results', () => {
  const a = buildCircuit(OVAL);
  const b = buildCircuit(OVAL);
  assert.notEqual(a.track, b.track);
  assert.equal(a.lanes.inner.length, b.lanes.inner.length);
  assert.deepEqual(a.lanes.outer.poseAt(3.3), b.lanes.outer.poseAt(3.3));
});
