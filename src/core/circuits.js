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
