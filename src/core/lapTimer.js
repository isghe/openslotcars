/**
 * Lap timing.
 *
 * The finish line sits at arc length 0 of the lane, so the car crosses it each
 * time its total distance (never wrapped) reaches a multiple of the lane
 * length. The first crossing only starts the clock; every later crossing
 * closes a lap. Three intermediate boundaries divide the lane into four
 * equal-distance sectors. Each boundary keeps session bests both for the
 * sector duration and for the cumulative time since the finish line.
 *
 * A lap in which the car left the track is still recorded, but it is marked as
 * not valid and it never counts as the best lap.
 *
 * Times are in seconds. The timer is a plain value: every function returns a
 * new state and leaves its arguments untouched. The module is pure logic: no
 * DOM, no real-time clock, no randomness.
 */

export const SECTOR_COUNT = 4;

function assertFinite(value, name) {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, got ${value}`);
  }
}

function assertPositiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
}

/**
 * Creates a timer that has not started yet.
 * @returns {{lapStart: number|null, currentLapHadExit: boolean,
 *   sectorStart: number|null, currentSectorHadExit: boolean, currentSectors: object[],
 *   currentExits: Array<{time: number, distance: number, sector: number}>,
 *   lastSectors: Array<object|null>, bestSectors: Array<object|null>,
 *   lastSplits: Array<object|null>, bestSplits: Array<object|null>,
 *   laps: Array<{number: number, time: number, valid: boolean, sectors: object[], exits: object[]|null}>,
 *   best: {number: number, time: number, valid: boolean}|null}}
 */
export function createLapTimer() {
  return {
    lapStart: null, currentLapHadExit: false,
    sectorStart: null, currentSectorHadExit: false, currentSectors: [],
    currentExits: [],
    lastSectors: Array(SECTOR_COUNT).fill(null), bestSectors: Array(SECTOR_COUNT).fill(null),
    lastSplits: Array(SECTOR_COUNT).fill(null), bestSplits: Array(SECTOR_COUNT).fill(null),
    laps: [], best: null,
  };
}

/** Starts a fresh attempt while retaining completed laps and sector records. */
export function restartLapTimer(timer) {
  return {
    ...createLapTimer(),
    laps: timer.laps,
    best: timer.best,
    bestSectors: timer.bestSectors,
    bestSplits: timer.bestSplits,
  };
}

/**
 * Finish line crossings made while the total distance goes from
 * `previousDistance` to `distance`. The line is at every multiple of the lane
 * length, including zero. A crossing that ends exactly on the line counts in
 * this step and not in the next one.
 * @returns {number[]} Indices `k` of the crossed lines, in increasing order:
 *   the crossing happens at distance `k * laneLength`.
 */
export function crossings(previousDistance, distance, laneLength) {
  assertFinite(previousDistance, 'previousDistance');
  assertFinite(distance, 'distance');
  assertPositiveFinite(laneLength, 'laneLength');
  const found = [];
  if (distance <= previousDistance) return found;
  const first = Math.floor(previousDistance / laneLength) + 1;
  const last = Math.floor(distance / laneLength);
  for (let k = first; k <= last; k += 1) found.push(k);
  return found;
}

/**
 * Instant of a crossing, interpolated linearly inside the time step.
 * @param {number} previousTime Time at the start of the step.
 * @param {number} dt Duration of the step.
 * @param {number} previousDistance Distance at the start of the step.
 * @param {number} distance Distance at the end of the step.
 * @param {number} lineDistance Distance of the crossed line.
 */
export function crossingTime(previousTime, dt, previousDistance, distance, lineDistance) {
  return previousTime + (dt * (lineDistance - previousDistance)) / (distance - previousDistance);
}

/**
 * Registers the car crossing the finish line.
 * @param {object} timer Current timer.
 * @param {number} time Instant of the crossing.
 * @returns {object} The new timer.
 */
export function recordCrossing(timer, time) {
  assertFinite(time, 'time');
  if (timer.lapStart === null) {
    return {
      ...timer, lapStart: time, currentLapHadExit: false,
      sectorStart: time, currentSectorHadExit: false, currentSectors: [],
      currentExits: [],
    };
  }
  if (time < timer.lapStart) {
    throw new RangeError(`crossing at ${time} s is earlier than the lap start ${timer.lapStart} s`);
  }
  const lapTime = time - timer.lapStart;
  const timed = recordSectorCrossing(timer, time, SECTOR_COUNT);
  const lap = {
    number: timer.laps.length + 1,
    time: lapTime,
    valid: !timer.currentLapHadExit,
    exits: timer.currentExits,
    // Direct finish-only callers cannot supply sector times. Never invent
    // splits for a lap whose intermediate crossings were not recorded.
    sectors: timed.currentSectors.length === SECTOR_COUNT ? timed.currentSectors : [],
  };
  const improves = lap.valid && (timer.best === null || lapTime < timer.best.time);
  return {
    ...timed,
    lapStart: time,
    currentLapHadExit: false,
    sectorStart: time,
    currentSectorHadExit: false,
    currentSectors: [],
    currentExits: [],
    laps: [...timer.laps, lap],
    best: improves ? lap : timer.best,
  };
}

/**
 * Marks the running lap as not valid because the car left the track. An exit
 * before the clock starts does not affect any timed lap and is ignored.
 * Optional details use simulation time and total lane distance. Recorded times
 * are seconds since lap start, and distances are meters from the finish line
 * along the driven lane. Detection occurs at the end of the simulation step.
 */
export function markExit(timer, details = null) {
  if (timer.lapStart === null) return timer;
  let currentExits = timer.currentExits;
  if (details !== null) {
    const { time, distance, laneLength } = details;
    assertFinite(time, 'time');
    assertFinite(distance, 'distance');
    assertPositiveFinite(laneLength, 'laneLength');
    if (time < timer.lapStart) throw new RangeError('exit precedes lap start');
    const lapDistance = ((distance % laneLength) + laneLength) % laneLength;
    currentExits = [...currentExits, {
      time: time - timer.lapStart, distance: lapDistance,
      sector: timer.currentSectors.length + 1,
    }];
  }
  return { ...timer, currentLapHadExit: true, currentSectorHadExit: true, currentExits };
}

/** Records a split only after the start and all preceding sector boundaries. */
function recordSectorCrossing(timer, time, number) {
  if (timer.lapStart === null || timer.currentSectors.length !== number - 1) return timer;
  const sector = { number, time: time - timer.sectorStart, valid: !timer.currentSectorHadExit };
  const best = timer.bestSectors[number - 1];
  const improves = sector.valid && (best === null || sector.time < best.time);
  // Keep the achievement even after a later attempt beats this record.
  sector.wasBest = improves;
  const split = { number, time: time - timer.lapStart, valid: !timer.currentLapHadExit };
  const bestSplit = timer.bestSplits[number - 1];
  const improvesSplit = split.valid && (bestSplit === null || split.time < bestSplit.time);
  return {
    ...timer,
    sectorStart: time,
    currentSectorHadExit: false,
    currentSectors: [...timer.currentSectors, sector],
    lastSectors: timer.lastSectors.map((last, index) => index === number - 1 ? sector : last),
    bestSectors: timer.bestSectors.map((last, index) => index === number - 1 && improves ? sector : last),
    lastSplits: timer.lastSplits.map((last, index) => index === number - 1 ? split : last),
    bestSplits: timer.bestSplits.map((last, index) => index === number - 1 && improvesSplit ? split : last),
  };
}

/** Steady-green states for the last completed attempt at each sector. */
export function sectorFeedback(timer) {
  return timer.lastSectors.map((sector, index) => sector !== null
    && sector.valid && sector === timer.bestSectors[index]);
}

/** Steady-purple states for cumulative session records at each boundary. */
export function cumulativeFeedback(timer) {
  return timer.lastSplits.map((split, index) => split !== null
    && split.valid && split === timer.bestSplits[index]);
}

/**
 * Applies one simulation step to the timer: finds every quarter-lap boundary
 * and records its interpolated instant. Sector times are durations, not
 * cumulative splits; the fourth sector closes at the finish line.
 * @param {object} timer Current timer.
 * @param {{previousTime: number, dt: number, previousDistance: number,
 *   distance: number, laneLength: number}} step
 * @returns {{timer: object, completed: Array<object>}} The new timer and the
 *   laps closed during the step, in order.
 */
export function advanceTimer(timer, step) {
  const { previousTime, dt, previousDistance, distance, laneLength } = step;
  assertFinite(previousTime, 'previousTime');
  assertPositiveFinite(dt, 'dt');
  assertPositiveFinite(laneLength, 'laneLength');
  let current = timer;
  const completed = [];
  for (const k of crossings(previousDistance, distance, laneLength / SECTOR_COUNT)) {
    const time = crossingTime(previousTime, dt, previousDistance, distance, (k / SECTOR_COUNT) * laneLength);
    const sector = ((k % SECTOR_COUNT) + SECTOR_COUNT) % SECTOR_COUNT;
    if (sector !== 0) {
      current = recordSectorCrossing(current, time, sector);
      continue;
    }
    const before = current.laps.length;
    current = recordCrossing(current, time);
    if (current.laps.length > before) completed.push(current.laps[before]);
  }
  return { timer: current, completed };
}

/**
 * Time elapsed in the running lap, or `null` if the clock has not started.
 */
export function currentLapTime(timer, now) {
  assertFinite(now, 'now');
  return timer.lapStart === null ? null : now - timer.lapStart;
}

/**
 * Formats a lap time: "4.213 s" below one minute and "1:04.213" from one
 * minute on. The default precision is the millisecond.
 * @param {number} seconds Time in seconds, zero or more.
 * @param {number} [digits] Decimal digits, from 1 to 3.
 */
export function formatLapTime(seconds, digits = 3) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`a lap time must be a finite number of seconds, zero or more, got ${seconds}`);
  }
  if (!Number.isInteger(digits) || digits < 1 || digits > 3) {
    throw new RangeError(`digits must be an integer from 1 to 3, got ${digits}`);
  }
  const unitsPerSecond = 10 ** digits;
  const totalUnits = Math.round(seconds * unitsPerSecond);
  const unitsPerMinute = 60 * unitsPerSecond;
  const minutes = Math.floor(totalUnits / unitsPerMinute);
  const rest = totalUnits - minutes * unitsPerMinute;
  const wholeSeconds = Math.floor(rest / unitsPerSecond);
  const fraction = String(rest % unitsPerSecond).padStart(digits, '0');
  if (minutes === 0) return `${wholeSeconds}.${fraction} s`;
  return `${minutes}:${String(wholeSeconds).padStart(2, '0')}.${fraction}`;
}
