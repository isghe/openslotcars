import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMathConstants, resolveNumber } from '../src/core/mathConstants.js';
import { parseCircuitDefinition } from '../src/core/circuits.js';
import { OVAL } from './helpers/circuits.js';

test('constant definitions are copied, frozen and restricted to finite numeric values', () => {
  const raw = { PI: Math.PI };
  const constants = parseMathConstants(raw);
  raw.PI = 1;
  assert.equal(constants.PI, Math.PI);
  assert.ok(Object.isFrozen(constants));
  for (const invalid of [null, [], 'Math.PI', { Pi: 1 }, { PI: '3.14' }, { PI: Infinity }, { PI: NaN }, { PI: null }]) {
    assert.throws(() => parseMathConstants(invalid));
  }
});
test('references resolve exactly while expressions, missing and inherited names are rejected', () => {
  const constants = parseMathConstants({ HALF_PI: Math.PI / 2 });
  assert.equal(resolveNumber('Math.HALF_PI', constants, 'angle'), Math.PI / 2);
  assert.equal(resolveNumber(0.4, constants, 'radius'), 0.4);
  for (const text of ['Math.PI', 'Math.HALF_PI / 2', '-Math.HALF_PI', 'Math.constructor', '3.14', ' Math.HALF_PI', 'Math.Half_Pi']) {
    assert.throws(() => resolveNumber(text, constants, 'angle'), /angle/);
  }
  assert.throws(() => resolveNumber('Math.PI', Object.create({ PI: Math.PI }), 'angle'), /unknown constant/);
});
test('references work in every numeric circuit field without changing names or input', () => {
  const raw = structuredClone(OVAL);
  const constants = parseMathConstants({ ZERO: 0, ONE: 1, TWO: 2, WIDTH: .2, RADIUS: .4, INNER: .05, OUTER: -.05, PI: Math.PI });
  raw.name = 'Math.PI';
  raw.start = { x: 'Math.ZERO', y: 'Math.ZERO', heading: 'Math.ZERO' };
  raw.trackWidth = 'Math.WIDTH';
  raw.lanes = { inner: 'Math.INNER', outer: 'Math.OUTER' };
  for (const piece of raw.pieces) {
    if (piece.type === 'straight') piece.length = piece.length === 1 ? 'Math.ONE' : 'Math.TWO';
    else { piece.radius = 'Math.RADIUS'; piece.angle = 'Math.PI'; }
  }
  const result = parseCircuitDefinition(raw, constants);
  assert.deepEqual(result, { ...OVAL, name: 'Math.PI' });
  assert.equal(raw.start.x, 'Math.ZERO');
});
