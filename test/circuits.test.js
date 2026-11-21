import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHICANE,
  CLUB,
  INFINITE_LOOP,
  CIRCUITS,
  OVAL,
  TEARDROP,
  buildCircuit,
  circuitById,
} from './helpers/circuits.js';

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

// Sideways shift of the S-bend of the chicane: two curves of 135 degrees and
// radius 0.2 m.
const S_SHIFT = 2 * 0.2 * (1 + Math.SQRT1_2);
const TILT = Math.asin(0.2);
const STRAIGHT = Math.sqrt(1.5 ** 2 - 0.3 ** 2);

// Expected lane lengths, worked out by hand from the pieces of each circuit.
const EXPECTED_LENGTHS = {
  'infinite-loop': { inner: 2.4 + 1.8 * Math.PI, outer: 2.4 + 1.8 * Math.PI },
  // Polygon perimeter 14 m, minus twice the sum of the radii (3.1 m),
  // plus the six quarter arcs. Net turning offsets each lane by 0.1 * PI m.
  club: { inner: 7.8 + 1.45 * Math.PI, outer: 7.8 + 1.65 * Math.PI },
  oval: { inner: 4 + 0.7 * Math.PI, outer: 4 + 0.9 * Math.PI },
  speedway: { inner: 6 + 0.7 * Math.PI, outer: 6 + 0.9 * Math.PI },
  // 5.9 m of straights (0.6 + 1.2 + 3.5 + 0.6), two half turns made of two
  // quarter circles each (the radii of the lanes of the first half turn add up
  // to 1.683 m - 0.1 m or + 0.1 m, those of the second one to 0.9 m or 1.1 m)
  // and two curves of 135 degrees (right and left), whose lane radii add up to
  // 0.4 m.
  chicane: {
    inner: 5.9 + ((1 + S_SHIFT - 0.1) + 0.9) * Math.PI / 2 + 0.3 * Math.PI,
    outer: 5.9 + ((1 + S_SHIFT + 0.1) + 1.1) * Math.PI / 2 + 0.3 * Math.PI,
  },
  teardrop: {
    inner: 2 * STRAIGHT + 0.25 * (Math.PI - 2 * TILT) + 0.55 * (Math.PI + 2 * TILT),
    outer: 2 * STRAIGHT + 0.35 * (Math.PI - 2 * TILT) + 0.65 * (Math.PI + 2 * TILT),
  },
};

