import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControls } from '../src/core/controls.js';
import { bindInput } from '../src/ui/input.js';

/** Minimal stand-in for an element or for the window: it records listeners. */
function fakeTarget(extra = {}) {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    fire(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    ...extra,
  };
}

function fakeButton(id) {
  return fakeTarget({
    id,
    tagName: 'BUTTON',
    blurred: 0,
    captured: [],
    blur() { this.blurred += 1; },
    setPointerCapture(pointerId) { this.captured.push(pointerId); },
  });
}

/** Everything a test needs: bound controls, fake page and event helpers. */
function setup() {
  const controls = createControls();
  const windowTarget = fakeTarget();
  const documentTarget = fakeTarget({ hidden: false });
  const throttleButton = fakeButton('throttle');
  const pauseButton = fakeButton('pause');
  const restartButton = fakeButton('restart');
  bindInput({
    controls, throttleButton, pauseButton, restartButton, windowTarget, documentTarget,
  });

  /** A keyboard event aimed at `target`, with a spy on `preventDefault`. */
  function key(type, code, target, extra = {}) {
    const event = {
      code,
      repeat: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      target,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...extra,
    };
    windowTarget.fire(type, event);
    return event;
  }

  return {
    controls, windowTarget, documentTarget, throttleButton, pauseButton, restartButton, key,
  };
}

const body = { tagName: 'BODY' };

test('Space and the up arrow accelerate when the page has the focus', () => {
  const { controls, key } = setup();
  const down = key('keydown', 'Space', body);
  assert.equal(controls.demanding, true);
  assert.equal(down.defaultPrevented, true);
  const up = key('keyup', 'Space', body);
  assert.equal(controls.demanding, false);
  assert.equal(up.defaultPrevented, true);

  key('keydown', 'ArrowUp', body);
  assert.equal(controls.demanding, true);
  key('keyup', 'ArrowUp', body);
  assert.equal(controls.demanding, false);
});

test('Space on the throttle button accelerates and does not click the button', () => {
  const { controls, throttleButton, key } = setup();
  const down = key('keydown', 'Space', throttleButton);
  assert.equal(controls.demanding, true);
  assert.equal(down.defaultPrevented, true);
  const up = key('keyup', 'Space', throttleButton);
  assert.equal(controls.demanding, false);
  assert.equal(up.defaultPrevented, true);
});

test('Space on another button is left to that button', () => {
  const { controls, pauseButton, key } = setup();
  const down = key('keydown', 'Space', pauseButton);
  const up = key('keyup', 'Space', pauseButton);
  assert.equal(controls.demanding, false);
  assert.equal(down.defaultPrevented, false);
  assert.equal(up.defaultPrevented, false);
});

test('releasing Space after the focus moved to another button still releases the throttle', () => {
  const { controls, throttleButton, pauseButton, key } = setup();
  // Hold Space on the throttle button, press and release Tab so that the focus
  // goes to the Pause button, then release Space there.
  key('keydown', 'Space', throttleButton);
  key('keydown', 'Tab', throttleButton);
  key('keyup', 'Tab', pauseButton);
  assert.equal(controls.demanding, true);
  key('keyup', 'Space', pauseButton);
  assert.equal(controls.demanding, false);
  controls.step(1 / 120);
  assert.equal(controls.throttle, 0);
});

test('a release that ends a game press does not also activate the button that has the focus', () => {
  const { throttleButton, pauseButton, key } = setup();
  key('keydown', 'Space', throttleButton);
  const up = key('keyup', 'Space', pauseButton);
  assert.equal(up.defaultPrevented, true);
});

test('the up arrow works from a focused button', () => {
  const { controls, pauseButton, key } = setup();
  key('keydown', 'ArrowUp', pauseButton);
  assert.equal(controls.demanding, true);
  key('keyup', 'ArrowUp', pauseButton);
  assert.equal(controls.demanding, false);
});

test('keys with modifiers are left to the browser', () => {
  const { controls, key } = setup();
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
    const down = key('keydown', 'Space', body, { [modifier]: true });
    assert.equal(controls.demanding, false, modifier);
    assert.equal(down.defaultPrevented, false, modifier);
  }
  // Ctrl+R must not restart the race.
  key('keydown', 'KeyR', body, { ctrlKey: true });
  assert.equal(controls.takeRestart(), false);
});

test('typing in a field does not drive the game', () => {
  const { controls, key } = setup();
  for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
    const down = key('keydown', 'Space', target);
    assert.equal(controls.demanding, false, target.tagName);
    assert.equal(down.defaultPrevented, false, target.tagName);
  }
});

test('keys that are not the game keys are left alone', () => {
  const { controls, key } = setup();
  const down = key('keydown', 'KeyZ', body);
  assert.equal(down.defaultPrevented, false);
  assert.equal(controls.demanding, false);
});

test('P pauses once per press and R asks for a restart', () => {
  const { controls, key } = setup();
  key('keydown', 'KeyP', body);
  key('keydown', 'KeyP', body, { repeat: true });
  assert.equal(controls.paused, true);
  key('keyup', 'KeyP', body);
  key('keydown', 'Escape', body);
  assert.equal(controls.paused, false);
  key('keydown', 'KeyR', body);
  assert.equal(controls.takeRestart(), true);
});

test('a pointer on the throttle button holds the throttle until it is released', () => {
  for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    const { controls, throttleButton } = setup();
    const down = { pointerId: 3, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    throttleButton.fire('pointerdown', down);
    assert.equal(controls.demanding, true, ending);
    assert.deepEqual(throttleButton.captured, [3]);
    assert.equal(down.defaultPrevented, true);
    throttleButton.fire(ending, { pointerId: 3 });
    assert.equal(controls.demanding, false, ending);
  }
});

