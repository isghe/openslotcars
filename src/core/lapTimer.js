/**
 * Lap timing.
 *
 * The finish line sits at arc length 0 of the lane, so the car crosses it each
 * time its total distance (never wrapped) reaches a multiple of the lane
 * length. The first crossing only starts the clock; every later crossing
 * closes a lap.
 *
 * A lap in which the car left the track is still recorded, but it is marked as
 * not valid and it never counts as the best lap.
 *
 * Times are in seconds. The timer is a plain value: every function returns a
 * new state and leaves its arguments untouched. The module is pure logic: no
 * DOM, no real-time clock, no randomness.
 */

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
 *   laps: Array<{number: number, time: number, valid: boolean}>,
 *   best: {number: number, time: number, valid: boolean}|null}}
 */
export function createLapTimer() {
  return { lapStart: null, currentLapHadExit: false, laps: [], best: null };
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
    return { ...timer, lapStart: time, currentLapHadExit: false };
  }
  if (time < timer.lapStart) {
    throw new RangeError(`crossing at ${time} s is earlier than the lap start ${timer.lapStart} s`);
  }
  const lapTime = time - timer.lapStart;
  const lap = {
    number: timer.laps.length + 1,
    time: lapTime,
    valid: !timer.currentLapHadExit,
  };
  const improves = lap.valid && (timer.best === null || lapTime < timer.best.time);
  return {
    lapStart: time,
    currentLapHadExit: false,
    laps: [...timer.laps, lap],
    best: improves ? lap : timer.best,
  };
}

/**
 * Marks the running lap as not valid because the car left the track. An exit
 * before the clock starts does not affect any timed lap and is ignored.
 */
export function markExit(timer) {
  if (timer.lapStart === null) return timer;
  return { ...timer, currentLapHadExit: true };
}

/**
 * Applies one simulation step to the timer: finds every finish line crossing
 * made during the step and records each one at its interpolated instant.
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
  let current = timer;
  const completed = [];
  for (const k of crossings(previousDistance, distance, laneLength)) {
    const time = crossingTime(previousTime, dt, previousDistance, distance, k * laneLength);
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
