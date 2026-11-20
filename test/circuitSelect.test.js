import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIRCUITS, OVAL } from '../src/core/circuits.js';
import { addressWithCircuit, bindCircuitSelect, circuitFromSearch } from '../src/ui/circuitSelect.js';

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

test('the address chooses the circuit by identifier or by name, with or without the ?', () => {
  for (const circuit of CIRCUITS) {
    assert.equal(circuitFromSearch(`?circuit=${circuit.id}`, CIRCUITS, OVAL), circuit, circuit.id);
    assert.equal(circuitFromSearch(`circuit=${circuit.id}`, CIRCUITS, OVAL), circuit, circuit.id);
    assert.equal(circuitFromSearch(`?circuit=${circuit.name}`, CIRCUITS, OVAL), circuit, circuit.name);
  }
});

test('the case and the spaces around the circuit in the address do not matter', () => {
  const chicane = CIRCUITS.find((circuit) => circuit.id === 'chicane');
  assert.equal(circuitFromSearch('?circuit=CHICANE', CIRCUITS, OVAL), chicane);
  assert.equal(circuitFromSearch('?circuit=ChIcAnE', CIRCUITS, OVAL), chicane);
  assert.equal(circuitFromSearch('?circuit=%20chicane%20', CIRCUITS, OVAL), chicane);
  assert.equal(circuitFromSearch('?circuit=+chicane', CIRCUITS, OVAL), chicane);
});

test('an address that does not name a circuit gives the fallback', () => {
  for (const search of [
    '',
    '?',
    '?circuit',
    '?circuit=',
    '?circuit=%20',
    '?circuit=nowhere',
    '?circuit=chicane2',
    '?circuit=chi',
    '?circuits=chicane',
    '?Circuit=chicane',
    '?other=chicane',
  ]) {
    assert.equal(circuitFromSearch(search, CIRCUITS, OVAL), OVAL, JSON.stringify(search));
  }
  const speedway = CIRCUITS.find((circuit) => circuit.id === 'speedway');
  assert.equal(circuitFromSearch('?circuit=nowhere', CIRCUITS, speedway), speedway);
});

test('other arguments are ignored and, when the circuit is repeated, the first counts', () => {
  const teardrop = CIRCUITS.find((circuit) => circuit.id === 'teardrop');
  const speedway = CIRCUITS.find((circuit) => circuit.id === 'speedway');
  assert.equal(circuitFromSearch('?debug=1&circuit=teardrop&x=2', CIRCUITS, OVAL), teardrop);
  assert.equal(circuitFromSearch('?circuit=speedway&circuit=teardrop', CIRCUITS, OVAL), speedway);
  assert.equal(circuitFromSearch('?circuit=&circuit=teardrop', CIRCUITS, OVAL), OVAL);
});

test('the name of a circuit works even when it differs from its identifier', () => {
  const circuits = [
    { id: 'first', name: 'Long Straight' },
    { id: 'second', name: 'Hairpin' },
  ];
  const fallback = { id: 'none', name: 'None' };
  assert.equal(circuitFromSearch('?circuit=hairpin', circuits, fallback), circuits[1]);
  assert.equal(circuitFromSearch('?circuit=Long%20Straight', circuits, fallback), circuits[0]);
  assert.equal(circuitFromSearch('?circuit=long+straight', circuits, fallback), circuits[0]);
  assert.equal(circuitFromSearch('?circuit=first', circuits, fallback), circuits[0]);
  assert.equal(circuitFromSearch('?circuit=third', circuits, fallback), fallback);
});

test('the address gets the circuit, and keeps its path, its other arguments and its fragment', () => {
  assert.equal(
    addressWithCircuit('http://127.0.0.1:8080/', 'chicane'),
    'http://127.0.0.1:8080/?circuit=chicane',
  );
  assert.equal(
    addressWithCircuit('https://isghe.github.io/openslotcars/', 'teardrop'),
    'https://isghe.github.io/openslotcars/?circuit=teardrop',
  );
  assert.equal(
    addressWithCircuit('http://h/p/?debug=1&circuit=oval&x=2#top', 'speedway'),
    'http://h/p/?debug=1&circuit=speedway&x=2#top',
  );
});

test('the circuit of the address is replaced, never repeated', () => {
  assert.equal(
    addressWithCircuit('http://h/?circuit=oval&circuit=chicane', 'teardrop'),
    'http://h/?circuit=teardrop',
  );
  assert.equal(addressWithCircuit('http://h/?circuit=', 'oval'), 'http://h/?circuit=oval');
});

test('the address written for a circuit is read back as that circuit', () => {
  for (const circuit of CIRCUITS) {
    const written = addressWithCircuit('http://h/?debug=1', circuit.id);
    assert.equal(circuitFromSearch(new URL(written).search, CIRCUITS, OVAL), circuit, circuit.id);
  }
});
