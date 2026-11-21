/** HTTP loading stays outside the pure circuit model. */
import { createCircuitCatalog, parseCircuitDefinition } from '../core/circuits.js';

export async function loadCircuits({ fetchImpl = globalThis.fetch,
  baseUrl = new URL('../../circuits/', import.meta.url) } = {}) {
  async function read(file) {
    try {
      const response = await fetchImpl(new URL(file, baseUrl));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) { throw new Error(`${file}: ${error.message}`, { cause: error }); }
  }
  const files = await read('index.json');
  if (!Array.isArray(files) || !files.length
    || files.some(file => typeof file !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(file) || file === 'index.json')
    || new Set(files).size !== files.length) throw new TypeError('index.json: expected unique circuit filenames');
  const definitions = await Promise.all(files.map(async file => {
    const definition = await read(file);
    if (definition?.id !== file.slice(0, -5)) throw new Error(`${file}: id must match filename`);
    try { return parseCircuitDefinition(definition); }
    catch (error) { throw new Error(`${file}: ${error.message}`, { cause: error }); }
  }));
  const catalog = createCircuitCatalog(definitions);
  if (!catalog.circuits.some(c => c.id === 'oval')) throw new Error('index.json: missing default circuit oval');
  return catalog;
}
