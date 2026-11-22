import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, createWorld } from '../src/core/simulation.js';
import { buildCircuit, OVAL } from './helpers/circuits.js';
import { createHud } from '../src/ui/hud.js';

function setup() {
  const elements = {
    currentLap: { textContent: '' },
    lastLap: { textContent: '' },
    bestLap: { textContent: '' },
    bestSectorsSum: { textContent: '' },
    laps: { textContent: '' },
    announcer: { textContent: '' },
  };
  const context = createContext({ lane: buildCircuit(OVAL).lanes.inner });
  return { elements, hud: createHud(elements), world: createWorld(context) };
}

test('a restart announces the race restarted and shows the new world', () => {
  const { elements, hud, world } = setup();
  hud.restart(world);
  assert.equal(elements.announcer.textContent, 'Race restarted.');
  assert.equal(elements.laps.textContent, '0');
  assert.equal(elements.bestLap.textContent, 'none yet');
  assert.equal(elements.bestSectorsSum.textContent, 'none yet');
});

test('the best sectors sum updates and clears on restart', () => {
  const { elements, hud, world } = setup();
  const timed = {
    ...world,
    timer: {
      ...world.timer,
      bestSectors: [1.1, 1.2, 1.3, 1.4].map((time) => ({ time, valid: true })),
    },
  };
  hud.update(timed);
  assert.equal(elements.bestSectorsSum.textContent, '5.000 s');
  hud.restart(world);
  assert.equal(elements.bestSectorsSum.textContent, 'none yet');
});

test('a restart can announce another message, for example a new circuit', () => {
  const { elements, hud, world } = setup();
  hud.restart(world, 'Circuit changed to Chicane. Race restarted.');
  assert.equal(elements.announcer.textContent, 'Circuit changed to Chicane. Race restarted.');
  assert.equal(elements.currentLap.textContent, 'not started');
});
