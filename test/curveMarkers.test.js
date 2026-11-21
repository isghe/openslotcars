import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curveBoundaries, sectionMidpoints } from '../src/ui/curveMarkers.js';
import { createTrack, straight, curve } from '../src/core/geometry.js';
import { CLUB, INFINITE_LOOP, CHICANE, OVAL, buildCircuit } from './helpers/circuits.js';

test('Club marks both ends of each curve at their exact poses', () => {
  const track = buildCircuit(CLUB).track;
  const boundaries = curveBoundaries(track);
  assert.equal(boundaries.length, 12);
  assert.deepEqual(boundaries[0], track.pieces[1].start);
  assert.deepEqual(boundaries[1], track.pieces[1].end);
  assert.deepEqual(boundaries[6], track.pieces[7].start);
  assert.deepEqual(boundaries[7], track.pieces[7].end);
});

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
test('the oval has two arc midpoints and one midpoint per complete straight', () => {
  const poses = sectionMidpoints(buildCircuit(OVAL).track);
  assert.equal(poses.length, 4);
  const expected = [[1.4, .4, Math.PI / 2], [0, .8, Math.PI], [-1.4, .4, 3 * Math.PI / 2], [0, 0, 0]];
  poses.forEach((pose, i) => {
    near(pose.x, expected[i][0]); near(pose.y, expected[i][1]);
    // At the seam poseAt wraps to heading zero.
    near(pose.heading, expected[i][2]);
  });
});
test('the finish straight midpoint uses both unequal halves on Club', () => {
  const poses = sectionMidpoints(buildCircuit(CLUB).track);
  assert.equal(poses.length, 12);
  near(poses.at(-1).x, .4); near(poses.at(-1).y, 0);
});
test('adjacent arcs keep their own midpoints and only straight pieces are merged', () => {
  const track = buildCircuit(CHICANE).track;
  assert.equal(sectionMidpoints(track).length, 9);
  const split = createTrack([straight(.5), straight(.5), curve(.4, Math.PI), straight(2), curve(.4, Math.PI), straight(1)]);
  const poses = sectionMidpoints(split);
  assert.equal(poses.length, 4);
  near(poses.at(-1).x, 0); near(poses.at(-1).y, 0);
});
test('Infinite Loop marks both ends of both lobes', () => {
  const track = buildCircuit(INFINITE_LOOP).track;
  assert.deepEqual(curveBoundaries(track), [
    track.pieces[1].start, track.pieces[2].start,
    track.pieces[3].start, track.pieces[4].start,
  ]);
});
test('every arc join has one line, including same-direction changes of radius', () => {
  const track = buildCircuit(CHICANE).track;
  assert.deepEqual(curveBoundaries(track), [1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => track.pieces[i].start));
});
test('curve boundaries respect the last-to-first join', () => {
  const track = createTrack([
    curve(.4, Math.PI / 2), straight(2), curve(.4, Math.PI),
    straight(2), curve(.4, Math.PI / 2),
  ]);
  assert.deepEqual(curveBoundaries(track), track.pieces.map(piece => piece.start));
  const circle = createTrack([curve(.4, 2 * Math.PI)]);
  assert.deepEqual(curveBoundaries(circle), [circle.pieces[0].start]);
  const chicane = buildCircuit(CHICANE).track;
  const reversalAtSeam = createTrack([...chicane.pieces.slice(2), ...chicane.pieces.slice(0, 2)]);
  assert.deepEqual(curveBoundaries(reversalAtSeam)[0], reversalAtSeam.pieces[0].start);
});
