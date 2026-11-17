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
 * In a curve the car needs a lateral acceleration of v^2 * |curvature|. The
 * magnet and the guide pin give it a fixed grip: above `maxLateralAcceleration`
 * the car leaves the track, and from then on it slides straight along the
 * tangent while the table slows it down.
 *
 * `stepYaw` is a separate piece that describes the body of the car. The guide
 * pin sits at the front and stays on the lane; the body pivots about it, and
 * its rear wheels have a lateral grip of their own. While that grip is enough
 * the tail rolls behind the pin, slightly inside the curve. Above it the tail
 * slides out, and `hasSpunOut` tells when the body has turned so far that the
 * car would leave the track. `stepYaw` does not move the car along the lane:
 * the caller gives it the speed, the curvature and the turn of the lane.
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
 * - `maxLateralAcceleration`: grip limit in curves, m/s^2 (about 1.2 g with
 *   the magnet).
 * - `offTrackDeceleration`: deceleration of a car that left the track, m/s^2.
 *   It is much higher than plain sliding friction because the car bounces and
 *   tumbles: from the top speed it stops after about half a meter.
 *
 * The values below are estimates for a 1:32 car, not measurements:
 *
 * - `pinToCenterOfMass` (b): distance from the guide pin to the center of mass,
 *   along the body, m.
 * - `pinToRearAxle` (l): distance from the guide pin to the rear axle, m.
 * - `bodyRadiusOfGyration` (kG): radius of gyration about the center of mass,
 *   m (a uniform box of 0.13 m by 0.06 m).
 * - `slideDamping` (c): loss that the model does not describe (tires in a
 *   slide, pin in the slot), 1/s. Without it a slide would swing forever.
 * - `maxSlipAngle`: angle between the body and the lane beyond which the car
 *   spins out, rad (about 34 degrees).
 *
 * The rear grip per unit of mass is `maxLateralAcceleration * b / l`, so the
 * grip limit stays the single knob for how hard the car can corner.
 */
