import { test } from 'node:test';
import assert from 'node:assert/strict';
import { straight, curve, createTrack, createLane } from '../src/core/geometry.js';

const EPSILON = 1e-9;

function near(actual, expected, tolerance = EPSILON, message = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message} expected ${expected}, got ${actual}`,
  );
}

function angleDifference(a, b) {
  const twoPi = 2 * Math.PI;
  return ((((a - b + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}

/** Counterclockwise oval: 1 m + 2 m + 1 m of straights, two half circles. */
function ovalPieces(sign = 1) {
  return [
    straight(1),
    curve(0.4, sign * Math.PI),
    straight(2),
    curve(0.4, sign * Math.PI),
    straight(1),
  ];
}

test('pieces keep the requested dimensions and are placed end to end', () => {
  const track = createTrack(ovalPieces());
  assert.equal(track.pieces.length, 5);
  assert.equal(track.pieces[0].type, 'straight');
  assert.equal(track.pieces[0].length, 1);
  assert.equal(track.pieces[1].type, 'curve');
  assert.equal(track.pieces[1].radius, 0.4);
  assert.equal(track.pieces[2].length, 2);
});

test('lane lengths match the analytic values', () => {
  const track = createTrack(ovalPieces());
  near(createLane(track, 0).length, 4 + 0.8 * Math.PI);
  // Positive offset is the inside of a left-hand oval: radius 0.35.
  near(createLane(track, 0.05).length, 4 + 0.7 * Math.PI);
  // Negative offset is the outside: radius 0.45.
  near(createLane(track, -0.05).length, 4 + 0.9 * Math.PI);
  near(track.centerLength, 4 + 0.8 * Math.PI);
});

test('a clockwise oval swaps the inside and the outside lane', () => {
  const track = createTrack(ovalPieces(-1));
  near(createLane(track, 0.05).length, 4 + 0.9 * Math.PI);
  near(createLane(track, -0.05).length, 4 + 0.7 * Math.PI);
});

test('the oval closes on its starting pose', () => {
  const track = createTrack(ovalPieces());
  const last = track.pieces[track.pieces.length - 1].end;
  near(last.x, 0);
  near(last.y, 0);
  near(angleDifference(last.heading, 0), 0);
});

test('known points of the center line', () => {
  const lane = createLane(createTrack(ovalPieces()), 0);
  let pose = lane.poseAt(0);
  near(pose.x, 0);
  near(pose.y, 0);
  near(pose.heading, 0);

  pose = lane.poseAt(1);
  near(pose.x, 1);
  near(pose.y, 0);

  // End of the first half circle.
  pose = lane.poseAt(1 + 0.4 * Math.PI);
  near(pose.x, 1);
  near(pose.y, 0.8);
  near(angleDifference(pose.heading, Math.PI), 0);

  // Top of the first half circle, halfway through.
  pose = lane.poseAt(1 + 0.2 * Math.PI);
  near(pose.x, 1.4);
  near(pose.y, 0.4);
  near(pose.heading, Math.PI / 2);
});

test('a lane is shifted to the left of the center line', () => {
  const lane = createLane(createTrack(ovalPieces()), 0.05);
  const pose = lane.poseAt(0);
  near(pose.x, 0);
  near(pose.y, 0.05);
});

test('curve lanes stay at the lane radius from the arc center', () => {
  const track = createTrack(ovalPieces());
  for (const [offset, radius] of [[0.05, 0.35], [0, 0.4], [-0.05, 0.45]]) {
    const lane = createLane(track, offset);
    const points = lane.sample(0.01).filter((p) => p.x > 1 + 1e-6);
    assert.ok(points.length > 10);
    for (const p of points) {
      near(Math.hypot(p.x - 1, p.y - 0.4), radius, 1e-9, `offset ${offset}`);
    }
  }
});

test('the pose is periodic and accepts negative arc lengths', () => {
  const lane = createLane(createTrack(ovalPieces()), 0.05);
  for (const s of [0, 0.3, 1.7, 3.2, 5.9]) {
    const a = lane.poseAt(s);
    const b = lane.poseAt(s + lane.length);
    const c = lane.poseAt(s - 2 * lane.length);
    near(a.x, b.x, 1e-9);
    near(a.y, b.y, 1e-9);
    near(a.x, c.x, 1e-9);
    near(a.y, c.y, 1e-9);
  }
  const end = lane.poseAt(-1e-18);
  near(end.x, lane.poseAt(0).x, 1e-9);
  near(end.y, lane.poseAt(0).y, 1e-9);
});

test('curvature is zero on straights and 1 / radius on curves', () => {
  const track = createTrack(ovalPieces());
  const inner = createLane(track, 0.05);
  const outer = createLane(track, -0.05);
  assert.equal(inner.curvatureAt(0.5), 0);
  near(inner.curvatureAt(1 + 0.1), 1 / 0.35);
  near(outer.curvatureAt(1 + 0.1), 1 / 0.45);
  assert.equal(inner.curvatureAt(inner.length - 0.5), 0);
});

test('curvature is negative on right-hand curves', () => {
  const track = createTrack(ovalPieces(-1));
  const lane = createLane(track, 0);
  near(lane.curvatureAt(1.1), -1 / 0.4);
  near(lane.poseAt(1 + 0.4 * Math.PI).y, -0.8);
});

test('the sampled polyline is continuous and closed', () => {
  const track = createTrack(ovalPieces());
  for (const offset of [0.05, 0, -0.05]) {
    const lane = createLane(track, offset);
    const samples = lane.sample(0.01);
    const spacing = samples[1].s - samples[0].s;
    assert.ok(spacing <= 0.01 + 1e-12);

    const maxCurvature = 1 / 0.35;
    for (let i = 1; i < samples.length; i += 1) {
      const a = samples[i - 1];
      const b = samples[i];
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      assert.ok(distance <= spacing + 1e-9, `jump of ${distance} m at sample ${i}`);
      const turn = Math.abs(angleDifference(b.heading, a.heading));
      assert.ok(turn <= maxCurvature * spacing + 1e-9, `heading jump at sample ${i}`);
    }

    const first = samples[0];
    const last = samples[samples.length - 1];
    near(last.x, first.x, 1e-9);
    near(last.y, first.y, 1e-9);
    near(last.s, lane.length, 1e-9);
  }
});

test('heading is continuous across the boundaries between pieces', () => {
  const track = createTrack(ovalPieces());
  for (let i = 0; i < track.pieces.length; i += 1) {
    const current = track.pieces[i];
    const next = track.pieces[(i + 1) % track.pieces.length];
    near(current.end.x, next.start.x);
    near(current.end.y, next.start.y);
    near(angleDifference(current.end.heading, next.start.heading), 0);
  }
});

test('a track that does not close is rejected', () => {
  assert.throws(
    () => createTrack([straight(1), curve(0.4, Math.PI), straight(1)]),
    /not closed/,
  );
  assert.throws(
    () => createTrack([straight(1), curve(0.4, Math.PI), straight(2), curve(0.4, Math.PI), straight(1.1)]),
    /not closed/,
  );
});

test('invalid pieces and offsets are rejected', () => {
  assert.throws(() => straight(0), RangeError);
  assert.throws(() => straight(-1), RangeError);
  assert.throws(() => curve(0, 1), RangeError);
  assert.throws(() => curve(0.4, 0), RangeError);
  assert.throws(() => curve(0.4, Number.NaN), RangeError);
  assert.throws(() => createTrack([]), RangeError);

  const track = createTrack(ovalPieces());
  // Offset equal to the radius would collapse the inner lane to a point.
  assert.throws(() => createLane(track, 0.4), RangeError);
  assert.throws(() => createLane(track, Number.NaN), RangeError);
  assert.throws(() => createLane(track, 0).sample(0), RangeError);
});
