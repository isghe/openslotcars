# OpenSlotCars

A slot car racing simulator that runs in your browser. Keep the throttle down through a curve and the tail of the car slides out, leaving tire marks on the track.

![A yellow slot car coming out of a curve under full throttle, its tail swung far out and two tire marks behind it that turn from grey to red](docs/screenshot.png)

## Play it online

**<https://isghe.github.io/openslotcars/>**

Hold `Space` (or the **Throttle** button on a touch screen) to accelerate and release it to brake. Too fast in a curve and the tail slides out; much too fast and the car leaves the track. Try to set the best lap time, on the oval or on one of the other circuits in the **Circuit** menu below the track. To open a circuit directly, add its name to the address, for example [`?circuit=chicane`](https://isghe.github.io/openslotcars/?circuit=chicane).

## The circuits

There are six circuits. The car runs on the lane named inner, and the length given is that of one lap. On the figure eight, each lane alternates between the inside and outside of the two lobes. Each picture shows the car in a slide, with its tire marks behind it.

### Oval

[![The oval seen from above, with the yellow car sliding out of the curve at the left end and its tire marks behind it](docs/circuit-oval.png)](https://isghe.github.io/openslotcars/?circuit=oval)

Two straights joined by two half circles: the plainest circuit, and the one the game opens on. A lap is 6.20 m long.

### Speedway

[![The speedway seen from above, with the yellow car sliding out of the bottom right corner and its tire marks behind it](docs/circuit-speedway.png)](https://isghe.github.io/openslotcars/?circuit=speedway)

A rounded rectangle: four corners instead of two half circles, and two short side straights. A lap is 8.20 m long.

### Chicane

[![The chicane seen from above, with the yellow car sliding in the S-bend and its tire marks behind it](docs/circuit-chicane.png)](https://isghe.github.io/openslotcars/?circuit=chicane)

A circuit driven clockwise. An S-bend of two tight curves on the first straight, then a half turn that starts wide and tightens, a long straight and a half turn that starts tight and widens. A lap is 10.74 m long.

### Teardrop

[![The teardrop seen from above, with the yellow car sliding out of the wide curve at the left end and its tire marks behind it](docs/circuit-teardrop.png)](https://isghe.github.io/openslotcars/?circuit=teardrop)

A wide curve at one end and a tight hairpin at the other, joined by two straights. A lap is 5.57 m long.

### Club

[![The L-shaped Club circuit seen from above, with the yellow car sliding in the top left corner and its tire marks behind it](docs/circuit-club.png)](https://isghe.github.io/openslotcars/?circuit=club)

The longest circuit. A rounded L driven clockwise, with a wide first curve, five right turns of different radii and a left turn in the inside corner. A lap is 12.36 m long.

### Infinite Loop

[![The horizontal figure eight seen from above, with the yellow car sliding around the right lobe and its tire marks behind it](docs/circuit-infinite-loop.png)](https://isghe.github.io/openslotcars/?circuit=infinite-loop)

A horizontal eight with two round lobes joined by diagonals crossing at ground level. The right lobe runs clockwise and the left counterclockwise; both lanes have the same length. A lap is 8.05 m long.

## Run it yourself, and how it works

See [TECHNICAL_DETAILS.md](TECHNICAL_DETAILS.md).

## License

Released under the [MIT License](LICENSE).