export const DEFAULT_PARAMS = Object.freeze({
  spinUpAcceleration: 8,
  freeSpeed: 5,
  brakeAcceleration: 12,
  rollingFriction: 0.5,
  airDrag: 0.02,
  maxLateralAcceleration: 12,
  offTrackDeceleration: 20,
  pinToCenterOfMass: 0.04,
  pinToRearAxle: 0.08,
  bodyRadiusOfGyration: 0.041,
  slideDamping: 15,
  maxSlipAngle: 0.6,
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

function checkCurvature(curvature) {
  if (!Number.isFinite(curvature)) {
    throw new RangeError(`curvature must be a finite number, got ${curvature}`);
  }
  return Math.abs(curvature);
}

/**
 * Lateral acceleration needed to follow a curve at the given speed.
 * @param {number} speed Speed in m/s.
 * @param {number} curvature Signed curvature in 1/m; only its size matters.
 * @returns {number} Acceleration in m/s^2, never negative.
 */
export function lateralAcceleration(speed, curvature) {
  return speed * speed * checkCurvature(curvature);
}

/**
 * Highest speed at which a curve can be followed.
 * @returns {number} Speed in m/s, or `Infinity` on a straight.
 */
export function criticalSpeed(curvature, params = DEFAULT_PARAMS) {
  const size = checkCurvature(curvature);
  if (size === 0) return Infinity;
  return Math.sqrt(params.maxLateralAcceleration / size);
}

/**
 * Tells whether the car loses grip: the needed lateral acceleration is
 * strictly above the limit. The threshold is instantaneous, with no
 * tolerance, so the outcome depends only on speed and curvature.
 */
export function hasLostGrip(speed, curvature, params = DEFAULT_PARAMS) {
  return lateralAcceleration(speed, curvature) > params.maxLateralAcceleration;
}

/**
 * Advances a car that left the track by one fixed time step. It keeps going
 * straight along the tangent at the exit point and the table slows it down.
 * @param {{travel: number, speed: number}} state `travel` is the distance
 *   slid since the exit, in meters.
 * @param {number} dt Time step in seconds.
 * @param {typeof DEFAULT_PARAMS} [params]
 * @returns {{travel: number, speed: number}} The new state.
 */
export function stepOffTrack(state, dt, params = DEFAULT_PARAMS) {
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new RangeError(`dt must be a positive finite number, got ${dt}`);
  }
  const speed = Math.max(0, state.speed - params.offTrackDeceleration * dt);
  return { travel: state.travel + speed * dt, speed };
}

function checkFinite(name, value) {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, got ${value}`);
  }
  return value;
}

/**
 * Tells whether the body has turned so far from the lane that the car spins
 * out: the angle is strictly beyond `maxSlipAngle`, on either side.
 * @param {number} slip Angle of the body to the lane, rad.
 */
export function hasSpunOut(slip, params = DEFAULT_PARAMS) {
  return Math.abs(checkFinite('slip', slip)) > params.maxSlipAngle;
}

/**
 * Advances the rotation of the body about the guide pin by one fixed time step.
 *
 * The pin is on the lane and the body is a rigid bar hinged at the pin. Its
 * angle to the lane is `slip` (positive when the nose is to the left of the
 * lane tangent), so in a curve to the left a positive `slip` is a tail that
 * sticks out. `yawRate` is the absolute rotation speed of the body.
 *
 * Per unit of mass, with b = `pinToCenterOfMass`, l = `pinToRearAxle` and
 * k^2 = b^2 + kG^2 the inertia about the pin:
 *
 * 1. The pin accelerates toward the center of the curve, which pushes the
 *    center of mass and spins the body freely: w* = w + dt * (b / k^2) * v^2 *
 *    curvature * cos(slip).
 * 2. If the rear wheels do not slide, their velocity across the body is zero,
 *    which fixes the rotation: wg = -v * sin(slip) / l.
 * 3. The rear force that this needs is F = k^2 * (w* - wg) / (l * dt). Up to
 *    the grip `maxLateralAcceleration * b / l` the wheels hold and w = wg.
 * 4. Above it they slide with the force capped at the grip, and the damping
 *    pulls the rotation toward the rotation of the lane (`turn / dt`), with an
 *    implicit update that stays stable for any step.
 * 5. The new slip is the old one plus the rotation of the body minus the turn
 *    of the lane.
 *
 * The thrust that the speed change of the pin gives the body is left out on
 * purpose: its real counterpart is the friction of the driven rear wheels,
 * which the model does not describe, and it would tie the rotation of the body
 * to the throttle.
 *
 * @param {{slip: number, yawRate: number}} state Current rotation state.
 * @param {{speed: number, curvature: number, turn: number}} motion What the pin
 *   did in this step, once the longitudinal step has been made: its new speed
 *   in m/s (zero or more), the signed curvature of the lane at its new
 *   position in 1/m, and the angle the lane tangent turned during the step in
 *   rad (positive to the left).
 * @param {number} dt Time step in seconds.
 * @param {typeof DEFAULT_PARAMS} [params]
 * @returns {{slip: number, yawRate: number, rearSlip: number}} The new state.
 *   `rearSlip` is the speed in m/s at which the rear wheels slide sideways: it
 *   is exactly zero while they hold.
 * @throws {RangeError} On non-finite arguments, a negative speed, or a step so
 *   coarse that the pin covers the pin-to-axle distance in one step (the
 *   rolling tail would no longer settle).
 */
export function stepYaw(state, motion, dt, params = DEFAULT_PARAMS) {
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new RangeError(`dt must be a positive finite number, got ${dt}`);
  }
  const slip = checkFinite('slip', state.slip);
  const yawRate = checkFinite('yawRate', state.yawRate);
  const speed = checkFinite('speed', motion.speed);
  const curvature = checkFinite('curvature', motion.curvature);
  const turn = checkFinite('turn', motion.turn);
  if (speed < 0) {
    throw new RangeError(`speed must not be negative, got ${speed}`);
  }

  const { pinToCenterOfMass: b, pinToRearAxle: l, slideDamping: damping } = params;
  if (speed * dt >= l) {
    throw new RangeError(
      `the step is too coarse: ${speed} m/s over ${dt} s covers ${speed * dt} m, `
      + `not less than the pin-to-axle distance ${l} m`,
    );
  }
  const inertia = b * b + params.bodyRadiusOfGyration * params.bodyRadiusOfGyration;
  const grip = (params.maxLateralAcceleration * b) / l;

  const free = yawRate + dt * (b / inertia) * speed * speed * curvature * Math.cos(slip);
  const rolling = (-speed * Math.sin(slip)) / l;
  const force = (inertia * (free - rolling)) / (l * dt);

  let nextYawRate = rolling;
  let rearSlip = 0;
  if (Math.abs(force) > grip) {
    nextYawRate = (free - dt * (l / inertia) * grip * Math.sign(force) + damping * turn)
      / (1 + dt * damping);
    rearSlip = -speed * Math.sin(slip) - l * nextYawRate;
  }
  return { slip: slip + dt * nextYawRate - turn, yawRate: nextYawRate, rearSlip };
}
