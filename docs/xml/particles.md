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
| <a id="attr-particles-any-id"></a>`id` | Empty or absent: the particle is not created. `#rrggbb`: a coloured particle (`hex`); otherwise `int`, an index into the game's particle list. Absent: none (no particle). | Particle effect. | verified |
| <a id="attr-particles-any-img"></a>`img` | Whenever the attribute is present: an image URL (see images). Absent: none. | Image of the particle, centred on its origin. | verified |
| <a id="attr-particles-any-dur"></a>`dur` | `int` (absent gives 0), then at most 10000. Absent: 0. | Duration in milliseconds. | verified |
| <a id="attr-particles-any-int"></a>`int` | `int` (absent gives 0). Absent: 0. | Interval between emissions in milliseconds. | verified |
| <a id="attr-particles-any-loop"></a>`loop` | `one`. Absent: false. | Repeats the effect. | verified |
| <a id="attr-particles-any-ori"></a>`ori` | `truthy`. Split on `,`: two `int` fields. Absent: none. | Orientation (x,y). | verified |
| <a id="attr-particles-any-sp"></a>`sp` | `truthy`. Split on `;` into two groups of `number` pairs; a pair with one number uses it twice. The game decides whether a group exists from the length of the whole value, not from the number of groups: a value of two characters or more without `;` makes the map fail to load. Absent: none. | Speed: two (x,y) pairs. | **unverified**: The load failure follows the game's code; no map with particles has been checked in the game. |
| <a id="attr-particles-any-acc"></a>`acc` | Like `sp`. Absent: none. | Acceleration: two (x,y) pairs. | **unverified**: The load failure follows the game's code; no map with particles has been checked in the game. |
<!-- END:attrs-particle -->

## Parser fields

<!-- BEGIN:fields-particle -->
| Spec id | Type | Parser field | Examples (checked by the tests) |
|---|---|---|---|
| `particles/*.id` | `custom` | `particles[].id`, `particles[].idValue`, `particles[].idIsHex`, `particles[].clientCreated` | `id="#ff"` -> `particles[0].idValue = 255`; `id="7.9"` -> `particles[0].idValue = 7`; `id=""` -> `particles[0].clientCreated = false`; `id="3"` -> `particles[0].clientCreated = true` |
| `particles/*.img` | `string` | `particles[].image` | `img="x.png"` -> `particles[0].image = "x.png"` |
| `particles/*.dur` | `int` | `particles[].duration`, `particles[].derived.duration` | `dur="12000"` -> `particles[0].duration = 12000`; `dur="12000"` -> `particles[0].derived.duration = 10000`; `dur="500"` -> `particles[0].derived.duration = 500`; `dur="-5"` -> `particles[0].derived.duration = -5` |
| `particles/*.int` | `int` | `particles[].interval` | `int="150.5"` -> `particles[0].interval = 150` |
| `particles/*.loop` | `bool` | `particles[].loop` | `loop="1"` -> `particles[0].loop = true` |
| `particles/*.ori` | `point` | `particles[].orientation` | `ori="3,4"` -> `particles[0].orientation.y = 4` |
| `particles/*.sp` | `custom` | `particles[].speed` | `sp="1,2;3"` -> `particles[0].speed.second.second = 3`; `sp="1,2"` -> `particles[0].speed.secondGroupMissing = true`; `sp="5"` -> `particles[0].speed.secondGroupMissing = false`; `sp="1,2;3,4"` -> `particles[0].speed.secondGroupMissing = false` |
| `particles/*.acc` | `custom` | `particles[].acceleration` | `acc="5;6"` -> `particles[0].acceleration.first.second = 5`; `acc="5,1"` -> `particles[0].acceleration.secondGroupMissing = true` |
<!-- END:fields-particle -->

## Notes

- **No id, no particle.** An empty or absent `id` skips the particle entirely, even with `img`.
- **Defaults are overwritten.** An absent `dur` or `int` gives 0, not a default duration or interval.
- **Coloured particles.** `id="#rrggbb"` uses the colourable particle picture with each channel multiplied by the colour's
  channel / 128, like a ground `tint`. A decimal id selects one of the game's particle effects, which are found at run time.
- **`sp` and `acc`.** The game decides whether the first and second groups exist from the length of the whole value: the
  first for any non-empty value, the second when the value is two characters or longer. A value such as `sp="1,2"` therefore
  makes the map fail to load (`particle-group-missing`), while `sp="5"` does not.
- **Limit.** A restricted map gets at most 5 particles ([`limits-and-modes.md`](limits-and-modes.md)).

No map with particles has been checked in the game. The renderer does not draw particles.
