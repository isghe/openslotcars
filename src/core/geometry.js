/**
 * Track geometry.
 *
 * A track is a closed chain of analytic pieces (straights and circular arcs).
 * Lengths are in meters and angles in radians. Each piece starts where the
 * previous one ends, so the chain forms a continuous path whose pose
 * (position and heading) can be computed in closed form.
 *
 * A lane is a curve parallel to the center line, shifted sideways by an
 * offset (positive to the left of the direction of travel). Every lane has its
 * own length and its own arc-length coordinate `s`, which runs from 0 to the
 * lane length and wraps around because the track is closed.
 *
 * This module is pure logic: no DOM, no clock, no randomness.
 */

const TWO_PI = 2 * Math.PI;
const CLOSURE_TOLERANCE = 1e-9;

function assertPositiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
}

/**
 * Creates a straight piece.
 * @param {number} length Length in meters.
 */
export function straight(length) {
  assertPositiveFinite(length, 'length');
  return { type: 'straight', length };
}

/**
 * Creates a circular arc piece.
 * @param {number} radius Radius of the center line in meters.
 * @param {number} angle Swept angle in radians: positive turns left,
 *   negative turns right.
 */
export function curve(radius, angle) {
  assertPositiveFinite(radius, 'radius');
  if (!Number.isFinite(angle) || angle === 0) {
    throw new RangeError(`angle must be a non-zero finite number, got ${angle}`);
  }
  return { type: 'curve', radius, angle };
}

/** Radius of the lane with the given offset on a curve piece. */
function laneRadius(piece, offset) {
  const radius = piece.radius - Math.sign(piece.angle) * offset;
  if (radius <= 0) {
    throw new RangeError(
      `lane offset ${offset} does not fit a curve of radius ${piece.radius}`,
    );
  }
  return radius;
}

/** Length of a piece measured along the lane with the given offset. */
function pieceLaneLength(piece, offset) {
  if (piece.type === 'straight') return piece.length;
  return Math.abs(piece.angle) * laneRadius(piece, offset);
}

/**
 * Pose on a lane inside a piece.
 * @param {object} piece The piece.
 * @param {{x:number,y:number,heading:number}} from Pose of the center line
 *   at the start of the piece.
 * @param {number} offset Lane offset, positive to the left.
 * @param {number} t Fraction of the piece already covered, from 0 to 1.
 */
function poseOnPiece(piece, from, offset, t) {
  const { x, y, heading } = from;
  // Unit vector pointing to the left of the direction of travel.
  const nx = -Math.sin(heading);
  const ny = Math.cos(heading);

  if (piece.type === 'straight') {
    const u = t * piece.length;
    return {
      x: x + offset * nx + u * Math.cos(heading),
      y: y + offset * ny + u * Math.sin(heading),
      heading,
    };
  }

  const sign = Math.sign(piece.angle);
  const radius = laneRadius(piece, offset);
  // Center of the arc and vector from it to the start of the lane.
  const cx = x + sign * piece.radius * nx;
  const cy = y + sign * piece.radius * ny;
  const vx = -sign * radius * nx;
  const vy = -sign * radius * ny;
  const turn = t * piece.angle;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return {
    x: cx + cos * vx - sin * vy,
    y: cy + sin * vx + cos * vy,
    heading: heading + turn,
  };
}

/** Difference between two angles, folded into [-PI, PI). */
function angleDifference(a, b) {
  return ((((a - b + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
}

/**
 * Builds a closed track from a list of pieces.
 * @param {Array<object>} pieces Pieces created with `straight` and `curve`.
 * @param {{x:number,y:number,heading:number}} [start] Pose of the center line
 *   at the start of the first piece.
 * @returns {{pieces: Array<object>, start: object, centerLength: number}}
 * @throws {Error} If the pieces do not form a closed track.
 */
export function createTrack(pieces, start = { x: 0, y: 0, heading: 0 }) {
  if (!Array.isArray(pieces) || pieces.length === 0) {
    throw new RangeError('a track needs at least one piece');
  }

  const first = { x: start.x, y: start.y, heading: start.heading };
  const placed = [];
  let pose = first;
  let centerLength = 0;
  for (const piece of pieces) {
    const end = poseOnPiece(piece, pose, 0, 1);
    placed.push({ ...piece, start: pose, end });
    centerLength += pieceLaneLength(piece, 0);
    pose = end;
  }

  const gap = Math.hypot(pose.x - first.x, pose.y - first.y);
  const turnGap = Math.abs(angleDifference(pose.heading, first.heading));
  if (gap > CLOSURE_TOLERANCE || turnGap > CLOSURE_TOLERANCE) {
    throw new Error(
      `the track is not closed: position gap ${gap} m, heading gap ${turnGap} rad`,
    );
  }

  return { pieces: placed, start: first, centerLength };
}

/**
 * Creates a lane of a track.
 * @param {{pieces: Array<object>}} track A track from `createTrack`.
 * @param {number} [offset] Sideways shift from the center line in meters,
 *   positive to the left.
 */
export function createLane(track, offset = 0) {
  if (!Number.isFinite(offset)) {
    throw new RangeError(`offset must be a finite number, got ${offset}`);
  }

  const lengths = track.pieces.map((piece) => pieceLaneLength(piece, offset));
  const starts = [];
  let length = 0;
  for (const pieceLength of lengths) {
    starts.push(length);
    length += pieceLength;
  }

  /** Finds the piece that contains `s` and the fraction covered inside it. */
  function locate(s) {
    let wrapped = ((s % length) + length) % length;
    if (wrapped >= length) wrapped = 0;
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= wrapped) low = middle;
      else high = middle - 1;
    }
    return { index: low, t: (wrapped - starts[low]) / lengths[low] };
  }

  /** Pose (x, y, heading) at arc length `s`; `s` wraps around the lane. */
  function poseAt(s) {
    const { index, t } = locate(s);
    const piece = track.pieces[index];
    return poseOnPiece(piece, piece.start, offset, t);
  }

  /** Signed curvature at arc length `s`: positive left, zero on straights. */
  function curvatureAt(s) {
    const piece = track.pieces[locate(s).index];
    if (piece.type === 'straight') return 0;
    return Math.sign(piece.angle) / laneRadius(piece, offset);
  }

  /**
   * Samples the lane at evenly spaced arc lengths, for drawing. The last
   * sample coincides with the first one, so the polyline is closed.
   * @param {number} spacing Maximum distance between samples in meters.
   */
  function sample(spacing) {
    assertPositiveFinite(spacing, 'spacing');
    const count = Math.ceil(length / spacing);
    const step = length / count;
    const samples = [];
    for (let i = 0; i <= count; i += 1) {
      const s = i * step;
      const { x, y, heading } = poseAt(s);
      samples.push({ s, x, y, heading, curvature: curvatureAt(s) });
    }
    return samples;
  }

  return { offset, length, poseAt, curvatureAt, sample };
}
