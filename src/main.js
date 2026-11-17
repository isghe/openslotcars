/**
 * Entry point: wires the game to the page.
 *
 * The rules of a frame (fixed steps, pause, restart) are in `core/game.js`;
 * here the page elements are connected to them. The drawing is interpolated
 * between the last two states, so it is smooth at any screen refresh rate.
 */

import { OVAL, buildCircuit } from './core/circuits.js';
import { createControls } from './core/controls.js';
import { createGame } from './core/game.js';
import { createContext } from './core/simulation.js';
import { createHud } from './ui/hud.js';
import { bindInput } from './ui/input.js';
import { createRenderer } from './ui/render.js';

const canvas = document.getElementById('track');
const throttleButton = document.getElementById('throttle');
const pauseButton = document.getElementById('pause');
const restartButton = document.getElementById('restart');

const hud = createHud({
  currentLap: document.getElementById('current-lap'),
  lastLap: document.getElementById('last-lap'),
  bestLap: document.getElementById('best-lap'),
  laps: document.getElementById('laps'),
  announcer: document.getElementById('announcer'),
});

const circuit = buildCircuit(OVAL);
const context = createContext({ lane: circuit.lanes.inner, rules: { tailSlide: true } });
const controls = createControls();
const game = createGame({ context, controls });
const renderer = createRenderer(canvas, circuit, context);
bindInput({ controls, throttleButton, pauseButton, restartButton });

hud.update(game.world);

/** Keeps the pressed state of the buttons in line with the controls. */
function syncButtons() {
  throttleButton.setAttribute('aria-pressed', String(controls.demanding));
  pauseButton.setAttribute('aria-pressed', String(controls.paused));
}

function frame(now) {
  const result = game.frame(now);
  if (result.restarted) hud.restart(result.world);
  syncButtons();

  if (result.paused) {
    renderer.draw(result.drawn, { paused: true });
  } else {
    hud.update(result.world);
    renderer.draw(result.drawn);
  }
  requestAnimationFrame(frame);
}

// After the page was hidden the elapsed time is meaningless: start over.
document.addEventListener('visibilitychange', () => game.resetClock());

new ResizeObserver(() => renderer.resize()).observe(canvas);
requestAnimationFrame(frame);
