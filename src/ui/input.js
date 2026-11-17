/**
 * Connects the keyboard, the touch button and the pause and restart buttons to
 * the controls state.
 *
 * Keys are read with `KeyboardEvent.code`, so they do not depend on the
 * keyboard layout. The game can be played without a mouse.
 */

/** Whether a key event comes from a field where the player is typing. */
function isTypingTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

/**
 * @param {{controls: object, throttleButton: HTMLElement, pauseButton: HTMLElement,
 *   restartButton: HTMLElement}} elements
 */
export function bindInput({ controls, throttleButton, pauseButton, restartButton }) {
  /**
   * Space on a focused button must activate that button, as usual; only the
   * throttle button hands Space over to the game.
   */
  function leavesKeyToButton(event) {
    return event.code === 'Space'
      && event.target instanceof HTMLButtonElement
      && event.target !== throttleButton;
  }

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (isTypingTarget(event.target) || leavesKeyToButton(event)) return;
    if (controls.keyDown(event.code, { repeat: event.repeat })) event.preventDefault();
  });

  window.addEventListener('keyup', (event) => {
    if (leavesKeyToButton(event)) return;
    if (controls.keyUp(event.code)) event.preventDefault();
  });

  // The throttle button: a pointer pressing it counts until it is released,
  // moves away or is cancelled, so the throttle never stays stuck.
  throttleButton.addEventListener('pointerdown', (event) => {
    throttleButton.setPointerCapture?.(event.pointerId);
    controls.pointerDown(event.pointerId);
    event.preventDefault();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    throttleButton.addEventListener(type, (event) => controls.pointerUp(event.pointerId));
  }
  // A long press on a touch screen would open a context menu.
  throttleButton.addEventListener('contextmenu', (event) => event.preventDefault());

  // After a mouse or touch click, give the focus back to the page: a focused
  // button would otherwise take Space away from the game.
  function afterClick(button) {
    return (event) => {
      if (event.detail !== 0) button.blur();
    };
  }
  pauseButton.addEventListener('click', (event) => {
    controls.togglePause();
    afterClick(pauseButton)(event);
  });
  restartButton.addEventListener('click', (event) => {
    controls.requestRestart();
    afterClick(restartButton)(event);
  });

  // Losing the focus or hiding the page must not leave the throttle pressed.
  function interrupt() {
    controls.releaseAll();
    controls.setPaused(true);
  }
  window.addEventListener('blur', interrupt);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) interrupt();
  });
}
