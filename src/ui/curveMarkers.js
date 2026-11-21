import { createLane } from '../core/geometry.js';

/** Poses at every curve piece boundary, including joins between arcs. */
export function curveBoundaries(track) {
  return track.pieces.flatMap((piece, index, pieces) => {
    const previous = pieces[(index + pieces.length - 1) % pieces.length];
    if (piece.type !== 'curve' && previous.type !== 'curve') return [];
    return [{ ...piece.start }];
  });
}

/** Midpoints of individual arcs and continuous straights, including the seam. */
export function sectionMidpoints(track) {
  const center = createLane(track, 0);
  let distance = 0;
  const starts = track.pieces.map(piece => {
    const start = distance;
    distance += piece.type === 'straight' ? piece.length : piece.radius * Math.abs(piece.angle);
    return start;
  });
  return track.pieces.flatMap((piece, index, pieces) => {
    if (piece.type === 'curve') {
      return [center.poseAt(starts[index] + piece.radius * Math.abs(piece.angle) / 2)];
    }
    if (pieces[(index + pieces.length - 1) % pieces.length].type === 'straight') return [];
    let length = piece.length;
    for (let next = (index + 1) % pieces.length; next !== index && pieces[next].type === 'straight'; next = (next + 1) % pieces.length) {
      length += pieces[next].length;
    }
    return [center.poseAt(starts[index] + length / 2)];
  });
}
