import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIRCUITS } from '../src/core/circuits.js';
import { bindCircuitSelect } from '../src/ui/circuitSelect.js';

/** Minimal stand-in for the menu: it records listeners, options and blurs. */
function fakeSelect() {
  const listeners = new Map();
  return {
    tagName: 'SELECT',
    value: '',
    options: [],
    blurred: 0,
    append(option) { this.options.push(option); },
    blur() { this.blurred += 1; },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    fire(type) {
      for (const listener of listeners.get(type) ?? []) listener({ type });
    },
    /** What the browser does when the player picks an option. */
    choose(id) {
      this.value = id;
      this.fire('change');
    },
  };
}

function setup(selectedId = 'oval') {
  const select = fakeSelect();
  const chosen = [];
  const documentTarget = {
    createElement(tag) {
      assert.equal(tag, 'option');
      return {};
    },
  };
  bindCircuitSelect({
    select,
    circuits: CIRCUITS,
    selectedId,
    onChange: (id) => chosen.push(id),
    documentTarget,
  });
  return { select, chosen };
}

test('the menu offers every circuit, in order, with its name', () => {
  const { select } = setup();
  assert.deepEqual(
    select.options.map((option) => [option.value, option.textContent]),
    [
      ['oval', 'Oval'],
      ['speedway', 'Speedway'],
      ['chicane', 'Chicane'],
      ['teardrop', 'Teardrop'],
    ],
  );
});

test('the menu starts on the circuit in use, and nothing is chosen yet', () => {
  const { select, chosen } = setup('teardrop');
  assert.equal(select.value, 'teardrop');
  assert.deepEqual(chosen, []);
});

test('a choice is reported with the identifier of the circuit', () => {
  const { select, chosen } = setup();
  select.choose('chicane');
  select.choose('oval');
  assert.deepEqual(chosen, ['chicane', 'oval']);
});

test('after a choice with the mouse or a finger the focus goes back to the page', () => {
  const { select } = setup();
  select.fire('pointerdown');
  select.choose('speedway');
  assert.equal(select.blurred, 1);
});

test('after a choice with the keyboard the menu keeps the focus', () => {
  const { select, chosen } = setup();
  select.fire('keydown');
  select.choose('speedway');
  select.choose('chicane');
  assert.equal(select.blurred, 0);
  assert.deepEqual(chosen, ['speedway', 'chicane']);
});

test('the last way of choosing counts: the pointer after the keyboard, and back', () => {
  const { select } = setup();
  select.fire('keydown');
  select.fire('pointerdown');
  select.choose('speedway');
  assert.equal(select.blurred, 1);
  select.fire('keydown');
  select.choose('chicane');
  assert.equal(select.blurred, 1);
});
