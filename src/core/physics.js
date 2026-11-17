/**
 * Longitudinal physics of a slot car.
 *
 * The car moves along its lane, so its position is a single arc-length
 * coordinate `distance` (in meters, never wrapped, so it also counts laps) and
 * its state is completed by `speed` (m/s, never negative: there is no reverse).
 *
 * Forces are expressed per unit of mass, so all accelerations are in m/s^2.
 * The motor is modeled as a DC motor whose push fades linearly with speed:
 *
 *   throttle u > 0:   drive = A0 * (u - v / V0)
 *   throttle u = 0:   drive = -brake * v / V0        (motor braking)
 *
 * and the net acceleration subtracts rolling friction (constant while moving)
 * and air drag (proportional to v^2). A car at rest stays at rest unless the
 * drive beats the rolling friction.
 *
 * This module is pure logic: no DOM, no clock, no randomness.
 */

/**
 * Default parameters, tuned for a 1:32 slot car.
 *
 * - `spinUpAcceleration` (A0): acceleration at full throttle from rest, m/s^2.
 * - `freeSpeed` (V0): speed at which the motor stops pushing at full
 *   throttle, m/s.
 * - `brakeAcceleration`: motor braking deceleration at speed V0, m/s^2.
 * - `rollingFriction`: constant deceleration while moving, m/s^2.
 * - `airDrag`: coefficient of the v^2 deceleration, 1/m.
 */
export const DEFAULT_PARAMS = Object.freeze({
  spinUpAcceleration: 8,
  freeSpeed: 5,
  brakeAcceleration: 12,
  rollingFriction: 0.5,
  airDrag: 0.02,
});

/**
 * Returns a parameter set with some values replaced.
 * @param {Partial<typeof DEFAULT_PARAMS>} overrides
 * @throws {RangeError} On unknown names or values that are not finite and
 *   positive.
 */
export function withParams(overrides = {}) {
  const params = { ...DEFAULT_PARAMS };
  for (const [name, value] of Object.entries(overrides)) {
    if (!(name in DEFAULT_PARAMS)) {
      throw new RangeError(`unknown physics parameter: ${name}`);
    }
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive finite number, got ${value}`);
    }
    params[name] = value;
  }
  return Object.freeze(params);
}

function checkThrottle(throttle) {
  if (!Number.isFinite(throttle)) {
    throw new RangeError(`throttle must be a finite number, got ${throttle}`);
  }
  return Math.min(1, Math.max(0, throttle));
}

/**
 * Net longitudinal acceleration.
 * @param {number} speed Speed in m/s, zero or more.
 * @param {number} throttle Throttle from 0 (released) to 1 (full); values
 *   outside the range are clamped.
 * @param {typeof DEFAULT_PARAMS} [params]
 * @returns {number} Acceleration in m/s^2 (negative when slowing down).
 */
export function netAcceleration(speed, throttle, params = DEFAULT_PARAMS) {
  const u = checkThrottle(throttle);
  const drive = u > 0
    ? params.spinUpAcceleration * (u - speed / params.freeSpeed)
    : (-params.brakeAcceleration * speed) / params.freeSpeed;

  if (speed <= 0) {
    // At rest the car moves only if the drive beats the rolling friction.
    return drive > params.rollingFriction ? drive - params.rollingFriction : 0;
  }
  return drive - params.rollingFriction - params.airDrag * speed * speed;
}

/**
 * Speed reached when the acceleration becomes zero at a constant throttle.
 * Returns 0 when the throttle is too low to overcome the rolling friction.
 */
export function terminalSpeed(throttle, params = DEFAULT_PARAMS) {
  const u = checkThrottle(throttle);
  const linear = params.spinUpAcceleration / params.freeSpeed;
  const constant = params.rollingFriction - params.spinUpAcceleration * u;
  if (constant >= 0) return 0;
  const k = params.airDrag;
  return (-linear + Math.sqrt(linear * linear - 4 * k * constant)) / (2 * k);
}

/**
 * Advances the car by one fixed time step with semi-implicit Euler: the speed
 * is updated first and the new speed moves the car.
 * @param {{distance: number, speed: number}} state Current state.
 * @param {number} throttle Throttle from 0 to 1.
 * @param {number} dt Time step in seconds.
 * @param {typeof DEFAULT_PARAMS} [params]
 * @returns {{distance: number, speed: number}} The new state.
 */
export function stepLongitudinal(state, throttle, dt, params = DEFAULT_PARAMS) {
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new RangeError(`dt must be a positive finite number, got ${dt}`);
  }
  const acceleration = netAcceleration(state.speed, throttle, params);
  const speed = Math.max(0, state.speed + acceleration * dt);
  return { distance: state.distance + speed * dt, speed };
}
