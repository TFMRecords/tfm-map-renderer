# Shaman objects `O`

Children of the third zone container, conventionally `<O><O .../></O>`. The element name of an object is not read; `C` is the
type. The index is [`README.md`](README.md); conversions are in [`values.md`](values.md).

## Attributes

<!-- BEGIN:attrs-object -->
| Attribute | Read as | Meaning | Status |
|---|---|---|---|
| <a id="attr-O-C"></a>`C` | `int`; the element's own name is not read. Above 99 the number packs a base type and a skin (see objects). Absent: 0. | Object type. | verified |
| <a id="attr-O-X"></a>`X` | `int`. Absent: 0. | Horizontal position. | verified |
| <a id="attr-O-Y"></a>`Y` | `int`. Absent: 0. | Vertical position. | verified |
| <a id="attr-O-nosync"></a>`nosync` | `presence`. Absent: false. | Disables room synchronisation of the object. | verified |
| <a id="attr-O-Mv"></a>`Mv` | `truthy`, then `number`. Negated in a mirrored room. Absent: none. | Rotation speed of a nail (11 to 16; positive turns anticlockwise). | verified |
| <a id="attr-O-Mp"></a>`Mp` | Read only when `Mv` is used: `number`. Absent: none. | Rotation power of a nail (11 to 16). | verified |
| <a id="attr-O-P"></a>`P` | `truthy`. Split on `,`: field 1 `int` is the angle in degrees, clockwise (negated in a mirrored room); with a second field, `1` makes the object a ghost. Absent: 0,0. | Angle and ghost flag. A ghost does not collide with mice and is drawn translucent. | verified |
| <a id="attr-O-stop"></a>`stop` | Not read by the game. The module: written at all (`presence`, any value), on a yellow nail (`C="22"`). Absent: false. | parkour: reaching this checkpoint stops the mouse (it is respawned there, without speed). | extension |
| <a id="attr-O-size"></a>`size` | Not read by the game. The module: Lua `tonumber` (decimal or `0x` hex); not a number or absent: the size of the previous checkpoint (the spawn's is 1). Absent: the previous checkpoint's size. | parkour: the mouse's size from this checkpoint on. | extension |
| <a id="attr-O-cheese"></a>`cheese` | Not read by the game. The module: `0` (as a Lua number, so also `0.0`) removes the cheese, any other value, even an empty one, gives it. Absent: none. | parkour: the mouse gets (`give`) or loses (`remove`) the cheese at this checkpoint. | extension |
<!-- END:attrs-object -->

## Parser fields

<!-- BEGIN:fields-object -->
| Spec id | Type | Parser field | Examples (checked by the tests) |
|---|---|---|---|
| `O.C` | `int` | `objects[].type`, `objects[].baseType`, `objects[].skin`, `objects[].clientFiltered` | `C="11.5"` -> `objects[0].type = 11`; `C="1002"` -> `objects[0].baseType = 10`; `C="1002"` -> `objects[0].skin = 2`; `C="10305"` -> `objects[0].baseType = 0`; `C="94"` -> `objects[0].clientFiltered = true`; `C="9401"` -> `objects[0].clientFiltered = true`; `C="2"` -> `objects[0].clientFiltered = false` |
| `O.X` | `int` | `objects[].x` | `X="9.9"` -> `objects[0].x = 9` |
| `O.Y` | `int` | `objects[].y` | `Y="8.1"` -> `objects[0].y = 8` |
| `O.nosync` | `bool` | `objects[].nosync` | `nosync=""` -> `objects[0].nosync = true` |
| `O.Mv` | `number` | `objects[].speed` | `Mv="2.5"` -> `objects[0].speed = 2.5` |
| `O.Mp` | `number` | `objects[].power` | `Mv="1" Mp="3.5"` -> `objects[0].power = 3.5` |
| `O.P` | `list<int>` | `objects[].rotation`, `objects[].ghost` | `P="45,1"` -> `objects[0].ghost = true` |
| `O.stop` | `bool` | `modules.parkour.checkpoints[].stop` | `C="22" stop=""` -> `modules.parkour.checkpoints[0].stop = true`; `C="22"` -> `modules.parkour.checkpoints[0].stop = false`; `C="1" stop=""` -> `modules.parkour.checkpoints = []` |
| `O.size` | `number` | `modules.parkour.checkpoints[].size`, `modules.parkour.checkpoints[].sizeAttribute` | `C="22" size="2.5"` -> `modules.parkour.checkpoints[0].size = 2.5`; `C="22" size="big"` -> `modules.parkour.checkpoints[0].size = 1`; `C="22" size="0x2"` -> `modules.parkour.checkpoints[0].sizeAttribute = 2` |
| `O.cheese` | `enum` | `modules.parkour.checkpoints[].cheese` | `C="22" cheese=""` -> `modules.parkour.checkpoints[0].cheese = "give"`; `C="22" cheese="0"` -> `modules.parkour.checkpoints[0].cheese = "remove"`; `C="22"` -> `modules.parkour.checkpoints[0].cheese = null` |
<!-- END:fields-object -->

## Type and skin `C`

`C` packs a base type and a skin:

| `C` | Base type | Skin |
|---|---|---|
| above 9999 | `int((C - 10000) / 10000)` | `(C - 10000) % 10000` |
| 100 to 9999 | `int(C / 100)` | `C % 100` |
| 0 to 99 | `C` | 0 |

So `C="1002"` is base 10 with skin 2. A skinned object is drawn with `$Objet_<C>` and the default colours in the names of its
colour parts; a player's own colours for a skin come from the server and cannot be drawn from the map.

## Which objects exist

<!-- BEGIN:object-lists -->
| List | Types |
|---|---|
| Created by the game | `0`, `1`, `2`, `3`, `4`, `6`, `7`, `10`, `17`, `23`, `28`, `32`, `33`, `34`, `35`, `39`, `40`, `45`, `46`, `54`, `57`, `59`, `60`, `61`, `62`, `63`, `65`, `67`, `68`, `69`, `80`, `89`, `90`, `95`, `97` |
| Never created (filtered) | `26`, `27`, `44`, `79`, `84`, `85`, `86`, `94`, `96` |
| Nails | `11`, `12`, `13`, `14`, `15`, `16`, `22`, `112`, `113` |
| Nails that attach to the world | `11`, `12`, `13`, `112`, `113` |
| Nails with a motor | `12`, `13`, `15`, `16`, `112`, `113` |
| No picture in the game | `5`, `8`, `9`, `21`, `64` |
| Defilante markers (raw `C` -> marker kind) | `6` -> 0, `15` -> 2, `16` -> 3, `32` -> 1 |
| Picture of `28` | a random one of `$Objet_28` to `$Objet_31` (balloons) |
| Picture of `54` | `$GlaconChamane` |
| Picture of `85` | `$Objet_Avalanche` |
| Picture of `96` | `$Cage` |
<!-- END:object-lists -->

The game drops every type it does not create; the in-game editor still draws any object it has a picture for. Filtered types
are checked after the defilante markers ([`settings.md`](settings.md)). Verified in the game with one map of every type.

The picture of an object is `$Objet_<C>` unless listed above, placed at (`X`, `Y`) and turned by the angle of `P` (degrees,
clockwise). Pictures are never flipped in a mirrored room: the position is mirrored and the angle negated.

## Ghosts

`P="angle,1"` makes an object a ghost: it does not collide with mice and is drawn with alpha halved and green and blue
raised by 40. For type 32 it is the other way round (the solid one gets that look). Verified in the game and the editor.

## Nails

Nails are not objects: when the map loads, the game joins the bodies (shaman objects and dynamic grounds) under the nail's
point. Grounds that are not dynamic are not bodies.

- Nails 11, 12, 13, 112 and 113 attach to the world: one body under the point is enough. The others need two.
- A nail with nothing to join is not created and not drawn.
- The nails 12, 13, 15 and 16 have a motor; at most 11 of their joints are made per map and the next ones are refused.
- `Mv` and `Mp` set the motor's speed and power.
- With the settings `mc` no nail picture is drawn during the first 5 seconds of a round, so the map's own nails are invisible
  (their joints still exist).
- A body shows the picture of one world nail only.
- 112 and 113 are drawn as the plain red nail in the game; the in-game editor draws them as a chest and a sack.
- In a mirrored room the clockwise and anticlockwise nails trade places (12 and 13, 112 and 113, 15 and 16).

Verified in the game with maps of nails on single and stacked boxes. Whether a nail shows depends on the physics, so this
project's renderer draws every nail by default.

## Attributes the game does not read

`stop` and `size` are read by the Lua module parkour, not by the game. Real maps also carry `cheese` and `kill` on objects, which
nothing reads.
