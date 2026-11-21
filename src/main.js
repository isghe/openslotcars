/**
 * Entry point: wires the game to the page.
 *
 * The rules of a frame (fixed steps, pause, restart) are in `core/game.js`;
 * here the page elements are connected to them. The drawing is interpolated
 * between the last two states, so it is smooth at any screen refresh rate.
 */

import { buildCircuit } from './core/circuits.js';
import { loadCircuits } from './data/loadCircuits.js';
import { createControls } from './core/controls.js';
import { createGame } from './core/game.js';
import { createContext } from './core/simulation.js';
import { createHud } from './ui/hud.js';
import { addressWithCircuit, bindCircuitSelect, circuitFromSearch } from './ui/circuitSelect.js';
import { bindInput } from './ui/input.js';
import { createRenderer } from './ui/render.js';

async function start() {
  const catalog = await loadCircuits();
  const CIRCUITS = catalog.circuits;
  const OVAL = catalog.byId('oval');
  const circuitById = catalog.byId;
  const canvas = document.getElementById('track');
  const throttleButton = document.getElementById('throttle');
  const pauseButton = document.getElementById('pause');
  const restartButton = document.getElementById('restart');
  const circuitSelect = document.getElementById('circuit');

  const hud = createHud({
    currentLap: document.getElementById('current-lap'),
    lastLap: document.getElementById('last-lap'),
    bestLap: document.getElementById('best-lap'),
    laps: document.getElementById('laps'),
    announcer: document.getElementById('announcer'),
  });

  const controls = createControls();

  let game;
  let renderer;

  /** Builds the circuit, the car on it and the drawing, and shows its name. */
  function startCircuit(definition) {
    const circuit = buildCircuit(definition);
    const context = createContext({ lane: circuit.lanes.inner });
    game = createGame({ context, controls });
    renderer = createRenderer(canvas, circuit, context);
    canvas.setAttribute(
      'aria-label',
      `Top-down view of the ${circuit.name} slot car circuit with one car on the inner lane, near the finish line.`,
    );
  }

  // The circuit can be chosen in the address: `?circuit=chicane`. Without it, or
  // with a name that does not exist, the game starts on the oval.
  const firstCircuit = circuitFromSearch(window.location.search, CIRCUITS, OVAL);
  startCircuit(firstCircuit);
  hud.update(game.world);
  bindInput({ controls, throttleButton, pauseButton, restartButton });
  if (document.hidden) controls.setPaused(true);

  bindCircuitSelect({
    select: circuitSelect,
    circuits: CIRCUITS,
    selectedId: firstCircuit.id,
    onChange(id) {
      const definition = circuitById(id);
      startCircuit(definition);
      // A new circuit starts a new race, which also ends a pause.
      controls.resetThrottle();
      controls.setPaused(false);
      hud.restart(game.world, `Circuit changed to ${definition.name}. Race restarted.`);
      // After a choice the address names the circuit on the screen, so that
      // reloading the page or sharing the address brings it back. The entry of the
      // history is replaced, not added: the back button leaves the game as it
      // always did. If the browser refuses to change the address, the new circuit
      // is already running and only the address stays as it was; the error must
      // not escape, or the menu would keep the focus (see `bindCircuitSelect`).
      try {
        window.history.replaceState(
          window.history.state,
          '',
          addressWithCircuit(window.location.href, definition.id),
        );
      } catch {
        // Nothing else to do: the game does not depend on the address.
      }
    },
  });

  /** Keeps the pressed state of the buttons in line with the controls. */
  function syncButtons() {
    throttleButton.setAttribute('aria-pressed', String(controls.demanding));
    pauseButton.setAttribute('aria-pressed', String(controls.paused));
  }

  function frame(now) {
    const result = game.frame(now);
    if (result.restarted) hud.restart(result.world);
    syncButtons();

    const { steps, restarted } = result;
    if (result.paused) {
      renderer.draw(result.drawn, { paused: true, steps, restarted });
    } else {
      hud.update(result.world);
      renderer.draw(result.drawn, { steps, restarted });
    }
    requestAnimationFrame(frame);
  }

  // After the page was hidden the elapsed time is meaningless: start over.
  document.addEventListener('visibilitychange', () => game.resetClock());

  new ResizeObserver(() => renderer.resize()).observe(canvas);
  requestAnimationFrame(frame);

  for (const control of document.querySelectorAll('.controls button, .controls select')) control.disabled = false;
  document.getElementById('loading-status').textContent = '';
  document.getElementById('loading-status').hidden = true;
}

start().catch(error => {
  console.error('Circuit loading failed:', error);
  document.getElementById('loading-status').hidden = false;
  document.getElementById('loading-status').textContent = 'Unable to load circuits. Please reload the page.';
  for (const control of document.querySelectorAll('.controls button, .controls select')) control.disabled = true;
});
