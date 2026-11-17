/**
 * Simulation of one car on one lane.
 *
 * The world is an immutable value: `stepWorld` takes the current world and the
 * input and returns the next world, always advancing by the same fixed time
 * step. Time is derived from an integer step counter, so it never drifts.
 *
 * Rules:
 * - On the track the car follows the longitudinal physics of `physics.js`.
 *   After every step, if the lateral acceleration needed by the curve is above
 *   the grip limit, the car leaves the track.
 * - With the rule `tailSlide`, which is on by default, the car is a body
 *   hinged at its guide pin. The pin follows the lane as above, and the body
 *   turns about it: the tail rolls behind the pin while its wheels hold,
 *   slides out above the grip limit, and costs speed while it slides. The car
 *   leaves the track only when the body has turned too far (`hasSpunOut`), and
 *   not at the grip limit. With the rule off the car is a single point and
 *   leaves the track at the grip limit, as described above. The two models
 *   are not the same in general: where the tail never slides, the motion of
 *   the pin is the one of the plain model for the throttles and lanes that the
 *   tests try, but a body that has settled in a curve can hold a curve just
 *   above the grip limit, which the plain model leaves.
 * - Off the track the car slides straight along the tangent at the exit point
 *   and the throttle is ignored. After the recovery time a marshal puts it
 *   back on its lane at the exit point, at rest. The distance counted for the
 *   lap does not move while it is off the track, so leaving the track never
 *   shortens a lap.
 * - The lap timer runs on the distance covered on the track. A lap with an
 *   exit is marked as not valid.
 *
 * This module is pure logic: no DOM, no clock, no randomness.
 */

import {
  DEFAULT_PARAMS,
  stepLongitudinal,
  hasLostGrip,
  stepOffTrack,
  stepYaw,
  hasSpunOut,
  scrubDeceleration,
} from './physics.js';
import { angleDifference } from './geometry.js';
import {
  createLapTimer,
  advanceTimer,
  markExit,
} from './lapTimer.js';

/** Default rules of the simulation. */
export const DEFAULT_RULES = Object.freeze({
  // Fixed simulation step, in seconds.
  dt: 1 / 120,
  // Time a car stays off the track before being put back, in seconds.
  recoveryTime: 1.5,
  // Initial distance, in meters. The car starts behind the finish line, so
  // that the first crossing starts the clock.
  startDistance: -0.1,
  // Whether the body of the car pivots about the guide pin and the tail can
  // slide out (see the module comment). Off, the car is a single point on the
  // lane that leaves the track as soon as the grip limit is exceeded.
  tailSlide: true,
});

/** Visual spin of a sliding car, in radians per meter slid. Not physical. */
export const SLIDE_SPIN = 3;

/**
 * Creates the fixed data of a simulation.
 * @param {{lane: object, params?: object, rules?: Partial<typeof DEFAULT_RULES>}} options
 *   `lane` comes from `createLane` or `buildCircuit`.
 */
export function createContext({ lane, params = DEFAULT_PARAMS, rules = {} }) {
  const merged = { ...DEFAULT_RULES, ...rules };
  if (!Number.isFinite(merged.dt) || merged.dt <= 0) {
    throw new RangeError(`dt must be a positive finite number, got ${merged.dt}`);
  }
  if (!Number.isFinite(merged.recoveryTime) || merged.recoveryTime < 0) {
    throw new RangeError(`recoveryTime must be a finite number, zero or more, got ${merged.recoveryTime}`);
  }
  if (!Number.isFinite(merged.startDistance)) {
    throw new RangeError(`startDistance must be a finite number, got ${merged.startDistance}`);
  }
  if (typeof merged.tailSlide !== 'boolean') {
    throw new RangeError(`tailSlide must be true or false, got ${merged.tailSlide}`);
  }
  if (merged.tailSlide && params.freeSpeed * merged.dt >= params.pinToRearAxle) {
    // At its top speed the car would cover the pin-to-axle distance in one
    // step, and the tail could not settle behind the pin.
    throw new RangeError(
      `dt is too coarse for the tail: ${params.freeSpeed} m/s over ${merged.dt} s is not less than `
      + `the pin-to-axle distance ${params.pinToRearAxle} m`,
    );
  }
  return Object.freeze({
    lane,
    laneLength: lane.length,
    params,
    dt: merged.dt,
    startDistance: merged.startDistance,
    tailSlide: merged.tailSlide,
    recoverySteps: Math.max(1, Math.round(merged.recoveryTime / merged.dt)),
  });
}

/**
 * Creates the initial world: the car at rest on the starting distance, with
 * the lap timer not started.
 *
 * The car is `{status: 'onTrack', distance, speed}` or, after leaving the
 * track, `{status: 'offTrack', distance, speed, travel, resumeStep}` where
 * `distance` is the exit point on the lane, `travel` the distance slid since
 * the exit and `resumeStep` the step at which the car is put back.
 *
 * With the rule `tailSlide`, `distance` and `speed` are those of the guide pin
 * and the car also has `slip` (angle of the body to the lane, rad, positive
 * with the nose to the left), `yawRate` (rotation speed of the body, rad/s) and
 * `rearSlip` (sideways speed of the rear axle, m/s, zero while the tail holds),
 * as `stepYaw` defines them. Off the track it keeps only `slip`, the angle at
 * which it spun out.
 */
export function createWorld(context) {
  const aligned = context.tailSlide ? { slip: 0, yawRate: 0, rearSlip: 0 } : {};
  return {
    stepIndex: 0,
    time: 0,
    car: { status: 'onTrack', distance: context.startDistance, speed: 0, ...aligned },
    timer: createLapTimer(),
  };
}

