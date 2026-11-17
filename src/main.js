/**
 * Entry point: wires the simulation to the page.
 *
 * Every animation frame the real time elapsed is turned into a whole number of
 * fixed simulation steps; the drawing is interpolated between the last two
 * states, so it is smooth at any screen refresh rate. The throttle ramp of the
 * controls advances once per simulation step, so the feel of the game does not
 * depend on the screen either.
 */

import { OVAL, buildCircuit } from './core/circuits.js';
import { createControls } from './core/controls.js';
import {
  createContext,
  createWorld,
  stepWorld,
  interpolateWorld,
} from './core/simulation.js';
import { createStepper } from './core/stepper.js';
import { bindInput } from './ui/input.js';
import { createRenderer } from './ui/render.js';

const canvas = document.getElementById('track');
const throttleButton = document.getElementById('throttle');
const pauseButton = document.getElementById('pause');
const restartButton = document.getElementById('restart');

const circuit = buildCircuit(OVAL);
const context = createContext({ lane: circuit.lanes.inner });
const stepper = createStepper({ dt: context.dt });
const renderer = createRenderer(canvas, circuit, context);
const controls = createControls();
bindInput({ controls, throttleButton, pauseButton, restartButton });

let world = createWorld(context);
let previous = world;
let lastFrameTime = null;

/** Keeps the pressed state of the buttons in line with the controls. */
function syncButtons() {
  throttleButton.setAttribute('aria-pressed', String(controls.demanding));
  pauseButton.setAttribute('aria-pressed', String(controls.paused));
}

function restart() {
  world = createWorld(context);
  previous = world;
  stepper.reset();
  controls.resetThrottle();
  controls.setPaused(false);
}

function frame(now) {
  if (controls.takeRestart()) restart();
  syncButtons();

  if (controls.paused) {
    // No time passes while paused: start over from the next frame.
    lastFrameTime = null;
    stepper.reset();
    renderer.draw(world, { paused: true });
    requestAnimationFrame(frame);
    return;
  }

  const elapsed = lastFrameTime === null ? 0 : (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  const { steps, alpha } = stepper.advance(elapsed);
  for (let i = 0; i < steps; i += 1) {
    controls.step(context.dt);
    previous = world;
    world = stepWorld(world, { throttle: controls.throttle }, context);
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
