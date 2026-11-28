/** Shows the frame statistics in a corner of the page. */

import { createFrameStats } from '../core/frameStats.js';

// The text changes a few times per second: it stays readable and costs little.
const REFRESH_MS = 500;

/** @param {HTMLElement} element Box that holds the figures. */
export function createFrameMeter(element) {
  const stats = createFrameStats();
  let shownAt = null;

  return {
    setVisible(visible) {
      if (visible === !element.hidden) return;
      element.hidden = !visible;
      element.textContent = visible ? 'measuring…' : '';
      stats.reset();
      shownAt = null;
    },

    /** Adds a frame; see `createFrameStats`. */
    add(now, workMs) {
      if (element.hidden) return;
      stats.add(now, workMs);
      if (shownAt !== null && now - shownAt < REFRESH_MS) return;
      const summary = stats.summary();
      if (summary === null) return;
      shownAt = now;
      element.textContent = `${summary.fps.toFixed(0)} fps\n`
        + `worst ${summary.worstMs.toFixed(0)} ms\n`
        + `long ${summary.longFrames}\n`
        + `code ${summary.worstWorkMs.toFixed(1)} ms`;
    },

    gap() {
      stats.gap();
    },
  };
}