/** A pointer event on the throttle button, as a touch screen sends it. */
function touchDown(id, { isPrimary = true } = {}) {
  return {
    pointerId: id, pointerType: 'touch', isPrimary, preventDefault() {},
  };
}

test('a touch whose release never arrives does not keep the throttle after the next touch', () => {
  const { controls, throttleButton } = setup();
  // First finger: the browser loses its release (no pointerup, pointercancel
  // or lostpointercapture ever reaches the page).
  throttleButton.fire('pointerdown', touchDown(7));
  assert.equal(controls.demanding, true);

  // Second tap: a primary pointer going down means no other touch is on the
  // screen, so the first one can only be a ghost.
  throttleButton.fire('pointerdown', touchDown(8));
  throttleButton.fire('pointerup', { pointerId: 8 });
  assert.equal(controls.demanding, false);
});

test('a second finger on the throttle button does not drop the first', () => {
  const { controls, throttleButton } = setup();
  throttleButton.fire('pointerdown', touchDown(1));
  throttleButton.fire('pointerdown', touchDown(2, { isPrimary: false }));
  throttleButton.fire('pointerup', { pointerId: 2 });
  assert.equal(controls.demanding, true);
  throttleButton.fire('pointerup', { pointerId: 1 });
  assert.equal(controls.demanding, false);
});

test('a touch event that shows no finger on the throttle button releases a lost touch', () => {
  for (const type of ['touchstart', 'touchend', 'touchcancel']) {
    const { controls, windowTarget, throttleButton, restartButton } = setup();
    throttleButton.fire('pointerdown', touchDown(5));
    // Another finger lands on Restart; the one on the throttle is not in the list.
    windowTarget.fire(type, { touches: [{ target: restartButton }] });
    assert.equal(controls.demanding, false, type);
  }
});

test('a touch event with a finger still on the throttle button keeps the throttle', () => {
  const { controls, windowTarget, throttleButton, restartButton } = setup();
  throttleButton.fire('pointerdown', touchDown(5));
  windowTarget.fire('touchstart', { touches: [{ target: throttleButton }, { target: restartButton }] });
  windowTarget.fire('touchend', { touches: [{ target: throttleButton }] });
  assert.equal(controls.demanding, true);
  windowTarget.fire('touchend', { touches: [] });
  assert.equal(controls.demanding, false);
});

test('touch events do not release a mouse press', () => {
  const { controls, windowTarget, throttleButton } = setup();
  throttleButton.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', isPrimary: true, preventDefault() {} });
  windowTarget.fire('touchstart', { touches: [{ target: body }] });
  windowTarget.fire('touchend', { touches: [] });
  assert.equal(controls.demanding, true);
  throttleButton.fire('pointerup', { pointerId: 1 });
  assert.equal(controls.demanding, false);
});

test('a new touch leaves a mouse press alone, and touch events leave a held key alone', () => {
  const { controls, windowTarget, throttleButton, key } = setup();
  throttleButton.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', isPrimary: true, preventDefault() {} });
  throttleButton.fire('pointerdown', touchDown(9));
  throttleButton.fire('pointerup', { pointerId: 9 });
  assert.equal(controls.demanding, true, 'mouse still pressing');
  throttleButton.fire('pointerup', { pointerId: 1 });
  assert.equal(controls.demanding, false);

  key('keydown', 'Space', body);
  windowTarget.fire('touchstart', { touches: [{ target: body }] });
  windowTarget.fire('touchend', { touches: [] });
  assert.equal(controls.demanding, true, 'key still held');
});

test('a release that reaches the window and not the button still ends the press', () => {
  for (const ending of ['pointerup', 'pointercancel']) {
    const { controls, windowTarget, throttleButton } = setup();
    throttleButton.fire('pointerdown', touchDown(4));
    windowTarget.fire(ending, { pointerId: 4 });
    assert.equal(controls.demanding, false, ending);
  }
});

test('the context menu is blocked on the throttle button', () => {
  const { throttleButton } = setup();
  const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  throttleButton.fire('contextmenu', event);
  assert.equal(event.defaultPrevented, true);
});

test('the pause and restart buttons act, and give the focus back after a mouse click only', () => {
  const { controls, pauseButton, restartButton } = setup();

  pauseButton.fire('click', { detail: 1 });
  assert.equal(controls.paused, true);
  assert.equal(pauseButton.blurred, 1);
  // Activation from the keyboard has a detail of 0: the focus must stay.
  pauseButton.fire('click', { detail: 0 });
  assert.equal(controls.paused, false);
  assert.equal(pauseButton.blurred, 1);

  restartButton.fire('click', { detail: 1 });
  assert.equal(controls.takeRestart(), true);
  assert.equal(restartButton.blurred, 1);
  restartButton.fire('click', { detail: 0 });
  assert.equal(controls.takeRestart(), true);
  assert.equal(restartButton.blurred, 1);
});

test('losing the focus releases everything and pauses', () => {
  const { controls, windowTarget, throttleButton, key } = setup();
  key('keydown', 'Space', body);
  throttleButton.fire('pointerdown', { pointerId: 1, preventDefault() {} });
  windowTarget.fire('blur', {});
  assert.equal(controls.demanding, false);
  assert.equal(controls.paused, true);
});

test('hiding the page pauses it, showing it again does not change the pause', () => {
  const { controls, documentTarget, key } = setup();
  key('keydown', 'Space', body);
  documentTarget.hidden = true;
  documentTarget.fire('visibilitychange', {});
  assert.equal(controls.demanding, false);
  assert.equal(controls.paused, true);

  controls.setPaused(false);
  documentTarget.hidden = false;
  documentTarget.fire('visibilitychange', {});
  assert.equal(controls.paused, false);
});
