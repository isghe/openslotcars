import { readFile } from 'node:fs/promises';
import { createCircuitCatalog } from '../../src/core/circuits.js';
import { parseMathConstants } from '../../src/core/mathConstants.js';
export { buildCircuit } from '../../src/core/circuits.js';
const base = new URL('../../circuits/', import.meta.url);
const files = JSON.parse(await readFile(new URL('index.json', base), 'utf8'));
const constants = parseMathConstants(JSON.parse(await readFile(new URL('math.json', base), 'utf8')));
const catalog = createCircuitCatalog(await Promise.all(files.map(async file =>
  JSON.parse(await readFile(new URL(file, base), 'utf8')))), constants);
export const CIRCUITS = catalog.circuits;
export const circuitById = catalog.byId;
export const OVAL = catalog.byId('oval');
export const CHICANE = catalog.byId('chicane');
export const TEARDROP = catalog.byId('teardrop');
export const CLUB = catalog.byId('club');
