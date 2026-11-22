/**
 * The timing panel in the page.
 *
 * The figures live in plain text elements and change without being announced.
 * Events (a lap closed, the car left the track and came back) are written to a
 * polite live region, so a screen reader announces them one at a time without
 * being flooded by the running lap time.
 */

import {
  timingSummary,
  formatTiming,
  timingEvents,
  describeEvent,
  bestLapSectorColors,
} from '../core/timing.js';

function setText(element, text) {
  // Writing the same text again would still make the browser redo the layout.
  if (element.textContent !== text) element.textContent = text;
}

/**
 * @param {{currentLap: HTMLElement, lastLap: HTMLElement, bestLap: HTMLElement,
 *   bestLapSectors: HTMLElement, bestSectorsSum: HTMLElement,
 *   laps: HTMLElement, announcer: HTMLElement}} elements
 */
export function createHud({ currentLap, lastLap, bestLap, bestLapSectors, bestSectorsSum, laps, announcer }) {
  let shown = null;

  return {
    /** Updates the panel with the given world and announces what happened. */
    update(world) {
      const texts = formatTiming(timingSummary(world));
      setText(currentLap, texts.currentLap);
      setText(lastLap, texts.lastLap);
      setText(bestLap, texts.bestLap);
      const colors = bestLapSectorColors(world.timer);
      colors.forEach((color, index) => {
        const mark = bestLapSectors.children[index];
        if (mark.dataset.color !== color) mark.dataset.color = color;
      });
      const label = world.timer.best === null
        ? 'Best lap sectors: no lap yet'
        : colors.map((color, index) => `Sector ${index + 1}: ${color}`).join('; ');
      if (bestLapSectors.getAttribute('aria-label') !== label) {
        bestLapSectors.setAttribute('aria-label', label);
        bestLapSectors.title = label;
      }
      setText(bestSectorsSum, texts.bestSectorsSum);
      setText(laps, texts.laps);

      if (shown !== null) {
        const sentences = timingEvents(shown, world).map(describeEvent);
        if (sentences.length > 0) setText(announcer, sentences.join(' '));
      }
      shown = world;
    },

    /**
     * Starts over after a restart of the race, or after the circuit changed.
     * @param {object} world The new world.
     * @param {string} [message] What to announce.
     */
    restart(world, message = 'Race restarted.') {
      shown = world;
      setText(announcer, message);
      this.update(world);
    },
  };
}
