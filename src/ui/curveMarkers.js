/** Poses at every curve piece boundary, including joins between arcs. */
export function curveBoundaries(track) {
  return track.pieces.flatMap((piece, index, pieces) => {
    const previous = pieces[(index + pieces.length - 1) % pieces.length];
    if (piece.type !== 'curve' && previous.type !== 'curve') return [];
    return [{ ...piece.start }];
  });
}
