# Particles

Children of a zone child named `particles`; when there are several, the last one is used. The tag of a particle is not read.
The index is [`README.md`](README.md); conversions are in [`values.md`](values.md).

```xml
<particles><p id="#ff8800" dur="2000" int="200" loop="1" ori="0,1" sp="1,2;3,4" acc="0,0.1;0,0.1"/></particles>
```

## Attributes

<!-- BEGIN:attrs-particle -->
| Attribute | Read as | Meaning | Status |
|---|---|---|---|
| <a id="attr-particles-any-id"></a>`id` | Empty or absent: the particle is not created (`img` alone is not enough). `#rrggbb`: the colourable particle picture in that colour (`hex`); otherwise `int`, an index into the game's particle list. Absent: none (no particle). | The picture of the particles. | verified |
| <a id="attr-particles-any-img"></a>`img` | Used only on maps without the limits of restricted maps (official and `#Module` maps), and only when `id` is not empty; there it replaces the picture of `id`. An image URL (see images), centred on the particle. The emitter waits until the image has loaded. Absent: none. | An image as the picture of the particles. | verified |
| <a id="attr-particles-any-dur"></a>`dur` | `int` (absent gives 0), then at most 10000. Absent: 0. | How long each particle lives, in milliseconds (not how long the emitter runs). | verified |
| <a id="attr-particles-any-int"></a>`int` | `int` (absent gives 0). Absent: 0. | Time between two emissions, in milliseconds; one particle per emission. 0 emits every frame. | verified |
| <a id="attr-particles-any-loop"></a>`loop` | `one`. Absent: false. | Passed to every particle the emitter creates; most likely the particle's picture repeats its animation. | **unverified**: The code that uses the flag is not known; the emitter itself never stops either way. |
| <a id="attr-particles-any-ori"></a>`ori` | `truthy`. Split on `,`: two `int` fields, x and y. Absent: 0,0. | Where the particles start (the emitter's position). | verified |
| <a id="attr-particles-any-sp"></a>`sp` | `truthy`. `xFrom,xTo;yFrom,yTo`, each `number`; a group with one number uses it for both. The game decides whether the y group exists from the length of the whole value, not from the number of groups: a value of two characters or more without `;` makes the map fail to load. Absent: 0. | Speed of each particle when it is emitted: a random value between `from` and `to` on each axis, in pixels per frame. | **unverified**: The load failure follows the game's code; no map with particles has been checked in the game. |
| <a id="attr-particles-any-acc"></a>`acc` | Like `sp`. Absent: 0. | Acceleration of each particle: a random value between `from` and `to` on each axis, added to its speed every frame. | **unverified**: The load failure follows the game's code; no map with particles has been checked in the game. |
<!-- END:attrs-particle -->

## Parser fields

<!-- BEGIN:fields-particle -->
| Spec id | Type | Parser field | Examples (checked by the tests) |
|---|---|---|---|
| `particles/*.id` | `custom` | `particles[].id`, `particles[].idValue`, `particles[].idIsHex`, `particles[].clientCreated` | `id="#ff"` -> `particles[0].idValue = 255`; `id="7.9"` -> `particles[0].idValue = 7`; `id=""` -> `particles[0].clientCreated = false`; `id="3"` -> `particles[0].clientCreated = true` |
| `particles/*.img` | `string` | `particles[].image` | `id="1" img="x.png"` -> `particles[0].image = "x.png"` |
| `particles/*.dur` | `int` | `particles[].duration`, `particles[].derived.duration` | `dur="12000"` -> `particles[0].duration = 12000`; `dur="12000"` -> `particles[0].derived.duration = 10000`; `dur="500"` -> `particles[0].derived.duration = 500`; `dur="-5"` -> `particles[0].derived.duration = -5` |
| `particles/*.int` | `int` | `particles[].interval` | `int="150.5"` -> `particles[0].interval = 150` |
| `particles/*.loop` | `bool` | `particles[].loop` | `loop="1"` -> `particles[0].loop = true` |
| `particles/*.ori` | `point` | `particles[].position` (alias orientation), `particles[].derived.position` | `ori="3,4"` -> `particles[0].position.y = 4`; `ori="12.9,-3.2"` -> `particles[0].position.x = 12`; `ori="7"` -> `particles[0].derived.position = {"x":7,"y":0}`; `id="1"` -> `particles[0].derived.position = {"x":0,"y":0}` |
| `particles/*.sp` | `custom` | `particles[].speed`, `particles[].derived.speed` | `sp="1,2;3"` -> `particles[0].speed.y = {"from":3,"to":3}`; `sp="1.5,2.5;4,5"` -> `particles[0].speed.x = {"from":1.5,"to":2.5}`; `sp="1,2"` -> `particles[0].speed.secondGroupMissing = true`; `sp="5"` -> `particles[0].derived.speed = {"x":{"from":5,"to":5},"y":{"from":0,"to":0}}`; `sp="1,2;3,4"` -> `particles[0].speed.secondGroupMissing = false` |
| `particles/*.acc` | `custom` | `particles[].acceleration`, `particles[].derived.acceleration` | `acc="5;6"` -> `particles[0].acceleration.x = {"from":5,"to":5}`; `acc="5,1"` -> `particles[0].acceleration.secondGroupMissing = true` |
<!-- END:fields-particle -->

## How the game emits particles

Each element is an **emitter**. While the map runs, every frame, each emitter whose picture is ready checks the time:

1. When the time of its next emission has passed (at once for the first one), it emits **one** particle and sets the next
   emission `int` milliseconds later. With `int` 0 it emits every frame. An emitter never stops on its own.
2. The particle starts at `ori` (x, y): the position of the emitter in the map.
3. Its speed is a random value between the two numbers of the first `sp` group for x, and of the second group for y. Its
   acceleration is drawn the same way from `acc`.
4. Every frame its position grows by its speed and its speed by its acceleration (in pixels per frame, so the result depends
   on the frame rate).
5. It disappears `dur` milliseconds after it was emitted (at most 10000). With `dur` 0 it disappears at once.

The picture is decided when the map is read: `img` (official and `#Module` maps only, and only when `id` is not empty), else
the colourable particle in the colour of `id="#rrggbb"`, else entry `id` of the game's particle list. An emitter whose picture
is not available (an `img` still loading, an index outside the list) emits nothing. What `loop` changes is not known: it is
handed to every particle, and most likely makes the particle's picture repeat its animation.

The parser gives the values as written (`position`, `speed`, `acceleration`, each `null` when absent) and the values the game
emits with in `derived` (absent values are 0).

## Notes

- **No id, no particle.** An empty or absent `id` skips the particle entirely, even with `img`.
- **Defaults are overwritten.** An absent `dur` or `int` gives 0, not a default duration or interval.
- **Coloured particles.** `id="#rrggbb"` uses the colourable particle picture with each channel multiplied by the colour's
  channel / 128, like a ground `tint`. A decimal id selects one of the game's particle effects, which are found at run time.
- **`sp` and `acc`.** The game decides whether the first and second groups exist from the length of the whole value: the
  first for any non-empty value, the second when the value is two characters or longer. A value such as `sp="1,2"` therefore
  makes the map fail to load (`particle-group-missing`), while `sp="5"` does not.
- **Limit.** A restricted map gets at most 5 particles ([`limits-and-modes.md`](limits-and-modes.md)); emitters without a
  picture do not count.

How emitters behave is read from the game's code; no map with particles has been checked in the game. The renderer does not
draw particles.
