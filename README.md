# OpenSlotCars

**OpenSlotCars** is an open source project for simulating slot car racing on electric tracks, running entirely in the browser.

The simulator uses a two-dimensional top-down view and reproduces the behavior of small cars bound to the lanes of a circuit, modeling acceleration, braking, friction, centrifugal force, a tail that slides out in curves and the possibility of leaving the track.

The project plans to build circuits from modular pieces, to handle several cars, to control the throttle, to time laps and to simulate races against computer-controlled opponents.

The architecture is entirely client-side, based on JavaScript and native web technologies, with no dependency on application frameworks. The simulation needs no application server and no back end: the browser runs everything, and the files only have to be served as static files over HTTP (see [Running it](#running-it) for why opening `index.html` directly is not enough).

The goal is a lightweight, extensible and accessible simulator that combines the fun of slot cars with experimenting with circuit geometry and the physics of motion.

## Status

This is a first playable prototype.

**Works today**

- A fixed oval circuit with an inner and an outer lane (the car runs on the inner one).
- One car with a throttle, motor braking, friction and air drag.
- A car with a guide pin that follows the lane and a body that pivots about it. Going too fast in a curve makes the tail slide out, which costs speed; going much too fast turns the body so far that the car leaves the track, slides a short way, and is put back on its lane after a pause. The values of the body (distances, inertia, damping, spin-out angle) are estimates for a 1:32 car, not measurements.
- Marks that the rear tires leave on the track while the tail slides, stronger the harder the tail slides and fading out after about two seconds.
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

This runs the tests with the test runner built into Node (`node --test`). They cover the geometry, the physics (the body and its sliding tail included), the lap timer, the simulation, the logic of each frame (pause and restart included), the controls, the content of the timing panel, the logic of the tire marks, the static server and the handling of keyboard, pointer and focus events (run against simple stand-ins for the page, not a real browser). The drawing on the canvas, the wiring in `src/main.js` and the connection of the timing panel to the page have no automated tests and are checked by hand in a browser.

## How it works

- **Geometry** (`src/core/geometry.js`): a circuit is a closed chain of straights and circular arcs. The position, the heading and the curvature of every lane are computed in closed form, and every lane has its own length.
- **Physics** (`src/core/physics.js`): the motor pushes less as the car speeds up, and there are rolling friction and air drag. In a curve the car needs a lateral acceleration of `v² · curvature`. The guide pin stays on the lane and the body is a rigid bar hinged at the pin. The grip of the rear wheels is derived from the grip limit (`maxLateralAcceleration`): while it is enough, the tail rolls behind the pin, slightly inside the curve; above it the tail slides out gradually and the slide takes speed from the car. The car leaves the track only when the body has turned more than `maxSlipAngle` from the lane. All values are parameters with their units documented in the file.
- **Simulation** (`src/core/simulation.js`, `src/core/stepper.js`): the world advances in fixed steps of 1/120 s, whatever the frame rate, so results are deterministic. The drawing is interpolated between two steps. The rule `tailSlide` turns the body model on, and it is on by default; with it off the car is a single point on the lane and leaves the track as soon as the grip limit is exceeded. The body model needs a step shorter than the pin-to-axle distance over the free speed of the car (about 1/62 s with the default parameters), and the simulation refuses a longer one.
- **Lap timing** (`src/core/lapTimer.js`): the instant of each crossing of the finish line is interpolated inside the step, which removes the rounding of lap times to a whole step. Their accuracy still depends on the physics step, because the motion is integrated only to first order: for a lap at a constant throttle the error against a much finer step is about 2.7 ms at the default 1/120 s and more than 10 ms at 1/30 s (see `test/simulation.test.js`).
- **Frame logic** (`src/core/game.js`): what happens in each animation frame, including the pause (no time passes, and the time spent in pause is not made up for) and the restart.
- **Page** (`src/ui/`, `src/main.js`): the canvas drawing, the input handling and the timing panel. The tire marks (`src/ui/tireMarks.js`) are only a visual aid: the module keeps the segments that the two rear wheels traced while sliding, gives each a strength in proportion to how hard the tail slid (the share of the rear grip that works against the car, up to a reference intensity of 0.4, above which a mark is as strong as it gets) and fades them out, and the drawing only paints them.

The logic in `src/core/` is pure: it does not touch the page, read a clock or use random numbers, so it also runs in Node.

## Project layout

```
index.html, style.css, favicon.svg   the page
src/main.js                          entry point and main loop
src/core/                            pure logic: geometry, circuits, physics,
                                     simulation, stepper, game, lap timer, controls, timing
src/ui/                              canvas drawing, input, timing panel
scripts/serve.mjs                    local static file server
test/                                automated tests
```

## Publishing on GitHub Pages

The project is made of static files with relative URLs, so it can be served from a sub-path such as `https://<user>.github.io/<repository>/`. In the repository settings, open **Pages**, choose **Deploy from a branch**, select the `master` branch and the `/ (root)` folder. No build step is needed.

## License

Released under the [MIT License](LICENSE).
