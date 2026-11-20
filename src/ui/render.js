/**
 * Drawing of the circuit and of the car on a canvas.
 *
 * The simulation works in meters with the y axis pointing up; the canvas has
 * its y axis pointing down. The renderer fits the whole circuit in the canvas
 * and flips the axis. The car is recognizable by its shape, not only by its
 * color. The WCAG contrast ratios quoted below were computed for the pairs of
 * colors that they name; the drawing as a whole was not checked against a
 * minimum.
 *
 * With the rule `tailSlide` the car is drawn as a body that may be turned away
 * from the lane, with the guide pin, which stays on the lane, marked on it, and
 * the rear tires leave fading marks on the track while the tail slides.
 */

import { createLane } from '../core/geometry.js';
import { carPose } from '../core/simulation.js';
import { createTireMarks } from './tireMarks.js';

const PALETTE = Object.freeze({
  background: '#0f1216',
  edge: '#d9dde3',
  surface: '#3a3f47',
  slot: '#9aa3ad',
  checkerLight: '#ffffff',
  checkerDark: '#000000',
  carBody: '#ffd400',
  carOutline: '#000000',
  carWindow: '#1b2430',
  pinCore: '#000000',
  pinRing: '#ffffff',
});

// Sizes in meters. A 1:32 car is about 13 cm long.
const EDGE_WIDTH = 0.012;
const SLOT_WIDTH = 0.006;
const CAR_LENGTH = 0.13;
const CAR_WIDTH = 0.06;
// The guide pin: a dark core in a light ring with a thin dark outline, so that
// it stands out both on the yellow body and on the dark surface when the car is
// off the track. WCAG contrast ratios of the neighbouring colors: core on ring
// 21:1, outline on the yellow body 14.7:1, ring on the surface 10.6:1. The ring
// reaches the windscreen, where the outline is only 1.34:1 against it; there
// the ring (15.7:1 on the windscreen) and the core make the pin out.
const PIN_RADIUS = 0.009;
const PIN_OUTLINE = 0.0015;
const PIN_CORE_RATIO = 0.55;
// The marks of the sliding rear tires. The strongest fresh mark, from a hard
// slide, is drawn at this opacity; a milder slide gives a fainter mark, in
// proportion, and every mark fades out with time (see `tireMarks.js`). The
// strongest of the cool marks has a contrast of 4.65:1 on the surface (WCAG
// ratio of the blended color, rounded to 8 bits); the fainter ones are
// decorative and have less.
// The color follows how close the slide was to losing the car (the heat of the
// mark, see `tireMarks.js`): light grey for a normal slide, red towards the
// spin-out. A red at the opacity of the cool marks would be too dim on the dark
// surface (about 2.6:1), so the opacity rises with the heat up to
// `TIRE_MARK_HOT_OPACITY`; the hottest mark has a contrast of 3.94:1 (same way
// of working it out). The strength still says how visible a mark is, so the
// information is not only in the color.
const TIRE_MARK_WIDTH = 0.008;
const TIRE_MARK_OPACITY = 0.7;
const TIRE_MARK_HOT_OPACITY = 1;
const TIRE_MARK_COOL = Object.freeze([0xd7, 0xdb, 0xe2]);
const TIRE_MARK_HOT = Object.freeze([0xff, 0x70, 0x70]);
const CHECKER_DEPTH = 0.016;
const CHECKER_CELLS = 8;
// The chevron after the finish line that shows the direction of travel. It is
// narrower than the distance between the slots (0.10 m), so it does not cover
// them, and it starts beyond the checkered line (which ends at 0.016 m).
const DIRECTION_MARK_START = 0.05;
const DIRECTION_MARK_DEPTH = 0.04;
const DIRECTION_MARK_HALF_HEIGHT = 0.03;
const DIRECTION_MARK_WIDTH = 0.012;
const DIRECTION_MARK_OPACITY = 0.85;
const SAMPLE_SPACING = 0.02;
const MARGIN = 0.06;

/**
 * Creates a renderer for a circuit.
 * @param {HTMLCanvasElement} canvas Canvas to draw on.
 * @param {{track: object, trackWidth: number, lanes: Object<string, object>}} circuit
 * @param {object} context Simulation context (see `createContext`).
 * @returns {{draw: function(object): void, resize: function(): void}}
 */
