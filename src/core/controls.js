/**
 * Player controls, independent of the browser.
 *
 * The page reports key and pointer events to this module, which keeps the
 * state of the controls and tells the throttle to apply. Keeping it apart from
 * the DOM makes the rules testable in Node.
 *
 * Throttle: while at least one throttle key is held, or one pointer is
 * pressing the throttle button, the throttle rises linearly from 0 to 1 in
 * `rampTime` seconds; as soon as everything is released it falls to 0 at once
 * (motor braking). Tapping briefly therefore gives a partial throttle, which
 * is what holds the car in a curve.
 *
 * The ramp is advanced with `step(dt)`, once per fixed simulation step, so the
 * throttle does not depend on the frame rate.
 */

/** Time to go from a released to a fully pressed throttle, in seconds. */
export const THROTTLE_RAMP_TIME = 0.4;

/**
 * Keys of the game, by `KeyboardEvent.code` (independent of the layout).
 * Holding `Space` or `ArrowUp` accelerates; `KeyP` and `Escape` toggle the
 * pause; `KeyR` restarts.
 */
export const KEY_ACTIONS = Object.freeze({
  Space: 'throttle',
  ArrowUp: 'throttle',
  KeyP: 'pause',
  Escape: 'pause',
  KeyR: 'restart',
});

/**
 * Creates the controls state.
 * @param {{rampTime?: number}} [options]
 */
export function createControls({ rampTime = THROTTLE_RAMP_TIME } = {}) {
  if (!Number.isFinite(rampTime) || rampTime <= 0) {
    throw new RangeError(`rampTime must be a positive finite number, got ${rampTime}`);
  }

  const heldKeys = new Set();
  const pressingPointers = new Set();
  let level = 0;
  let paused = false;
  let restartPending = false;

  const demanding = () => heldKeys.size > 0 || pressingPointers.size > 0;

  return {
    /**
     * Reports a key going down.
     * @param {string} code `KeyboardEvent.code` of the key.
     * @param {{repeat?: boolean}} [options] `repeat` is true for the
     *   auto-repeat events sent while a key is held.
     * @returns {boolean} Whether the key belongs to the game, so that the page
     *   can stop the browser from using it (for example to scroll).
     */
    keyDown(code, { repeat = false } = {}) {
      const action = KEY_ACTIONS[code];
      if (action === undefined) return false;
      if (action === 'throttle') {
        heldKeys.add(code);
      } else if (!repeat) {
        if (action === 'pause') this.togglePause();
        else restartPending = true;
      }
      return true;
    },

    /** Reports a key going up. Returns whether the key belongs to the game. */
    keyUp(code) {
      const action = KEY_ACTIONS[code];
      if (action === undefined) return false;
      if (action === 'throttle') heldKeys.delete(code);
      return true;
    },

    /** Whether a throttle key is held down right now. */
    isHeld(code) {
      return heldKeys.has(code);
    },

    /** A pointer (mouse, finger or pen) starts pressing the throttle button. */
    pointerDown(pointerId) {
      pressingPointers.add(pointerId);
    },

    /** A pointer stops pressing the throttle button, or is cancelled. */
    pointerUp(pointerId) {
      pressingPointers.delete(pointerId);
    },

    /** Releases every key and pointer, for example when the window loses focus. */
    releaseAll() {
      heldKeys.clear();
      pressingPointers.clear();
    },

    /** Pauses or resumes. Pausing drops the throttle to zero. */
    setPaused(value) {
      paused = Boolean(value);
      if (paused) level = 0;
    },

    togglePause() {
      this.setPaused(!paused);
    },

    /** Asks for a restart of the race. */
    requestRestart() {
      restartPending = true;
    },

    /** Tells whether a restart was requested, and clears the request. */
    takeRestart() {
      const pending = restartPending;
      restartPending = false;
      return pending;
    },

    /** Sets the throttle back to zero, for example after a restart. */
    resetThrottle() {
      level = 0;
    },

    /**
     * Advances the throttle ramp by one fixed step; call it once per
     * simulation step, and not while paused.
     * @param {number} dt Duration of the step in seconds.
     */
    step(dt) {
      if (!Number.isFinite(dt) || dt <= 0) {
        throw new RangeError(`dt must be a positive finite number, got ${dt}`);
      }
      level = demanding() ? Math.min(1, level + dt / rampTime) : 0;
    },

    /** Throttle to apply, from 0 to 1. */
    get throttle() {
      return level;
    },

    /** Whether the player is asking for throttle right now. */
    get demanding() {
      return demanding();
    },

    get paused() {
      return paused;
    },
  };
}