test('the circuits are listed in order and found by identifier', () => {
  assert.deepEqual(
    CIRCUITS.map((circuit) => circuit.id),
    ['oval', 'speedway', 'chicane', 'teardrop', 'club', 'infinite-loop'],
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
  assert.deepEqual(names, ['Oval', 'Speedway', 'Chicane', 'Teardrop', 'Club', 'Infinite Loop']);
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
    if (definition.topology === 'figure-eight') near(circuit.lanes.inner.length, circuit.lanes.outer.length);
    else assert.ok(circuit.lanes.inner.length < circuit.lanes.outer.length, definition.id);
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

test('the first straight of the chicane circuit has an S-bend: a long curve left, then right', () => {
  const { pieces } = buildCircuit(CHICANE).track;
  // Straight, S-bend, straight, half turn (two curves), long straight, half
  // turn (two curves), straight: there is no S-bend on the return straight.
  assert.equal(pieces.length, 10);
  assert.deepEqual(
    pieces.map((piece) => piece.type),
    ['straight', 'curve', 'curve', 'straight', 'curve', 'curve', 'straight', 'curve', 'curve', 'straight'],
  );
  const [left, right] = pieces.slice(1, 3);
  assert.ok(left.angle > 0 && right.angle < 0);
  near(left.angle, (3 * Math.PI) / 4);
  near(right.angle, (-3 * Math.PI) / 4);
  // Tighter than the half turns: this is what makes the car slow down.
  assert.equal(left.radius, 0.2);
  assert.equal(right.radius, 0.2);
  // The S-bend brings the track back to its heading, to the left of where it
  // started. Distances are measured along and across that heading.
  near(right.end.heading, left.start.heading);
  const { heading } = left.start;
  const dx = right.end.x - left.start.x;
  const dy = right.end.y - left.start.y;
  near(dx * Math.cos(heading) + dy * Math.sin(heading), 2 * 0.2 * Math.SQRT1_2, 1e-9, 'along');
  near(-dx * Math.sin(heading) + dy * Math.cos(heading), S_SHIFT, 1e-9, 'across');
});

test('the return straight of the chicane circuit is its long, fast part', () => {
  const { pieces } = buildCircuit(CHICANE).track;
  const longest = Math.max(...pieces.filter((piece) => piece.type === 'straight').map((piece) => piece.length));
  assert.equal(pieces[6].length, 3.5);
  assert.equal(pieces[6].length, longest);
  // Nothing on it but the straight: the pieces before and after are the half turns.
  assert.equal(pieces[5].type, 'curve');
  assert.equal(pieces[7].type, 'curve');
});

test('the first half turn of the chicane circuit tightens and the second widens', () => {
  const { pieces } = buildCircuit(CHICANE).track;
  const first = pieces.slice(4, 6);
  const second = pieces.slice(7, 9);
  for (const piece of [...first, ...second]) {
    assert.equal(piece.type, 'curve');
    near(piece.angle, -Math.PI / 2);
  }
  assert.equal(first[0].radius, 1.1);
  near(first[1].radius, 1 + S_SHIFT - 1.1);
  assert.ok(first[0].radius > first[1].radius);
  assert.deepEqual(second.map((piece) => piece.radius), [0.35, 0.65]);
  // Each half turn turns the heading around, clockwise, and shifts the track
  // sideways, to the right: by 1.0 m for the second one and by 1.0 m plus the
  // shift of the S-bend for the first one, which cancels it.
  for (const [[a, b], shift] of [[first, 1.0 + S_SHIFT], [second, 1.0]]) {
    near(b.end.heading - a.start.heading, -Math.PI);
    const { heading } = a.start;
    const dx = b.end.x - a.start.x;
    const dy = b.end.y - a.start.y;
    near(-dx * Math.sin(heading) + dy * Math.cos(heading), -shift, 1e-9, 'sideways');
  }
});

test('the chicane is driven clockwise and the oval counterclockwise, each on its shorter lane', () => {
  const turning = (definition) => buildCircuit(definition).track.pieces
    .reduce((sum, piece) => sum + (piece.type === 'curve' ? piece.angle : 0), 0);
  near(turning(CHICANE), -2 * Math.PI);
  near(turning(OVAL), 2 * Math.PI);
  // The inside of the circuit is to the right when driving clockwise (negative
  // offset) and to the left otherwise, and the car runs on the inner lane.
  assert.ok(CHICANE.lanes.inner < 0 && CHICANE.lanes.outer > 0);
  assert.ok(OVAL.lanes.inner > 0 && OVAL.lanes.outer < 0);
  for (const definition of [CHICANE, OVAL]) {
    const { lanes } = buildCircuit(definition);
    assert.ok(lanes.inner.length < lanes.outer.length, definition.id);
  }
});

test('the teardrop has a hairpin and a wide curve that add up to a full turn', () => {
  const [, hairpin, , wide] = buildCircuit(TEARDROP).track.pieces;
  assert.equal(hairpin.radius, 0.3);
  assert.equal(wide.radius, 0.6);
  near(hairpin.angle + wide.angle, 2 * Math.PI);
  assert.ok(hairpin.angle < Math.PI && wide.angle > Math.PI);
});

test('the club follows a clockwise rounded L with a left turn in its reentrant corner', () => {
  const { track, lanes } = buildCircuit(CLUB);
  const corners = track.pieces.filter((piece) => piece.type === 'curve');
  const first = corners[0];
  near(first.radius, 1.2);
  near(first.start.x, -0.8);
  near(first.start.y, 0);
  near(first.end.x, -2);
  near(first.end.y, 1.2);
  near(lanes.inner.curvatureAt(0.9), -1 / 1.15);
  near(corners[1].radius, 0.35);
  near(corners[2].radius, 0.5);
  near(corners[1].start.x, -2);
  near(corners[1].start.y, 2.65);
  near(corners[2].end.x, -0.5);
  near(corners[2].end.y, 2.5);
  assert.equal(corners.filter((piece) => piece.angle > 0).length, 1);
  assert.equal(corners.filter((piece) => piece.angle < 0).length, 5);
  near(corners.reduce((sum, piece) => sum + piece.angle, 0), -2 * Math.PI);
  const reentrant = corners.find((piece) => piece.angle > 0);
  near(reentrant.start.x, -0.5);
  near(reentrant.start.y, 1.8);
  near(reentrant.end.x, -0.2);
  near(reentrant.end.y, 1.5);
  // The inner lane of the circuit is on the outside of this left turn.
  const s = track.pieces.slice(0, 7).reduce((sum, piece) => sum + (
    piece.type === 'straight' ? piece.length
      : Math.abs(piece.angle) * (piece.radius + Math.sign(piece.angle) * 0.05)
  ), 0);
  near(lanes.inner.curvatureAt(s + 0.1), 1 / 0.35);
  const points = lanes.inner.sample(0.02);
  near(Math.max(...points.map((point) => point.x)), 1.95, 0.001);
  near(Math.min(...points.map((point) => point.x)), -1.95, 0.001);
  near(Math.max(...points.map((point) => point.y)), 2.95, 0.001);
  near(Math.min(...points.map((point) => point.y)), 0.05, 0.001);
});

test('circuit direction follows the design rule, with zero net turning for the eight', () => {
  for (const definition of CIRCUITS) {
    const turns = definition.pieces.filter((piece) => piece.type === 'curve');
    const mixed = turns.some((piece) => piece.angle > 0)
      && turns.some((piece) => piece.angle < 0);
    const direction = mixed ? -1 : 1;
    near(turns.reduce((sum, piece) => sum + piece.angle, 0), definition.topology === 'figure-eight' ? 0 : direction * 2 * Math.PI);
    assert.equal(Math.sign(definition.lanes.inner), direction, definition.id);
    assert.equal(Math.sign(definition.lanes.outer), -direction, definition.id);
  }
});

test('the horizontal eight has two opposite lobes and a perpendicular crossing', () => {
  const { track, lanes } = buildCircuit(INFINITE_LOOP);
  const first = track.pieces[1];
  const second = track.pieces[3];
  near(first.angle, -3 * Math.PI / 2);
  near(second.angle, 3 * Math.PI / 2);
  // Both diagonals pass through the origin; their headings differ by 90 degrees.
  const a = track.pieces[0], b = track.pieces[2];
  for (const [piece, distance] of [[a, 0.3], [b, 0.6]]) {
    near(piece.start.x + distance * Math.cos(piece.start.heading), 0);
    near(piece.start.y + distance * Math.sin(piece.start.heading), 0);
  }
  near(Math.abs(Math.cos(a.start.heading - b.start.heading)), 0);
  for (const lane of Object.values(lanes)) {
    const right = lane.curvatureAt(1);
    const left = lane.curvatureAt(lane.length - 1);
    assert.ok(right < 0 && left > 0);
    near(lane.length, 2.4 + 1.8 * Math.PI);
  }
  const points = lanes.inner.sample(.01);
  assert.ok(Math.max(...points.map(p=>p.x)) > 1.39);
  assert.ok(Math.min(...points.map(p=>p.x)) < -1.49);
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
