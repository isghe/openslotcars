/**
 * Circuit definitions.
 *
 * A circuit is described as plain data: the list of track pieces, the pose at
 * which the first piece starts, the width of the track and the lateral offset
 * of each lane. `buildCircuit` turns a definition into a track and its lanes.
 *
 * All distances are in meters (scale 1:32 slot car tracks) and all angles in
 * radians. The finish line sits at arc length 0 of every lane.
 *
 * This module is pure logic: no DOM, no clock, no randomness.
 */

import { straight, curve, createTrack, createLane } from './geometry.js';

/**
 * The oval used by the first prototype: a main straight of 2 m split in two
 * halves by the finish line, a back straight of 2 m and two half circles
 * with a center line radius of 0.40 m. The lanes are 0.10 m apart, the inner
 * one at 0.35 m and the outer one at 0.45 m from the arc centers.
 */
export const OVAL = Object.freeze({
  id: 'oval',
  pieces: Object.freeze([
    straight(1),
    curve(0.4, Math.PI),
    straight(2),
    curve(0.4, Math.PI),
    straight(1),
  ]),
  start: Object.freeze({ x: 0, y: 0, heading: 0 }),
  trackWidth: 0.2,
  // Positive offsets lie to the left of the direction of travel, which is the
  // inside of this counterclockwise oval.
  lanes: Object.freeze({ inner: 0.05, outer: -0.05 }),
});

/**
 * A rounded rectangle: four corners with a center line radius of 0.40 m, a
 * main straight of 2 m split in two halves by the finish line, a back straight
 * of 2 m and two side straights of 1 m. The lanes are those of the oval.
 */
export const SPEEDWAY = Object.freeze({
  id: 'speedway',
  pieces: Object.freeze([
    straight(1),
    curve(0.4, Math.PI / 2),
    straight(1),
    curve(0.4, Math.PI / 2),
    straight(2),
    curve(0.4, Math.PI / 2),
    straight(1),
    curve(0.4, Math.PI / 2),
    straight(1),
  ]),
  start: Object.freeze({ x: 0, y: 0, heading: 0 }),
  trackWidth: 0.2,
  lanes: Object.freeze({ inner: 0.05, outer: -0.05 }),
});

/**
 * A short oval with a chicane on each straight: two curves of 30 degrees and
 * radius 0.50 m, first to the right and then to the left, which shift the
 * track sideways by about 0.13 m and bring it back to its heading. The two
 * half circles have a radius of 0.40 m. The finish line sits in the middle of
 * the straight that holds the first chicane.
 */
export const CHICANE = Object.freeze({
  id: 'chicane',
  pieces: Object.freeze([
    straight(0.25),
    curve(0.5, -Math.PI / 6),
    curve(0.5, Math.PI / 6),
    straight(0.5),
    curve(0.4, Math.PI),
    straight(0.5),
    curve(0.5, -Math.PI / 6),
    curve(0.5, Math.PI / 6),
    straight(0.5),
    curve(0.4, Math.PI),
    straight(0.25),
  ]),
  start: Object.freeze({ x: 0, y: 0, heading: 0 }),
  trackWidth: 0.2,
  lanes: Object.freeze({ inner: 0.05, outer: -0.05 }),
});

// Teardrop: a wide curve of radius 0.60 m and a hairpin of radius 0.30 m,
// whose centers are 1.5 m apart, joined by two straights tangent to both
// circles. The straights are tilted by `TEARDROP_TILT` from the axis through
// the centers, so the hairpin turns by PI - 2 * tilt and the wide curve by
// PI + 2 * tilt.
const TEARDROP_TILT = Math.asin((0.6 - 0.3) / 1.5);
const TEARDROP_STRAIGHT = Math.sqrt(1.5 ** 2 - (0.6 - 0.3) ** 2);

/**
 * A teardrop with a hairpin. The main straight is split in two halves by the
 * finish line, just before the hairpin.
 */
export const TEARDROP = Object.freeze({
  id: 'teardrop',
  pieces: Object.freeze([
    straight(TEARDROP_STRAIGHT / 2),
    curve(0.3, Math.PI - 2 * TEARDROP_TILT),
    straight(TEARDROP_STRAIGHT),
    curve(0.6, Math.PI + 2 * TEARDROP_TILT),
    straight(TEARDROP_STRAIGHT / 2),
  ]),
  start: Object.freeze({ x: 0, y: 0, heading: 0 }),
  trackWidth: 0.2,
  lanes: Object.freeze({ inner: 0.05, outer: -0.05 }),
});

/** Every circuit of the game, in the order in which they are offered. */
export const CIRCUITS = Object.freeze([OVAL, SPEEDWAY, CHICANE, TEARDROP]);

/**
 * Finds the definition of a circuit.
 * @param {string} id Identifier of the circuit.
 * @throws {RangeError} If no circuit has that identifier.
 */
export function circuitById(id) {
  const definition = CIRCUITS.find((circuit) => circuit.id === id);
  if (definition === undefined) {
    throw new RangeError(`unknown circuit: ${id}`);
  }
  return definition;
}

/**
 * Builds the track and the lanes of a circuit definition.
 * @param {{id: string, pieces: Array<object>, start: object,
 *   trackWidth: number, lanes: Object<string, number>}} definition
 * @returns {{id: string, trackWidth: number, track: object,
 *   lanes: Object<string, object>}}
 */
export function buildCircuit(definition) {
  const track = createTrack([...definition.pieces], { ...definition.start });
  const lanes = {};
  for (const [name, offset] of Object.entries(definition.lanes)) {
    lanes[name] = createLane(track, offset);
  }
  return { id: definition.id, trackWidth: definition.trackWidth, track, lanes };
}
