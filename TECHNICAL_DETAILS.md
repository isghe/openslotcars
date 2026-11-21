# OpenSlotCars

**OpenSlotCars** is an open source project for simulating slot car racing on electric tracks, running entirely in the browser.

The simulator uses a two-dimensional top-down view and reproduces the behavior of small cars bound to the lanes of a circuit, modeling acceleration, braking, friction, centrifugal force, a tail that slides out in curves and the possibility of leaving the track.

The project plans to build circuits from modular pieces, to handle several cars, to control the throttle, to time laps and to simulate races against computer-controlled opponents.

The architecture is entirely client-side, based on JavaScript and native web technologies, with no dependency on application frameworks. The simulation needs no application server and no back end: the browser runs everything, and the files only have to be served as static files over HTTP (see [Running it](#running-it) for why opening `index.html` directly is not enough).

The goal is a lightweight, extensible and accessible simulator that combines the fun of slot cars with experimenting with circuit geometry and the physics of motion.

## Status

This is a first playable prototype.

**Works today**

- Six circuits, chosen from a menu: an oval, a rounded rectangle (speedway), an oval with an S-bend of two long, tight curves on the first straight, two half turns, the first tightening and the second widening, and a long, fast return straight (the chicane, driven clockwise), a teardrop with a hairpin and a rounded L with a wide first curve and a left turn in its reentrant corner (Club, also driven clockwise), and a horizontal figure eight with a ground-level crossing. Each has an inner and an outer lane (the car runs on the inner one). Choosing another circuit starts a new race. The address can choose the circuit the page opens on: `?circuit=oval`, `speedway`, `chicane`, `teardrop`, `club` or `infinite-loop` (the case and the spaces around the name do not matter; a missing or unknown name gives the oval). Choosing a circuit from the menu rewrites the argument in the address (the entry of the history is replaced, not added), so reloading the page or sharing the address brings the circuit back. The lap times are those of the session and are not kept between circuits or page loads.
- One car with a throttle, motor braking, friction and air drag.
- A car with a guide pin that follows the lane and a body that pivots about it. Going too fast in a curve makes the tail slide out, which costs speed; going much too fast turns the body so far that the car leaves the track, slides a short way, and is put back on its lane after a pause. The values of the body (distances, inertia, damping, spin-out angle) are estimates for a 1:32 car, not measurements.
- Marks that the rear tires leave on the track while the tail slides, stronger the harder the tail slides, turning from light grey to red towards the spin-out, and fading out after about four seconds.
- Lap timing with a finish line, the last lap, the best lap, and laps marked as not valid when the car left the track.
- Keyboard and touch controls, pause and restart.
- An accessible timing panel, with events announced in a polite live region.

**Planned**

- Circuits built from modular pieces, more than one car, computer-controlled opponents, and races.

## Running it

You need [Node.js](https://nodejs.org/) 20 or later (the project is developed and tested with Node 24). It has no dependencies to install.

```sh
npm start
```

Then open <http://127.0.0.1:8080/>. To use another port: `npm start -- --port 8081`, or set the `PORT` environment variable.

Browsers refuse to load ES modules from `file://` pages, so opening `index.html` with a double click does not work. `npm start` runs a minimal static file server (`scripts/serve.mjs`) that listens on the loopback address only. Any other static file server serves the project folder just as well.

### Controls

| Action | Keyboard | Touch or mouse |
| --- | --- | --- |
| Accelerate | Hold `Space` or `↑` | Hold the **Throttle** button |
| Brake | Release the key | Release the button |
| Pause or resume | `P` or `Esc` | **Pause** button |
| Restart | `R` | **Restart** button |

The throttle rises gradually while the key is held, in 0.4 seconds from nothing to full, and drops to zero as soon as it is released. A short tap therefore gives a partial throttle. At full throttle the car is too fast for the curves, so the way to a good lap is to dose the throttle.

The game pauses by itself when the window loses the focus or the page is hidden.

### Tests

```sh
npm test
```

This runs the tests with the test runner built into Node (`node --test`). They cover the geometry, the circuits (each one must close, with the lane lengths worked out by hand), the physics (the body and its sliding tail included), the lap timer, the simulation, the logic of each frame (pause and restart included), the controls, the content of the timing panel, the circuit menu and the circuit named in the address, the logic of the tire marks, the static server and the handling of keyboard, pointer and focus events (run against simple stand-ins for the page, not a real browser). The drawing on the canvas, the wiring in `src/main.js` and the connection of the timing panel to the page have no automated tests and are checked by hand in a browser.

## How it works

- **Circuit direction**: circuits whose curves all turn the same way run counterclockwise; ordinary circuits with both left and right turns run clockwise. A figure eight explicitly declares `"topology":"figure-eight"`: its first lobe runs clockwise, the other counterclockwise, giving zero net turning and equal lane lengths.
- **Geometry** (`src/core/geometry.js`): a circuit is a closed chain of straights and circular arcs. The position, the heading and the curvature of every lane are computed in closed form, and every lane has its own length.
- **Physics** (`src/core/physics.js`): the motor pushes less as the car speeds up, and there are rolling friction and air drag. In a curve the car needs a lateral acceleration of `v² · curvature`. The guide pin stays on the lane and the body is a rigid bar hinged at the pin. The grip of the rear wheels is derived from the grip limit (`maxLateralAcceleration`): while it is enough, the tail rolls behind the pin, slightly inside the curve; above it the tail slides out gradually and the slide takes speed from the car. The car leaves the track only when the body has turned more than `maxSlipAngle` from the lane. All values are parameters with their units documented in the file.
- **Simulation** (`src/core/simulation.js`, `src/core/stepper.js`): the world advances in fixed steps of 1/120 s, whatever the frame rate, so results are deterministic. The drawing is interpolated between two steps. The rule `tailSlide` turns the body model on, and it is on by default; with it off the car is a single point on the lane and leaves the track as soon as the grip limit is exceeded. The body model needs a step shorter than the pin-to-axle distance over the free speed of the car (about 1/62 s with the default parameters), and the simulation refuses a longer one.
- **Lap timing** (`src/core/lapTimer.js`): the instant of each crossing of the finish line is interpolated inside the step, which removes the rounding of lap times to a whole step. Their accuracy still depends on the physics step, because the motion is integrated only to first order: for a lap at a constant throttle the error against a much finer step is about 2.7 ms at the default 1/120 s and more than 10 ms at 1/30 s (see `test/simulation.test.js`).
- **Frame logic** (`src/core/game.js`): what happens in each animation frame, including the pause (no time passes, and the time spent in pause is not made up for) and the restart.
- **Page** (`src/ui/`, `src/main.js`): the canvas drawing, the input handling and the timing panel. The tire marks (`src/ui/tireMarks.js`) are only a visual aid: the module keeps the segments that the two rear wheels traced between two simulation steps while sliding (the page gives it every step, so the marks are the same at any frame rate for the same simulation steps; this was checked down to 5 frames per second in a browser, by comparing the pixels of the marks. Below 4 frames per second the game takes at most 0.25 s of each frame, so the real time that is left out is not made up for), gives each a strength in proportion to how hard the tail slid (the share of the rear grip that works against the car, up to a reference intensity of 0.4, above which a mark is as strong as it gets), gives each a heat as well (0 up to that same 0.4, rising to 1 at an intensity of 0.7, a choice of the drawing: the drawing paints a mark from light grey to red with it, and makes the hottest ones more opaque) and fades them out, and the drawing only paints them.

The logic in `src/core/` is pure: it does not touch the page, read a clock or use random numbers, so it also runs in Node.

## Circuit data

Each circuit is defined in `circuits/<id>.json`. The ordered filename list in
`circuits/index.json` supplies the menu order. The data fields are `id`, `name`,
`pieces`, `start` (`x`, `y`, `heading`), `trackWidth` and `lanes` (`inner`, `outer`).
Distances are in meters and all angles, including the starting heading, are in
radians. Positive curve angles turn left; positive lane offsets lie to the left
of travel. A straight is `{"type":"straight","length":1}`; an arc is
`{"type":"curve","radius":0.4,"angle":3.141592653589793}`.

Numeric fields accept numbers or exact references such as `"Math.HALF_PI"`.
`circuits/math.json` defines the constants as uppercase names with finite
numeric values, for example `{"PI":3.141592653589793}`. `Math` is a reference
prefix, not the JavaScript object: expressions such as `"Math.PI / 2"` are
rejected. Negative angles use explicit names such as `"Math.NEG_HALF_PI"`.
The constants file is separate from the ordered circuit index and is loaded
once with it. Unknown names, nonnumeric constants and invalid files stop
startup with the same error handling as invalid circuit data.

Preserve full numeric precision when calculating angles or tangent lengths:
the track must close in position
and heading within `1e-9`. The first and last pieces must be straights so that
the finish line lies on a straight. Definitions are validated and copied into
deeply frozen objects; invalid geometry, inconsistent directions, ambiguous
names and incompatible lane offsets are rejected rather than corrected.

`src/data/loadCircuits.js` fetches the index and all its circuits once at startup.
URLs are relative to that module, so the same files work at the site root or
under `/openslotcars/`. The game starts only after the whole catalog is valid.
Controls remain disabled while loading; a failed request or invalid file shows
an error and leaves the game stopped. An unknown `?circuit=` value still selects
Oval; it does not cause another file to be fetched. Changing circuits after
startup uses the loaded catalog without more requests.

To add a circuit, create its JSON file and list the filename in `index.json`.
The filename must match the lowercase identifier, for example `club.json` for
`club`. The names `index` and `math` are reserved. Keep identifiers and names
unambiguous, follow the direction rule above,
and add independent expected lengths and geometry checks to the circuit tests.
No JavaScript definition, build step or application server is required.

### Construction notes

- **Infinite Loop:** two opposite 270 degree arcs of radius 0.60 m, joined by
  1.2 m diagonals crossing at right angles. The circle centers lie at
  `(+/-0.6 * sqrt(2), 0)`. The finish is 0.30 m before the crossing on the
  northeast diagonal, at `(-0.15 * sqrt(2), -0.15 * sqrt(2))`, heading `PI/4`.
  Both lane lengths are `2.4 + 1.8 * PI` m: the tighter radius in one lobe
  is compensated by the wider radius in the other. The crossing is at ground
  level, with no bridge or lane change; the guide follows its distance along
  its own lane through each intersection. In this topology, the lane names
  `inner` and `outer` no longer describe a globally shorter or longer route.

- **Oval:** two 2 m straights and two half circles of centerline radius 0.40 m.
  The finish splits the main straight equally. Lane offsets of 0.05 m give
  radii of 0.35 m and 0.45 m.
- **Speedway:** four quarter circles of radius 0.40 m, two 2 m straights and
  two 1 m side straights, with the finish halfway along the main straight.
- **Chicane:** the S-bend has two opposite 135 degree arcs of radius 0.20 m.
  Its sideways displacement is `2 * 0.2 * (1 + sqrt(1/2))`, about 0.68 m,
  and its forward displacement is `2 * 0.2 * sqrt(1/2)`, about 0.28 m.
  The first clockwise half turn tightens from radius 1.1 m to
  `1 + sideways displacement - 1.1` m. The other widens from 0.35 m to 0.65 m.
  Their different displacements close the layout with the 3.5 m return straight.
  The finish divides its other straight into two 0.6 m parts, separated from
  the first half turn by the S-bend and another 1.2 m straight.
  The long tight S-bend is intended to require slowing down: the original
  calibration measured spin-outs from about 2 m/s at constant speed, compared
  with about 3.4 m/s for the earlier pair of 45 degree arcs. At full throttle
  the 3.5 m return straight reached about 4 m/s from rest or from 3 m/s; the
  equilibrium speed of the unchanged parameters was 4.44 m/s.
- **Teardrop:** radii of 0.60 m and 0.30 m with centers 1.5 m apart.
  The tangent tilt is `asin((0.6 - 0.3) / 1.5)` and the tangent length is
  `sqrt(1.5 ** 2 - (0.6 - 0.3) ** 2)`. The hairpin turns through
  `PI - 2 * tilt`, the wide curve through `PI + 2 * tilt`; the finish splits
  one tangent equally.
- **Club:** a rounded 4 m by 3 m L, traversed clockwise. Before rounding,
  vertices are `(0,0)`, `(4,0)`, `(4,1.5)`, `(1.5,1.5)`, `(1.5,3)`, `(0,3)`,
  translated by -2 m in x to place the finish at `(0,0)`. Each quarter circle
  trims its radius from both adjacent sides. In travel order the radii are
  1.2, 0.35, 0.50, 0.30, 0.35 and 0.40 m; only the fourth curve turns left.
  The finish splits the 2.4 m main straight into 1.6 m before and 0.8 m after it.

The geometry regression fixture records lane lengths, piece endpoints and lane
poses captured before moving the definitions to JSON. Separate tests retain
length formulas and validate parsing, catalog loading and HTTP error handling.

## Project layout

```
index.html, style.css, favicon.svg   the page
src/main.js                          entry point and main loop
circuits/                            ordered index and per-circuit JSON data
src/data/                            asynchronous circuit catalog loading
src/core/                            pure logic: geometry, circuits, physics,
                                     simulation, stepper, game, lap timer, controls, timing
src/ui/                              canvas drawing, input, timing panel, circuit menu
scripts/serve.mjs                    local static file server
test/                                automated tests
```

## Publishing on GitHub Pages

The project is made of static files with relative URLs, so it can be served from a sub-path such as `https://<user>.github.io/<repository>/`. In the repository settings, open **Pages**, choose **Deploy from a branch**, select the `master` branch and the `/ (root)` folder. No build step is needed.

## License

Released under the [MIT License](LICENSE).
