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
  name: 'Oval',
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
  name: 'Speedway',
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

// The chicane is driven clockwise, unlike the other circuits: its curves are
// right turns (negative angles) or, in the S-bends, a left and a right one.
//
// Two long curves of 135 degrees and radius 0.20 m, to the left and then to
// the right: an S that shifts the track sideways by about 0.68 m and brings it
// back to its heading. Each curve is tighter than the half turns, and long
// enough for the tail to slide out and the car to spin out: at a constant speed
// the car leaves the track in an S-bend from about 2 m/s. (Two curves of 45
// degrees and the same radius, tried before, need about 3 m/s.)
const S_BEND = [curve(0.2, (3 * Math.PI) / 4), curve(0.2, (-3 * Math.PI) / 4)];

// The two half turns of the chicane are each made of two quarter circles of
// radius 0.65 m and 0.35 m. The first one starts wide and tightens; the second
// one starts tight and widens. Both shift the track sideways by 1.0 m, so the
// S-bends fit between the two sides, but the second one ends 0.6 m less far
// along the heading than the first one: the straights of the second side are
// 0.3 m longer at each end to make up for it, so that the circuit closes.
const TIGHTENING = [curve(0.65, -Math.PI / 2), curve(0.35, -Math.PI / 2)];
const WIDENING = [curve(0.35, -Math.PI / 2), curve(0.65, -Math.PI / 2)];

/**
 * An oval driven clockwise, with an S-bend on each straight (see `S_BEND`),
 * between a half turn that tightens and one that widens. The straights are
 * 1.2 m long on the first side and 1.5 m on the second one. The finish line
 * sits in the middle of the first straight, split in two halves of 0.6 m.
 */
export const CHICANE = Object.freeze({
  id: 'chicane',
  name: 'Chicane',
  pieces: Object.freeze([
    straight(0.6),
    ...S_BEND,
    straight(1.2),
    ...TIGHTENING,
    straight(1.5),
    ...S_BEND,
    straight(1.5),
    ...WIDENING,
    straight(0.6),
  ]),
  start: Object.freeze({ x: 0, y: 0, heading: 0 }),
  trackWidth: 0.2,
  // The inside of a clockwise circuit is to the right of the direction of
  // travel, so the offsets are the opposite of those of the oval.
  lanes: Object.freeze({ inner: -0.05, outer: 0.05 }),
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
  name: 'Teardrop',
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
 * @param {{id: string, name: string, pieces: Array<object>, start: object,
 *   trackWidth: number, lanes: Object<string, number>}} definition
 * @returns {{id: string, name: string, trackWidth: number, track: object,
 *   lanes: Object<string, object>}}
 */
export function buildCircuit(definition) {
  const track = createTrack([...definition.pieces], { ...definition.start });
  const lanes = {};
  for (const [name, offset] of Object.entries(definition.lanes)) {
    lanes[name] = createLane(track, offset);
  }
  return { id: definition.id, name: definition.name, trackWidth: definition.trackWidth, track, lanes };
}