export function createRenderer(canvas, circuit, context) {
  const surface = canvas.getContext('2d');
  if (surface === null) throw new Error('the canvas has no 2D drawing context');

  const centerLane = createLane(circuit.track, 0);
  const centerPoints = centerLane.sample(SAMPLE_SPACING);
  const lanePoints = Object.values(circuit.lanes).map((lane) => lane.sample(SAMPLE_SPACING));
  const finish = centerLane.poseAt(0);
  const tireMarks = createTireMarks();

  // Bounding box of the track surface, with a margin.
  const half = circuit.trackWidth / 2 + EDGE_WIDTH + MARGIN;
  const xs = centerPoints.map((p) => p.x);
  const ys = centerPoints.map((p) => p.y);
  const bounds = {
    minX: Math.min(...xs) - half,
    maxX: Math.max(...xs) + half,
    minY: Math.min(...ys) - half,
    maxY: Math.max(...ys) + half,
  };

  let width = 0;
  let height = 0;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  function toCanvas(x, y) {
    return [offsetX + (x - bounds.minX) * scale, offsetY + (bounds.maxY - y) * scale];
  }

  function tracePath(points) {
    surface.beginPath();
    points.forEach((point, index) => {
      const [x, y] = toCanvas(point.x, point.y);
      if (index === 0) surface.moveTo(x, y);
      else surface.lineTo(x, y);
    });
    surface.closePath();
  }

  function strokePath(points, color, lineWidth) {
    tracePath(points);
    surface.strokeStyle = color;
    surface.lineWidth = lineWidth * scale;
    surface.lineJoin = 'round';
    surface.stroke();
  }

  /** Places the origin on a pose, with the x axis along the heading. */
  function withPose(pose, drawLocal) {
    const [x, y] = toCanvas(pose.x, pose.y);
    surface.save();
    surface.translate(x, y);
    // The canvas y axis points down, so a counterclockwise heading is a
    // clockwise rotation on the screen.
    surface.rotate(-pose.heading);
    drawLocal();
    surface.restore();
  }

  function drawFinishLine() {
    const cell = circuit.trackWidth / CHECKER_CELLS;
    withPose(finish, () => {
      for (let row = 0; row < 2; row += 1) {
        for (let column = 0; column < CHECKER_CELLS; column += 1) {
          surface.fillStyle = (row + column) % 2 === 0 ? PALETTE.checkerLight : PALETTE.checkerDark;
          surface.fillRect(
            (row - 1) * CHECKER_DEPTH * scale,
            (-circuit.trackWidth / 2 + column * cell) * scale,
            CHECKER_DEPTH * scale,
            cell * scale,
          );
        }
      }
      drawDirectionMark();
    });
  }

  /**
   * Draws a chevron on the center of the track, just after the checkered line,
   * pointing along the direction of travel. The car starts behind the line, so
   * it does not hide the mark. In the frame of the pose, with the x axis along
   * the heading.
   */
  function drawDirectionMark() {
    surface.save();
    surface.globalAlpha = DIRECTION_MARK_OPACITY;
    surface.strokeStyle = PALETTE.checkerLight;
    surface.lineWidth = DIRECTION_MARK_WIDTH * scale;
    surface.lineJoin = 'miter';
    surface.lineCap = 'butt';
    surface.beginPath();
    surface.moveTo(DIRECTION_MARK_START * scale, -DIRECTION_MARK_HALF_HEIGHT * scale);
    surface.lineTo((DIRECTION_MARK_START + DIRECTION_MARK_DEPTH) * scale, 0);
    surface.lineTo(DIRECTION_MARK_START * scale, DIRECTION_MARK_HALF_HEIGHT * scale);
    surface.stroke();
    surface.restore();
  }

  /** Draws the marks that the sliding rear tires left, fading out with time. */
  function drawTireMarks(time) {
    const segments = tireMarks.segments(time);
    if (segments.length === 0) return;
    surface.save();
    surface.lineWidth = TIRE_MARK_WIDTH * scale;
    // Square ends, so that two joined segments do not overlap and show a bead.
    surface.lineCap = 'butt';
    for (const segment of segments) {
      const { heat } = segment;
      const [red, green, blue] = TIRE_MARK_COOL.map((cool, i) => Math.round(cool + heat * (TIRE_MARK_HOT[i] - cool)));
      surface.strokeStyle = `rgb(${red}, ${green}, ${blue})`;
      const opacity = TIRE_MARK_OPACITY + heat * (TIRE_MARK_HOT_OPACITY - TIRE_MARK_OPACITY);
      surface.globalAlpha = opacity * segment.alpha * segment.strength;
      const [x1, y1] = toCanvas(segment.x1, segment.y1);
      const [x2, y2] = toCanvas(segment.x2, segment.y2);
      surface.beginPath();
      surface.moveTo(x1, y1);
      surface.lineTo(x2, y2);
      surface.stroke();
    }
    surface.restore();
  }

  function drawCar(world) {
    const pose = carPose(world, context);
    withPose(pose, () => {
      const length = CAR_LENGTH * scale;
      const carWidth = CAR_WIDTH * scale;
      surface.fillStyle = PALETTE.carBody;
      surface.strokeStyle = PALETTE.carOutline;
      surface.lineWidth = Math.max(1.5, 0.004 * scale);
      surface.beginPath();
      surface.rect(-length / 2, -carWidth / 2, length, carWidth);
      surface.fill();
      surface.stroke();
      // The windscreen marks the front of the car.
      surface.fillStyle = PALETTE.carWindow;
      surface.fillRect(length * 0.08, -carWidth * 0.35, length * 0.22, carWidth * 0.7);
      if (context.tailSlide) drawPin();
    });
  }

  /**
   * Draws the guide pin in the frame of the body: on the axis, in front of the
   * center by `pinToCenterOfMass`. On the track it is the point on the lane
   * that the rest of the car follows.
   */
  function drawPin() {
    const x = context.params.pinToCenterOfMass * scale;
    const disc = (radius, color) => {
      surface.fillStyle = color;
      surface.beginPath();
      surface.arc(x, 0, radius * scale, 0, 2 * Math.PI);
      surface.fill();
    };
    disc(PIN_RADIUS + PIN_OUTLINE, PALETTE.pinCore);
    disc(PIN_RADIUS, PALETTE.pinRing);
    disc(PIN_RADIUS * PIN_CORE_RATIO, PALETTE.pinCore);
  }

  /** Fits the canvas to its displayed size and to the screen density. */
  function resize() {
    const density = globalThis.devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * density));
    canvas.height = Math.max(1, Math.round(height * density));
    surface.setTransform(density, 0, 0, density, 0, 0);

    const boundsWidth = bounds.maxX - bounds.minX;
    const boundsHeight = bounds.maxY - bounds.minY;
    scale = Math.min(width / boundsWidth, height / boundsHeight);
    offsetX = (width - boundsWidth * scale) / 2;
    offsetY = (height - boundsHeight * scale) / 2;
  }

  function drawPauseOverlay() {
    surface.fillStyle = 'rgba(15, 18, 22, 0.72)';
    surface.fillRect(0, 0, width, height);
    surface.fillStyle = PALETTE.checkerLight;
    surface.textAlign = 'center';
    surface.textBaseline = 'middle';
    surface.font = `600 ${Math.round(height * 0.12)}px system-ui, sans-serif`;
    surface.fillText('Paused', width / 2, height / 2 - height * 0.04);
    surface.font = `${Math.round(height * 0.055)}px system-ui, sans-serif`;
    surface.fillText('Press P to resume', width / 2, height / 2 + height * 0.08);
  }

  /**
   * Draws the circuit and the car of the given world.
   * @param {object} world World to draw.
   * @param {{paused?: boolean, steps?: object[], restarted?: boolean}} [options]
   *   When `paused`, a message is drawn over the circuit. `steps` are the worlds
   *   of the simulation steps run since the last drawing, oldest first: the tire
   *   marks are made of them, so they do not depend on how often the world is
   *   drawn. Without it the marks are made of `world` alone. When `restarted`,
   *   the marks of the race before are forgotten.
   */
  function draw(world, { paused = false, steps = [world], restarted = false } = {}) {
    surface.fillStyle = PALETTE.background;
    surface.fillRect(0, 0, width, height);

    strokePath(centerPoints, PALETTE.edge, circuit.trackWidth + 2 * EDGE_WIDTH);
    strokePath(centerPoints, PALETTE.surface, circuit.trackWidth);
    for (const points of lanePoints) strokePath(points, PALETTE.slot, SLOT_WIDTH);
    drawFinishLine();
    // While the game is paused no step runs, so the marks stay.
    if (restarted) tireMarks.reset();
    for (const step of steps) tireMarks.record(step, context);
    drawTireMarks(world.time);
    drawCar(world);
    if (paused) drawPauseOverlay();
  }

  resize();
  return { draw, resize };
}
