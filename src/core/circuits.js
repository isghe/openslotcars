/** Pure circuit validation and geometry. Distances: meters; angles: radians. */
import { straight, curve, createTrack, createLane } from './geometry.js';
import { resolveNumber } from './mathConstants.js';

function fields(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError(`${path}: expected fields ${keys.join(', ')}`);
  }
}

/** Validates and copies JSON data into a deeply frozen definition. */
export function parseCircuitDefinition(value, constants = {}) {
  const finite = (number, path) => resolveNumber(number, constants, path);
  fields(value, ['id', 'name', 'pieces', 'start', 'trackWidth', 'lanes'], 'circuit');
  if (typeof value.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) throw new TypeError('id: invalid identifier');
  const path = value.id;
  if (typeof value.name !== 'string' || !value.name.trim() || value.name !== value.name.trim()) throw new TypeError(`${path}.name: expected a trimmed name`);
  fields(value.start, ['x', 'y', 'heading'], `${path}.start`);
  const start = Object.freeze(Object.fromEntries(['x', 'y', 'heading'].map(key => [key, finite(value.start[key], `${path}.start.${key}`)])));
  const width = finite(value.trackWidth, `${path}.trackWidth`);
  if (width <= 0) throw new RangeError(`${path}.trackWidth: must be positive`);
  fields(value.lanes, ['inner', 'outer'], `${path}.lanes`);
  const lanes = Object.freeze(Object.fromEntries(['inner', 'outer'].map(key => {
    const offset = finite(value.lanes[key], `${path}.lanes.${key}`);
    if (Math.abs(offset) >= width / 2) throw new RangeError(`${path}.lanes.${key}: outside track`);
    return [key, offset];
  })));
  if (!Array.isArray(value.pieces) || !value.pieces.length) throw new TypeError(`${path}.pieces: expected a nonempty array`);
  const pieces = Object.freeze(value.pieces.map((piece, i) => {
    const location = `${path}.pieces[${i}]`;
    try {
      if (piece?.type === 'straight') {
        fields(piece, ['type', 'length'], location);
        return straight(finite(piece.length, `${location}.length`));
      }
      if (piece?.type === 'curve') {
        fields(piece, ['type', 'radius', 'angle'], location);
        const radius = finite(piece.radius, `${location}.radius`);
        if (radius <= width / 2) throw new RangeError('radius must exceed half the track width');
        return curve(radius, finite(piece.angle, `${location}.angle`));
      }
      throw new TypeError('unknown piece type');
    } catch (error) { throw new TypeError(`${location}: ${error.message}`, { cause: error }); }
  }));
  if (pieces[0].type !== 'straight' || pieces.at(-1).type !== 'straight') throw new RangeError(`${path}.pieces: finish line must be on a straight`);
  const turns = pieces.filter(piece => piece.type === 'curve');
  const mixed = turns.some(piece => piece.angle > 0) && turns.some(piece => piece.angle < 0);
  const direction = mixed ? -1 : 1;
  if (Math.abs(turns.reduce((sum, piece) => sum + piece.angle, 0) - direction * 2 * Math.PI) > 1e-9
    || Math.sign(lanes.inner) !== direction || Math.sign(lanes.outer) !== -direction) throw new RangeError(`${path}: violates circuit direction rule`);
  const definition = Object.freeze({ id: value.id, name: value.name, pieces, start, trackWidth: width, lanes });
  try {
    const built = buildCircuit(definition);
    if (built.lanes.inner.length >= built.lanes.outer.length) throw new RangeError('inner lane must be shorter');
  } catch (error) { throw new RangeError(`${path}: ${error.message}`, { cause: error }); }
  return definition;
}

/** Complete immutable catalog with synchronous lookups and no global state. */
export function createCircuitCatalog(definitions, constants = {}) {
  if (!Array.isArray(definitions) || !definitions.length) throw new TypeError('catalog: expected definitions');
  const circuits = Object.freeze(definitions.map(value => parseCircuitDefinition(value, constants)));
  const lookup = new Map();
  const aliases = new Map();
  for (const circuit of circuits) {
    if (lookup.has(circuit.id)) throw new RangeError(`duplicate circuit id: ${circuit.id}`);
    lookup.set(circuit.id, circuit);
    for (const alias of [circuit.id, circuit.name.toLowerCase()]) {
      if (aliases.has(alias) && aliases.get(alias) !== circuit.id) throw new RangeError(`ambiguous circuit name: ${alias}`);
      aliases.set(alias, circuit.id);
    }
  }
  return Object.freeze({ circuits, byId(id) {
    if (!lookup.has(id)) throw new RangeError(`unknown circuit: ${id}`);
    return lookup.get(id);
  } });
}

/** Builds independent track and lane geometry from a definition. */
export function buildCircuit(definition) {
  const track = createTrack([...definition.pieces], { ...definition.start });
  const lanes = {};
  for (const [name, offset] of Object.entries(definition.lanes)) lanes[name] = createLane(track, offset);
  return { id: definition.id, name: definition.name, trackWidth: definition.trackWidth, track, lanes };
}
