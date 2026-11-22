import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLapTimer, advanceTimer } from '../src/core/lapTimer.js';
import { createContext, createWorld } from '../src/core/simulation.js';
import { createRenderer } from '../src/ui/render.js';
import { CIRCUITS, buildCircuit } from './helpers/circuits.js';

function surface() {
  const rectangles = [];
  return new Proxy({
    rectangles,
    fillRect(...bounds) { rectangles.push({ color: this.fillStyle, bounds }); },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
}

for (const definition of CIRCUITS) {
  test(`${definition.name}: sector colors follow the clock through a lap and reset`, () => {
    const circuit = buildCircuit(definition);
    const context = createContext({ lane: circuit.lanes.inner });
    const drawing = surface();
    const canvas = {
      clientWidth: 1000, clientHeight: 400,
      getContext: () => drawing,
      ownerDocument: { createElement: () => ({ getContext: () => surface() }) },
    };
    const renderer = createRenderer(canvas, circuit, context);
    let timer = createLapTimer();
    let previousTime = 0;
    let previousDistance = -0.1;
    const draw = (options = {}) => {
      drawing.rectangles.length = 0;
      renderer.draw({ ...createWorld(context), timer }, { steps: [], ...options });
      return {
        green: drawing.rectangles.filter(rectangle => rectangle.color === '#00ff66').length,
        purple: drawing.rectangles.filter(rectangle => rectangle.color === '#c060ff').length,
        yellow: drawing.rectangles.filter(rectangle => rectangle.color === '#ffd400'
          && Math.abs(rectangle.bounds[2] - rectangle.bounds[3]) < 1e-9).length,
      };
    };
    assert.deepEqual(draw(), { green: 0, purple: 0, yellow: 0 });
    for (let boundary = 0; boundary <= 4; boundary += 1) {
      const distance = context.laneLength * boundary / 4;
      ({ timer } = advanceTimer(timer, {
        previousTime, dt: 1, previousDistance, distance, laneLength: context.laneLength,
      }));
      previousTime += 1;
      previousDistance = distance;
      assert.deepEqual(draw(), { green: 2 * boundary, purple: 2 * boundary, yellow: 0 });
    }
    assert.equal(timer.laps[0].sectors.length, 4);
    assert.ok(Math.abs(timer.laps[0].time - 4) < 1e-9);
    for (const sector of timer.laps[0].sectors) assert.ok(Math.abs(sector.time - 1) < 1e-9);
    renderer.resize();
    renderer.setDisplayOptions({ curbs: true, curveMarkers: true });
    assert.deepEqual(draw(), { green: 8, purple: 8, yellow: 0 });
    const rectanglesWithFeedback = drawing.rectangles.length;
    renderer.setDisplayOptions({ curbs: true, curveMarkers: true, sectorFeedback: false });
    assert.deepEqual(draw(), { green: 0, purple: 0, yellow: 0 });
    assert.equal(drawing.rectangles.length, rectanglesWithFeedback - 16);
    assert.deepEqual(draw({ paused: true }), { green: 0, purple: 0, yellow: 0 });
    renderer.setDisplayOptions({ curbs: true, curveMarkers: true, sectorFeedback: true });
    assert.deepEqual(draw(), { green: 8, purple: 8, yellow: 0 });
    // A renderer opened with the option off omits all squares from its first draw.
    const hiddenRenderer = createRenderer(canvas, circuit, context, { sectorFeedback: false });
    drawing.rectangles.length = 0;
    hiddenRenderer.draw({ ...createWorld(context), timer }, { steps: [] });
    assert.equal(drawing.rectangles.length, rectanglesWithFeedback - 16);
    assert.ok(drawing.rectangles.every(rectangle => !['#00ff66', '#c060ff'].includes(rectangle.color)));
    // Slower attempts turn sector squares yellow and clear cumulative squares.
    for (let boundary = 1; boundary <= 4; boundary += 1) {
      const distance = context.laneLength * (1 + boundary / 4);
      ({ timer } = advanceTimer(timer, {
        previousTime, dt: 2, previousDistance, distance, laneLength: context.laneLength,
      }));
      previousTime += 2;
      previousDistance = distance;
      assert.deepEqual(draw(), { green: 2 * (4 - boundary), purple: 2 * (4 - boundary), yellow: 2 * boundary });
    }
    timer = createLapTimer();
    assert.deepEqual(draw(), { green: 0, purple: 0, yellow: 0 });
  });
}
