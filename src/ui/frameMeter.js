/** Shows the frame statistics in a corner of the page. */

import { createFrameStats } from '../core/frameStats.js';

// The text changes a few times per second: it stays readable and costs little.
const REFRESH_MS = 500;

/** @param {HTMLElement} element Box that holds the figures. */
export function createFrameMeter(element) {
  const stats = createFrameStats();
  let shownAt = null;
  // Two columns, to stay narrow enough for the free corner of a phone.
  const [frames, parts] = ['span', 'span'].map((tag) => element.ownerDocument.createElement(tag));

  return {
    setVisible(visible) {
      if (visible === !element.hidden) return;
      element.hidden = !visible;
      element.replaceChildren(frames, parts);
      frames.textContent = 'measuring…';
      parts.textContent = '';
      stats.reset();
      shownAt = null;
    },

    /** Adds a frame; see `createFrameStats`. */
    add(now, work) {
      if (element.hidden) return;
      stats.add(now, work);
      if (shownAt !== null && now - shownAt < REFRESH_MS) return;
      const summary = stats.summary();
      if (summary === null) return;
      shownAt = now;
      const { total, sim, save, draw } = summary.slowestWork;
      frames.textContent = `${summary.fps.toFixed(0)} fps\n`
        + `worst ${summary.worstMs.toFixed(0)}\n`
        + `long ${summary.longFrames}\n`
        + `code ${total.toFixed(1)}`;
      parts.textContent = `sim ${sim.toFixed(1)}\n`
        + `save ${save.toFixed(1)}\n`
        + `draw ${draw.toFixed(1)}`;
    },

    gap() {
      stats.gap();
    },
  };
}
