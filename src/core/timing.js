/**
 * What the timing panel shows and announces, as plain data and text.
 *
 * The panel itself lives in the page (`ui/hud.js`); this module decides its
 * content from the simulation world, so the rules are testable in Node:
 * the figures to display, and the events worth announcing to a screen reader
 * (a lap closed, the car left the track, the car is back).
 *
 * This module is pure logic: no DOM, no clock, no randomness.
 */

import { formatLapTime, SECTOR_COUNT } from './lapTimer.js';

/** Purple for a current record, green for a former one, yellow for other timed sectors. */
export function bestLapSectorColors(timer) {
  return Array.from({ length: SECTOR_COUNT }, (_, index) => {
    const sector = timer.best?.sectors[index];
    if (!sector) return 'white';
    if (sector.time === timer.bestSectors[index]?.time) return 'purple';
    return sector.wasBest ? 'green' : 'yellow';
  });
}

/**
 * Figures to display, taken from a world.
 * @returns {{currentLap: number|null, currentLapHadExit: boolean,
 *   lastLap: object|null, bestLap: object|null, bestSectorsSum: number|null,
 *   lapsCompleted: number}}
 *   `currentLap` is the time of the running lap in seconds, or `null` until
 *   the car has crossed the finish line for the first time.
 */
export function timingSummary(world) {
  const { timer } = world;
  const { laps } = timer;
  return {
    currentLap: timer.lapStart === null ? null : Math.max(0, world.time - timer.lapStart),
    currentLapHadExit: timer.currentLapHadExit,
    lastLap: laps.length > 0 ? laps[laps.length - 1] : null,
    bestLap: timer.best,
    bestSectorsSum: timer.bestSectors.every((sector) => sector !== null)
      ? timer.bestSectors.reduce((sum, sector) => sum + sector.time, 0)
      : null,
    lapsCompleted: laps.length,
  };
}

/**
 * Texts of the panel for a summary. The running lap is shown with a tenth of
 * a second, so it changes about ten times per second; closed laps are shown
 * with milliseconds. A lap with an exit is labeled, because it does not count.
 * @returns {{currentLap: string, lastLap: string, bestLap: string,
 *   bestSectorsSum: string, laps: string}}
 */
export function formatTiming(summary) {
  const offTrack = ' (off track)';
  return {
    currentLap: summary.currentLap === null
      ? 'not started'
      : formatLapTime(summary.currentLap, 1) + (summary.currentLapHadExit ? offTrack : ''),
    lastLap: summary.lastLap === null
      ? 'none yet'
      : formatLapTime(summary.lastLap.time) + (summary.lastLap.valid ? '' : offTrack),
    bestLap: summary.bestLap === null ? 'none yet' : formatLapTime(summary.bestLap.time),
    bestSectorsSum: summary.bestSectorsSum === null
      ? 'none yet' : formatLapTime(summary.bestSectorsSum),
    laps: String(summary.lapsCompleted),
  };
}

/**
 * Events that happened between two worlds, in a reasonable order: laps closed
 * first, then changes of the car status. When `after` is older than `before`
 * the race was restarted in between and there is nothing to compare.
 *
 * Only the two worlds are compared, not the steps in between, so the events
 * are found as long as the observations are close enough:
 * - laps are never lost, however far apart the observations are, because they
 *   are found by counting;
 * - a change of the car status is seen if it is still in place at the second
 *   world. If the car leaves the track and is back on it between two
 *   observations (by default that takes the 1.5 s of the recovery time), both
 *   changes go unnoticed. The page observes every frame, and a frame never
 *   advances the simulation by more than a fraction of a second.
 * @returns {Array<object>} Events of three kinds:
 *   `{type: 'lap', lap, isBest}`, `{type: 'exit', countsAgainstLap}` and
 *   `{type: 'recovered'}`.
 */
export function timingEvents(before, after) {
  if (after.stepIndex < before.stepIndex) return [];

  const events = [];
  for (const lap of after.timer.laps.slice(before.timer.laps.length)) {
    const isBest = lap.valid && after.timer.best !== null && after.timer.best.number === lap.number;
    events.push({ type: 'lap', lap, isBest });
  }
  if (before.car.status === 'onTrack' && after.car.status === 'offTrack') {
    // Before the clock starts, an exit does not spoil any timed lap.
    events.push({ type: 'exit', countsAgainstLap: after.timer.lapStart !== null });
  } else if (before.car.status === 'offTrack' && after.car.status === 'onTrack') {
    events.push({ type: 'recovered' });
  }
  return events;
}

/** Sentence that announces an event to a screen reader. */
export function describeEvent(event) {
  switch (event.type) {
    case 'lap': {
      const time = formatLapTime(event.lap.time);
      if (!event.lap.valid) {
        return `Lap ${event.lap.number}: ${time}. Left the track in this lap, so it does not count.`;
      }
      return event.isBest
        ? `Lap ${event.lap.number}: ${time}. New best lap.`
        : `Lap ${event.lap.number}: ${time}.`;
    }
    case 'exit':
      return event.countsAgainstLap
        ? 'Left the track. This lap will not count.'
        : 'Left the track.';
    case 'recovered':
      return 'Back on the track.';
    default:
      throw new RangeError(`unknown event type: ${event.type}`);
  }
}
