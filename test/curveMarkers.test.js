import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curveBoundaries } from '../src/ui/curveMarkers.js';
import { createTrack, straight, curve } from '../src/core/geometry.js';
import { CLUB, INFINITE_LOOP, CHICANE, buildCircuit } from './helpers/circuits.js';

test('Club marks both ends of each curve at their exact poses', () => {
  const track = buildCircuit(CLUB).track;
  const boundaries = curveBoundaries(track);
  assert.equal(boundaries.length, 12);
  assert.deepEqual(boundaries[0], track.pieces[1].start);
  assert.deepEqual(boundaries[1], track.pieces[1].end);
  assert.deepEqual(boundaries[6], track.pieces[7].start);
  assert.deepEqual(boundaries[7], track.pieces[7].end);
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