/**
 * Advances the world by one fixed time step.
 * @param {object} world Current world.
 * @param {{throttle: number}} input Throttle from 0 to 1.
 * @param {object} context From `createContext`.
 * @returns {object} The next world; the arguments are not modified.
 */
export function stepWorld(world, input, context) {
  const { throttle } = input;
  if (!Number.isFinite(throttle)) {
    throw new RangeError(`throttle must be a finite number, got ${throttle}`);
  }
  const { dt, lane, params } = context;
  const stepIndex = world.stepIndex + 1;
  const time = stepIndex * dt;
  const previousTime = world.stepIndex * dt;
  const car = world.car;

  if (car.status === 'onTrack') {
    // The slide of the tail, known from the previous step, slows the pin down.
    const resistance = context.tailSlide ? scrubDeceleration(car.speed, car.rearSlip, params) : 0;
    const next = stepLongitudinal(car, throttle, dt, params, resistance);
    const { timer } = advanceTimer(world.timer, {
      previousTime,
      dt,
      previousDistance: car.distance,
      distance: next.distance,
      laneLength: context.laneLength,
    });

    // With the rule off the car leaves the track at the grip limit. With it on,
    // the body turns about the pin by the angle the lane turned under it.
    let body = null;
    let exits;
    if (context.tailSlide) {
      const turn = angleDifference(lane.poseAt(next.distance).heading, lane.poseAt(car.distance).heading);
      body = stepYaw(car, { speed: next.speed, curvature: lane.curvatureAt(next.distance), turn }, dt, params);
      exits = hasSpunOut(body.slip, params);
    } else {
      exits = hasLostGrip(next.speed, lane.curvatureAt(next.distance), params);
    }

    if (exits) {
      return {
        stepIndex,
        time,
        // The exit belongs to the lap running at the exit point, which is the
        // new lap if the line was crossed in this very step.
        timer: markExit(timer),
        car: {
          status: 'offTrack',
          distance: next.distance,
          speed: next.speed,
          travel: 0,
          resumeStep: stepIndex + context.recoverySteps,
          ...(body && { slip: body.slip }),
        },
      };
    }
    return {
      stepIndex,
      time,
      timer,
      car: { status: 'onTrack', distance: next.distance, speed: next.speed, ...body },
    };
  }

  if (stepIndex >= car.resumeStep) {
    const aligned = context.tailSlide ? { slip: 0, yawRate: 0, rearSlip: 0 } : {};
    return {
      stepIndex,
      time,
      timer: world.timer,
      car: { status: 'onTrack', distance: car.distance, speed: 0, ...aligned },
    };
  }
  const slid = stepOffTrack({ travel: car.travel, speed: car.speed }, dt, params);
  return {
    stepIndex,
    time,
    timer: world.timer,
    car: { ...car, travel: slid.travel, speed: slid.speed },
  };
}

/**
 * Pose of the car in the plane, for drawing. On the track it is the pose on
 * the lane; off the track the car continues along the tangent at the exit
 * point and spins visually.
 *
 * With the rule `tailSlide` the pose is that of the center of the body, and its
 * heading is the heading of the body, which is the one of the lane plus `slip`.
 * The guide pin is on the lane, in front of the center by `pinToCenterOfMass`
 * along the heading. Off the track the center slides along the tangent of the
 * lane at the exit point, from where the body was, and the body keeps turning
 * the way it was turning, which is the sign of `slip`.
 * @returns {{x: number, y: number, heading: number}}
 */
export function carPose(world, context) {
  const car = world.car;
  const pose = context.lane.poseAt(car.distance);
  if (!context.tailSlide) {
    if (car.status === 'onTrack') return pose;
    return {
      x: pose.x + car.travel * Math.cos(pose.heading),
      y: pose.y + car.travel * Math.sin(pose.heading),
      heading: pose.heading + SLIDE_SPIN * car.travel,
    };
  }

  const heading = pose.heading + car.slip;
  const back = context.params.pinToCenterOfMass;
  const x = pose.x - back * Math.cos(heading);
  const y = pose.y - back * Math.sin(heading);
  if (car.status === 'onTrack') return { x, y, heading };
  // Off the track `slip` is beyond the spin-out angle, so its sign is defined.
  const turning = Math.sign(car.slip);
  return {
    x: x + car.travel * Math.cos(pose.heading),
    y: y + car.travel * Math.sin(pose.heading),
    heading: heading + turning * SLIDE_SPIN * car.travel,
  };
}

/**
 * World to draw between two simulation steps, for a smooth animation.
 *
 * The distance (or the slide) is interpolated between the previous and the
 * current world, and so is the angle of the body (`slip`) when the car has one.
 * When the car changed status, or was put back on the track, between the two
 * worlds there is nothing to interpolate and the current world is returned as
 * it is.
 * @param {object} previous World before the last step.
 * @param {object} current World after the last step.
 * @param {number} alpha Position between `previous` (0) and `current` (1),
 *   from 0 to 1. It is the fraction of a step left over by the stepper.
 */
export function interpolateWorld(previous, current, alpha) {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new RangeError(`alpha must be between 0 and 1, got ${alpha}`);
  }
  const before = previous.car;
  const after = current.car;
  if (before.status !== after.status) return current;

  if (after.status === 'onTrack') {
    const distance = before.distance + (after.distance - before.distance) * alpha;
    if ('slip' in before && 'slip' in after) {
      const slip = before.slip + (after.slip - before.slip) * alpha;
      return { ...current, car: { ...after, distance, slip } };
    }
    return { ...current, car: { ...after, distance } };
  }
  if (before.distance !== after.distance) return current;
  const travel = before.travel + (after.travel - before.travel) * alpha;
  return { ...current, car: { ...after, travel } };
}
