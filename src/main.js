/**
 * Entry point: wires the simulation to the page.
 *
 * Every animation frame the real time elapsed is turned into a whole number of
 * fixed simulation steps; the drawing is interpolated between the last two
 * states, so it is smooth at any screen refresh rate.
 */

import { OVAL, buildCircuit } from './core/circuits.js';
import {
  createContext,
  createWorld,
  stepWorld,
  interpolateWorld,
} from './core/simulation.js';
import { createStepper } from './core/stepper.js';
import { createRenderer } from './ui/render.js';

const canvas = document.getElementById('track');
const circuit = buildCircuit(OVAL);
const context = createContext({ lane: circuit.lanes.inner });
const stepper = createStepper({ dt: context.dt });
const renderer = createRenderer(canvas, circuit, context);

let world = createWorld(context);
let previous = world;
let lastFrameTime = null;

// The throttle will come from the keyboard and the touch button.
function currentThrottle() {
  return 0;
}

function frame(now) {
  const elapsed = lastFrameTime === null ? 0 : (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  const { steps, alpha } = stepper.advance(elapsed);
  for (let i = 0; i < steps; i += 1) {
    previous = world;
    world = stepWorld(world, { throttle: currentThrottle() }, context);
  }
  renderer.draw(interpolateWorld(previous, world, alpha));
  requestAnimationFrame(frame);
}

// After the page was hidden the elapsed time is meaningless: start over.
document.addEventListener('visibilitychange', () => {
  lastFrameTime = null;
  stepper.reset();
});

new ResizeObserver(() => renderer.resize()).observe(canvas);
requestAnimationFrame(frame);
