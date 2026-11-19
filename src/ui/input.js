/**
 * Connects the keyboard, the touch button and the pause and restart buttons to
 * the controls state.
 *
 * Keys are read with `KeyboardEvent.code`, so they do not depend on the
 * keyboard layout. The game can be played without a mouse.
 *
 * The window and the document are parameters (they default to the real ones),
 * so the behavior can be tested in Node with simple stand-ins.
 */

/** Whether a key event comes from a field where the player is typing. */
function isTypingTarget(target) {
  return Boolean(target)
    && (target.isContentEditable === true
      || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

/**
 * @param {{controls: object, throttleButton: HTMLElement, pauseButton: HTMLElement,
 *   restartButton: HTMLElement, windowTarget?: EventTarget,
 *   documentTarget?: EventTarget & {hidden: boolean}}} elements
 */
export function bindInput({
  controls,
  throttleButton,
  pauseButton,
  restartButton,
  windowTarget = window,
  documentTarget = document,
}) {
  /**
   * Space on a focused button must activate that button, as usual; only the
   * throttle button hands Space over to the game.
   */
  function leavesKeyToButton(event) {
    return event.code === 'Space'
      && event.target?.tagName === 'BUTTON'
      && event.target !== throttleButton;
  }

  windowTarget.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (isTypingTarget(event.target) || leavesKeyToButton(event)) return;
    if (controls.keyDown(event.code, { repeat: event.repeat })) event.preventDefault();
  });

  windowTarget.addEventListener('keyup', (event) => {
    // A release is always registered, whoever has the focus now: the press may
    // have started on another element, before Tab moved the focus.
    const endsGamePress = controls.isHeld(event.code);
    const isGameKey = controls.keyUp(event.code);
    // Space on a focused button belongs to that button, unless this release
    // ends a press that the game started: then the browser must not also
    // activate the button that received the focus in the meantime.
    if (endsGamePress || (isGameKey && !leavesKeyToButton(event))) event.preventDefault();
  });

  // The throttle button: a pointer pressing it counts until it is released,
  // moves away or is cancelled, so the throttle never stays stuck.
  //
  // A touch screen can still lose the release (a system gesture, a finger that
  // slides off the screen edge): the throttle would then stay on, and neither
  // Restart nor another tap would end it. Three safeguards undo that, each
  // working on the touch fingers only, so a mouse press or a key is never
  // released by them.
  const touchPointers = new Set();

  function releasePointer(pointerId) {
    touchPointers.delete(pointerId);
    controls.pointerUp(pointerId);
  }

  function releaseTouches() {
    for (const pointerId of touchPointers) controls.pointerUp(pointerId);
    touchPointers.clear();
  }

  throttleButton.addEventListener('pointerdown', (event) => {
    throttleButton.setPointerCapture?.(event.pointerId);
    if (event.pointerType === 'touch') {
      // 1. The primary touch is the first finger of a gesture: no other finger
      //    can be on the screen, so any finger still counted is a lost one.
      if (event.isPrimary) releaseTouches();
      touchPointers.add(event.pointerId);
    }
    controls.pointerDown(event.pointerId);
    event.preventDefault();
  });
  // 2. The release may be sent to the window and not to the button.
  for (const target of [throttleButton, windowTarget]) {
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      target.addEventListener(type, (event) => releasePointer(event.pointerId));
    }
  }
  // 3. Any touch event lists the fingers that are on the screen right now: if
  //    none is on the throttle button, no touch can be pressing it.
  for (const type of ['touchstart', 'touchend', 'touchcancel']) {
    windowTarget.addEventListener(type, (event) => {
      const onThrottle = Array.from(event.touches ?? [])
        .some((touch) => touch.target === throttleButton);
      if (!onThrottle) releaseTouches();
    }, { passive: true });
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
  windowTarget.addEventListener('blur', interrupt);
  documentTarget.addEventListener('visibilitychange', () => {
    if (documentTarget.hidden) interrupt();
  });
}
