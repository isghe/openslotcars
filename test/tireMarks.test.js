import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVAL, buildCircuit } from '../src/core/circuits.js';
import { DEFAULT_PARAMS, scrubDeceleration } from '../src/core/physics.js';
import { createContext, createWorld, stepWorld } from '../src/core/simulation.js';
import { createTireMarks } from '../src/ui/tireMarks.js';

const circuit = buildCircuit(OVAL);
const lane = circuit.lanes.inner;
const context = createContext({ lane });
const REAR = DEFAULT_PARAMS.pinToRearAxle;
const HALF_TRACK = 0.022;
const LIFETIME = 2;

function near(actual, expected, tolerance, message = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message} expected ${expected}, got ${actual}`,
  );
}

/** Runs the simulation and returns every world, the first one included. */
function play(ctx, seconds, throttle) {
  let world = createWorld(ctx);
  const history = [world];
  for (let i = 0; i < Math.round(seconds / ctx.dt); i += 1) {
    world = stepWorld(world, { throttle }, ctx);
    history.push(world);
  }
  return history;
}

/** Where the two rear wheels are, worked out from the lane and the slip alone. */
function wheelsOf(world) {
  const pin = lane.poseAt(world.car.distance);
  const heading = pin.heading + world.car.slip;
  const axle = { x: pin.x - REAR * Math.cos(heading), y: pin.y - REAR * Math.sin(heading) };
  const side = { x: -Math.sin(heading), y: Math.cos(heading) };
  return {
    left: { x: axle.x + HALF_TRACK * side.x, y: axle.y + HALF_TRACK * side.y },
    right: { x: axle.x - HALF_TRACK * side.x, y: axle.y - HALF_TRACK * side.y },
  };
}

const sliding = (world) => world.car.status === 'onTrack' && world.car.rearSlip !== 0;

/**
 * How hard the tail slides: the share of the rear grip that works against the
 * car, worked out with the physics module and not with the formula of the marks.
 */
const REAR_GRIP = (DEFAULT_PARAMS.maxLateralAcceleration * DEFAULT_PARAMS.pinToCenterOfMass) / REAR;
const intensityOf = (world) => scrubDeceleration(world.car.speed, world.car.rearSlip) / REAR_GRIP;
const FULL = 0.4;

/** Strength of the mark between two consecutive sliding worlds. */
function strengthBetween(before, after, full = FULL) {
  return Math.min(1, (intensityOf(before) + intensityOf(after)) / 2 / full);
}

test('no marks are left while the tail holds', () => {
  const marks = createTireMarks();
  for (const world of play(context, 30, 0.3)) {
    marks.record(world, context);
    assert.equal(marks.segments(world.time).length, 0);
  }
  assert.equal(marks.size, 0);
});

test('a sliding tail leaves one mark per wheel, between two consecutive steps', () => {
  const marks = createTireMarks();
  const history = play(context, 20, 0.6);
  let continued = 0;
  for (let i = 0; i < history.length; i += 1) {
    const world = history[i];
    marks.record(world, context);
    const fresh = marks.segments(world.time).filter((segment) => segment.alpha === 1);
    if (sliding(world) && i > 0 && sliding(history[i - 1])) {
      assert.equal(fresh.length, 2, `step ${i}`);
      const before = wheelsOf(history[i - 1]);
      const after = wheelsOf(world);
      const [left, right] = fresh;
      for (const [segment, from, to] of [[left, before.left, after.left], [right, before.right, after.right]]) {
        near(segment.x1, from.x, 1e-12, `step ${i}`);
        near(segment.y1, from.y, 1e-12, `step ${i}`);
        near(segment.x2, to.x, 1e-12, `step ${i}`);
        near(segment.y2, to.y, 1e-12, `step ${i}`);
      }
      // The wheels are one track width apart.
      near(Math.hypot(left.x2 - right.x2, left.y2 - right.y2), 2 * HALF_TRACK, 1e-12, `step ${i}`);
      // Both marks are as strong as the slide between the two steps.
      const strength = strengthBetween(history[i - 1], world);
      near(left.strength, strength, 1e-12, `step ${i}`);
      near(right.strength, strength, 1e-12, `step ${i}`);
      continued += 1;
    } else {
      // The first step of a slide has nothing to join, and no slide no mark.
      assert.equal(fresh.length, 0, `step ${i}`);
    }
  }
  assert.ok(continued > 300, `${continued} steps with a mark`);
});

test('a mark is as strong as the slide, up to the full intensity', () => {
  // At full throttle the slide grows from nothing until the car spins out, so
  // it goes through the whole range of intensities.
  const marks = createTireMarks();
  const history = play(context, 4, 1);
  const seen = [];
  for (let i = 0; i < history.length; i += 1) {
    marks.record(history[i], context);
    if (!(i > 0 && sliding(history[i]) && sliding(history[i - 1]))) continue;
    const [segment] = marks.segments(history[i].time).filter((s) => s.alpha === 1);
    const mean = (intensityOf(history[i - 1]) + intensityOf(history[i])) / 2;
    assert.ok(segment.strength > 0 && segment.strength <= 1, `strength ${segment.strength}`);
    if (mean < FULL) near(segment.strength, mean / FULL, 1e-12, `step ${i}: proportional`);
    else assert.equal(segment.strength, 1, `step ${i}: saturated`);
    seen.push({ mean, strength: segment.strength });
  }
  // The run really goes from faint to saturated marks.
  assert.ok(seen.some((s) => s.strength < 0.2), 'no faint mark');
  assert.ok(seen.some((s) => s.strength > 0.2 && s.strength < 1), 'no mark in between');
  assert.ok(seen.some((s) => s.strength === 1), 'no saturated mark');
  // A harder slide never gives a fainter mark.
  seen.sort((a, b) => a.mean - b.mean);
  for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i].strength >= seen[i - 1].strength);
});

test('a slide faster than the car counts as the whole rear grip, and not more', () => {
  const history = play(context, 20, 0.6);
  const index = history.findIndex((world, i) => i > 0 && sliding(world) && sliding(history[i - 1]));
  const base = history[index - 1];
  // The rear axle moves sideways three times faster than the car goes ahead, then gently.
  const fast = { ...base, car: { ...base.car, speed: 1, rearSlip: 3 } };
  const gentle = { ...history[index], car: { ...history[index].car, speed: 1, rearSlip: 0.1 } };
  assert.equal(intensityOf(fast), 1);
  near(intensityOf(gentle), 0.1, 1e-12);

  // With a full intensity above 1 a mark below the cap shows whether the
  // intensity was capped: (1 + 0.1) / 2 / 2, and not (3 + 0.1) / 2 / 2.
  const marks = createTireMarks({ fullIntensity: 2 });
  marks.record(fast, context);
  marks.record(gentle, context);
  const [segment] = marks.segments(gentle.time);
  near(segment.strength, (1 + 0.1) / 2 / 2, 1e-12);
});

test('the full intensity can be changed', () => {
  const history = play(context, 4, 1);
  const half = createTireMarks({ fullIntensity: 0.8 });
  const normal = createTireMarks();
  let compared = 0;
  for (let i = 0; i < history.length; i += 1) {
    half.record(history[i], context);
    normal.record(history[i], context);
    if (!(i > 0 && sliding(history[i]) && sliding(history[i - 1]))) continue;
    const [a] = half.segments(history[i].time).filter((s) => s.alpha === 1);
    const [b] = normal.segments(history[i].time).filter((s) => s.alpha === 1);
    near(a.strength, strengthBetween(history[i - 1], history[i], 0.8), 1e-12, `step ${i}`);
    // Where the normal mark is not saturated, half the full intensity is twice as faint.
    if (b.strength < 1) near(a.strength, b.strength / 2, 1e-12, `step ${i}`);
    compared += 1;
  }
  assert.ok(compared > 20);
});

test('the tail leaves its marks on the outside of the curve', () => {
  const marks = createTireMarks();
  let checked = 0;
  for (const world of play(context, 20, 0.6)) {
    marks.record(world, context);
    if (!sliding(world) || world.car.slip < 0.3) continue;
    const pin = lane.poseAt(world.car.distance);
    for (const segment of marks.segments(world.time).filter((s) => s.alpha === 1)) {
      // Cross product of the tangent of the lane and the vector to the wheel:
      // negative means to the right, the outside of a curve to the left.
      const across = Math.cos(pin.heading) * (segment.y2 - pin.y) - Math.sin(pin.heading) * (segment.x2 - pin.x);
      assert.ok(across < 0, `across ${across}`);
      checked += 1;
    }
  }
  assert.ok(checked > 100, `${checked} marks checked`);
});

test('the marks fade out and are gone after their lifetime', () => {
  const marks = createTireMarks({ lifetime: LIFETIME });
  const history = play(context, 20, 0.6);
  let last = null;
  for (const world of history) {
    marks.record(world, context);
    if (sliding(world)) last = world;
  }
  const now = last.time;
  const alphas = (time) => marks.segments(time).map((segment) => segment.alpha);
  assert.equal(Math.max(...alphas(now)), 1);
  near(Math.max(...alphas(now + 0.5)), 0.75, 1e-9);
  near(Math.max(...alphas(now + 1)), 0.5, 1e-9);
  for (const alpha of alphas(now + 1)) assert.ok(alpha > 0 && alpha <= 0.5 + 1e-9);
  assert.equal(marks.segments(now + LIFETIME).length, 0);
  assert.equal(marks.segments(now + 10).length, 0);
  // The older marks are always fainter than the newer ones.
  const sorted = marks.segments(now);
  for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i].alpha >= sorted[i - 1].alpha - 1e-12);
});

test('the memory of the marks is bounded', () => {
  const marks = createTireMarks({ lifetime: LIFETIME });
  for (const world of play(context, 60, 0.6)) marks.record(world, context);
  // Two wheels, one mark per step, only for as many steps as the lifetime lasts.
  assert.ok(marks.size <= 2 * (Math.ceil(LIFETIME / context.dt) + 1), `size ${marks.size}`);
  assert.ok(marks.size > 0);
});

test('a restart clears the marks', () => {
  const marks = createTireMarks();
  const history = play(context, 20, 0.6);
  for (const world of history) marks.record(world, context);
  assert.ok(marks.size > 0);
  marks.record(createWorld(context), context);
  assert.equal(marks.size, 0);
  assert.equal(marks.segments(0).length, 0);
});

test('drawing the same world again, as in a pause, adds nothing', () => {
  const marks = createTireMarks();
  const history = play(context, 20, 0.6);
  const index = history.findIndex((world, i) => i > 0 && sliding(world) && sliding(history[i - 1]));
  for (let i = 0; i <= index; i += 1) marks.record(history[i], context);
  const size = marks.size;
  assert.ok(size > 0);
  for (let i = 0; i < 100; i += 1) marks.record(history[index], context);
  assert.equal(marks.size, size);
});

test('two slides far apart in time are not joined by a mark', () => {
  const marks = createTireMarks();
  const history = play(context, 20, 0.6);
  const first = history.findIndex((world) => sliding(world));
  const second = history.findIndex((world, i) => i > first + 60 && sliding(world));
  assert.ok(second > first);
  marks.record(history[first], context);
  marks.record(history[second], context);
  assert.equal(marks.size, 0);
});

test('a short pause of the slide breaks the mark in two', () => {
  const history = play(context, 20, 0.6);
  const index = history.findIndex((world, i) => i > 0 && sliding(world) && sliding(history[i - 1]));
  const slide = history[index];
  // The same car, a moment later, with the tail holding for one step.
  const holding = { ...slide, time: slide.time + 0.01, car: { ...slide.car, rearSlip: 0 } };
  const again = { ...slide, time: slide.time + 0.02 };

  const marks = createTireMarks();
  marks.record(history[index - 1], context);
  marks.record(slide, context);
  const joined = marks.size;
  assert.equal(joined, 2);
  marks.record(holding, context);
  marks.record(again, context);
  // Nothing joins the slide before the pause to the one after it.
  assert.equal(marks.size, joined);
  marks.record({ ...again, time: slide.time + 0.03 }, context);
  assert.equal(marks.size, joined + 2);
});

test('nothing is recorded off the track or with the tail rule off', () => {
  // The car slides its tail and then spins off the track at full throttle.
  const spinning = play(context, 4, 1);
  const exitIndex = spinning.findIndex((world) => world.car.status === 'offTrack');
  assert.ok(exitIndex > 0);
  const marks = createTireMarks();
  for (let i = 0; i < exitIndex; i += 1) marks.record(spinning[i], context);
  const before = marks.size;
  assert.ok(before > 0, 'no mark before the exit');
  let offSteps = 0;
  for (let i = exitIndex; i < spinning.length && spinning[i].car.status === 'offTrack'; i += 1) {
    offSteps += 1;
    marks.record(spinning[i], context);
    // Nothing is added (the old marks may only expire) and none is fresh.
    assert.ok(marks.size <= before, `step ${i}: size ${marks.size}`);
    assert.ok(marks.segments(spinning[i].time).every((segment) => segment.alpha < 1), `step ${i}`);
  }
  // The whole stay off the track was checked, not only its first steps.
  assert.equal(offSteps, context.recoverySteps);

  const plainContext = createContext({ lane, rules: { tailSlide: false } });
  const plain = createTireMarks();
  for (const world of play(plainContext, 10, 1)) plain.record(world, plainContext);
  assert.equal(plain.size, 0);
});

test('the options are validated', () => {
  assert.throws(() => createTireMarks({ lifetime: 0 }), RangeError);
  assert.throws(() => createTireMarks({ lifetime: -1 }), RangeError);
  assert.throws(() => createTireMarks({ lifetime: Number.NaN }), RangeError);
  assert.throws(() => createTireMarks({ halfTrack: 0 }), RangeError);
  assert.throws(() => createTireMarks({ halfTrack: Number.POSITIVE_INFINITY }), RangeError);
  assert.throws(() => createTireMarks({ fullIntensity: 0 }), RangeError);
  assert.throws(() => createTireMarks({ fullIntensity: Number.NaN }), RangeError);
  assert.doesNotThrow(() => createTireMarks({ lifetime: 1, halfTrack: 0.01, fullIntensity: 0.5 }));
});

test('recording does not modify the world', () => {
  const marks = createTireMarks();
  const frozen = (value) => {
    for (const inner of Object.values(value)) {
      if (inner !== null && typeof inner === 'object') frozen(inner);
    }
    return Object.freeze(value);
  };
  for (const world of play(context, 10, 0.6)) marks.record(frozen(world), context);
  assert.ok(marks.size > 0);
});
