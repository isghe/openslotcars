/**
 * Entry point: wires the game to the page.
 *
 * The rules of a frame (fixed steps, pause, restart) are in `core/game.js`;
 * here the page elements are connected to them. The drawing is interpolated
 * between the last two states, so it is smooth at any screen refresh rate.
 */

import { buildCircuit } from './core/circuits.js';
import { loadCircuits } from './data/loadCircuits.js';
import { createTimingStorage } from './data/timingStorage.js';
import { createControls } from './core/controls.js';
import { createGame } from './core/game.js';
import { createContext } from './core/simulation.js';
import { createHud } from './ui/hud.js';
import { createFrameMeter } from './ui/frameMeter.js';
import { addressWithCircuit, bindCircuitSelect, circuitFromSearch } from './ui/circuitSelect.js';
import { addressWithDisplayOption, bindDisplayMenu, displayOptionsFromSearch } from './ui/displayOptions.js';
import { bindInput } from './ui/input.js';
import { createRenderer } from './ui/render.js';

const displayOptions = displayOptionsFromSearch(window.location.search);
const displayCheckboxes = {
  curbs: document.getElementById('show-curbs'),
  curveMarkers: document.getElementById('show-curve-markers'),
  sectorFeedback: document.getElementById('show-sector-feedback'),
  frameMeter: document.getElementById('show-frame-meter'),
};
for (const [option, checkbox] of Object.entries(displayCheckboxes)) {
  checkbox.checked = displayOptions[option];
}
bindDisplayMenu({
  menu: document.getElementById('display-menu'),
  button: document.getElementById('display-toggle'),
  panel: document.getElementById('display-options'),
});

const loadingControls = document.querySelectorAll('.controls button, .controls select, .display-options input');

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
  const resetTimesButton = document.getElementById('reset-times');

  const hud = createHud({
    currentLap: document.getElementById('current-lap'),
    lastLap: document.getElementById('last-lap'),
    bestLap: document.getElementById('best-lap'),
    bestLapNumber: document.getElementById('best-lap-number'),
    bestLapSectors: document.getElementById('best-lap-sectors'),
    bestSectorsSum: document.getElementById('best-sectors-sum'),
    bestSectorLaps: document.getElementById('best-sector-laps'),
    laps: document.getElementById('laps'),
    announcer: document.getElementById('announcer'),
  });

  const controls = createControls();
  const frameMeter = createFrameMeter(document.getElementById('frame-meter'));
  frameMeter.setVisible(displayOptions.frameMeter);

  let game;
  let renderer;
  let timingStorage;
  let activeCircuit;
  const timingArchives = new Map();

  /** Builds the circuit, the car on it and the drawing, and shows its name. */
  function startCircuit(definition) {
    const circuit = buildCircuit(definition);
    const context = createContext({ lane: circuit.lanes.inner });
    document.getElementById('lateral-grip').textContent = String(context.params.maxLateralAcceleration);
    activeCircuit = definition;
    if (!timingArchives.has(definition.id)) {
      timingArchives.set(definition.id, createTimingStorage({
        getStorage: () => window.localStorage,
        circuitId: definition.id,
        signature: JSON.stringify({ definition, params: context.params,
          dt: context.dt, tailSlide: context.tailSlide, recoverySteps: context.recoverySteps }),
      }));
    }
    timingStorage = timingArchives.get(definition.id);
    game = createGame({ context, controls, initialTimer: timingStorage.load() });
    renderer = createRenderer(canvas, circuit, context, displayOptions);
    document.title = `OpenSlotCars - ${circuit.name}`;
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
  resetTimesButton.addEventListener('click', (event) => {
    // Pointer clicks return focus to the track before the dialog can restore it.
    // Keyboard activation keeps focus on the button, like Pause and Restart.
    if (event.detail !== 0) resetTimesButton.blur();
    const lapCount = game.world.timer.laps.length;
    const lapLabel = lapCount === 1 ? 'lap' : 'laps';
    if (!window.confirm(`Reset all saved lap and sector times for ${activeCircuit.name}? ${lapCount} ${lapLabel} will be deleted. This cannot be undone.`)) return;
    if (!timingStorage.clear()) {
      document.getElementById('announcer').textContent = 'Unable to reset saved times. Please check browser storage permissions.';
      return;
    }
    startCircuit(activeCircuit);
    controls.resetThrottle();
    controls.setPaused(false);
    hud.restart(game.world, `Lap and sector times reset for ${activeCircuit.name}.`);
  });
  if (document.hidden) controls.setPaused(true);

  for (const [option, checkbox] of Object.entries(displayCheckboxes)) {
    checkbox.addEventListener('change', () => {
      displayOptions[option] = checkbox.checked;
      renderer.setDisplayOptions(displayOptions);
      frameMeter.setVisible(displayOptions.frameMeter);
      try {
        window.history.replaceState(
          window.history.state,
          '',
          addressWithDisplayOption(window.location.href, option, checkbox.checked),
        );
      } catch {
        // The display options still apply if the browser refuses the address change.
      }
    });
  }

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
    const workStart = performance.now();
    const result = game.frame(now);
    const simulated = performance.now();
    timingStorage.save(result.world.timer);
    const saved = performance.now();
    if (result.restarted) hud.restart(result.world);
    syncButtons();

    const { steps, restarted } = result;
    if (result.paused) {
      renderer.draw(result.drawn, { paused: true, steps, restarted });
    } else {
      hud.update(result.world);
      renderer.draw(result.drawn, { steps, restarted });
    }
    // In a pause the figures stay on screen as they were, to be read.
    if (result.paused) frameMeter.gap();
    else {
      frameMeter.add(now, {
        sim: simulated - workStart,
        save: saved - simulated,
        draw: performance.now() - saved,
      });
    }
    requestAnimationFrame(frame);
  }

  // After the page was hidden the elapsed time is meaningless: start over.
  document.addEventListener('visibilitychange', () => {
    game.resetClock();
    frameMeter.gap();
  });

  new ResizeObserver(() => renderer.resize()).observe(canvas);
  requestAnimationFrame(frame);

  for (const control of loadingControls) control.disabled = false;
  document.getElementById('loading-status').textContent = '';
  document.getElementById('loading-status').hidden = true;
}

start().catch(error => {
  console.error('Circuit loading failed:', error);
  document.getElementById('loading-status').hidden = false;
  document.getElementById('loading-status').textContent = 'Unable to load circuits. Please reload the page.';
  for (const control of loadingControls) control.disabled = true;
});
