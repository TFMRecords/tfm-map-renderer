# Decorations `D`

Children of the second zone container, conventionally `<D>`. Here the tag of each child matters. The index is
[`README.md`](README.md); conversions are in [`values.md`](values.md).

<!-- BEGIN:decoration-tags -->
| Tag | Role (`role`) | Attributes read | Picture |
|---|---|---|---|
| `T` | `hole` | `X`, `Y`, `D`, `CT` | `$Trou_Souris` |
| `F` | `cheese` | `X`, `Y`, `D` | `$Fromage` (see below) |
| `DS` | `mouse-spawn` | `X`, `Y` | none in the game |
| `DC` | `shaman-spawn` | `X`, `Y` | none in the game |
| `DC2` | `dual-shaman-spawn` | `X`, `Y` | none in the game |
| `P` | `decoration` | `X`, `Y`, `T`, `P`, `C` | `$P_<T>` |
| any other | none | `X`, `Y` | none |
<!-- END:decoration-tags -->

`DS`, `DC` and `DC2` set spawn points; they are not decorations in the game's decoration list and the game draws nothing for
them (the in-game editor draws a mouse and a shaman). Tags are case-sensitive: `<t>` is not a hole.

## Attributes

<!-- BEGIN:attrs-decoration -->
| Attribute | Tags | Read as | Meaning | Status |
|---|---|---|---|---|
| <a id="attr-D-any-X"></a>`X` | any | `int`. Absent: 0. | Horizontal position. | verified |
| <a id="attr-D-any-Y"></a>`Y` | any | `int`. Absent: 0. | Vertical position. | verified |
| <a id="attr-D-T-D"></a>`D` | `T`, `F` | `presence`. Absent: false. | Draws a hole over the grounds, or a cheese over the mice. | verified |
| <a id="attr-D-T-CT"></a>`CT` | `T` | `int`: 1 and 2 are colours, anything else is none. Absent: 0. | Hole colour: 1 gives the hole a cyan glow, 2 a pink one. Which mice may enter is decided by the server. | verified |
| <a id="attr-D-P-T"></a>`T` | `P` | `int`. Absent: 0. | Decoration id: the picture `$P_<T>`. | verified |
| <a id="attr-D-P-P"></a>`P` | `P` | Required: a `P` decoration without it makes the map fail to load. Split on `,`: field 1 is `one` (foreground); field 2 `int`: 1 always flipped, 2 flipped at random (one time in two), anything else not flipped. In a mirrored room the code becomes 0 when it is above 0, otherwise 1. Absent: required. | Foreground flag and horizontal flip. | **unverified**: The random flip follows the game's code; being random, it cannot be compared with the game. |
| <a id="attr-D-P-C"></a>`C` | `P` | `truthy`, split on `,`. Absent: none. | Hex colours of the decoration's colourable parts, in order. A part with no colour in the list is black; without the attribute the parts keep their library colour. | verified |
<!-- END:attrs-decoration -->

## Parser fields

<!-- BEGIN:fields-decoration -->
| Spec id | Type | Parser field | Examples (checked by the tests) |
|---|---|---|---|
| `D/*.X` | `int` | `decorations[].x` | `X="5.9"` -> `decorations[0].x = 5` |
| `D/*.Y` | `int` | `decorations[].y` | `Y="-3"` -> `decorations[0].y = -3` |
| `D/T.D` | `bool` | `decorations[].foreground` | `D=""` -> `decorations[0].foreground = true` |
| `D/T.CT` | `int` | `decorations[].holeColor` (alias holeType) | `CT="2"` -> `decorations[0].holeColor = 2`; `CT="1"` -> `decorations[0].holeColor = 1` |
| `D/P.T` | `int` | `decorations[].type` | `T="42.5" P="0,0"` -> `decorations[0].type = 42` |
| `D/P.P` | `list<int>` | `decorations[].foreground`, `decorations[].inversionCode`, `decorations[].reverse` | `T="1" P="1,2"` -> `decorations[0].reverse = "random"` |
| `D/P.C` | `list<string>` | `decorations[].colors` | `T="1" P="0,0" C="ABCDEF,123456"` -> `decorations[0].colors = ["ABCDEF","123456"]` |
<!-- END:fields-decoration -->

## Holes and cheese

A hole `T` is drawn with `$Trou_Souris`, a cheese `F` with `$Fromage`. Both are placed at (`X`, `Y`). Without `D` they sit in the
background layer, so a ground drawn over them hides them; with `D` a hole is drawn over the grounds and a cheese over the mice
([`../rendering.md`](../rendering.md)).

`CT` gives a hole a glow (Flash glow: blur 5 x 5, strength 3, quality 3), verified in the game. The in-game editor draws no glow.

<!-- BEGIN:hole-glows -->
| `CT` | Glow colour |
|---|---|
| 1 | `#98E2EB` |
| 2 | `#FEB1FC` |
<!-- END:hole-glows -->

The cheese picture is `$Fromage` + an event suffix + the theme, or `$FromageDodue` + the theme when the settings carry `dodue`.
The game looks the name up and draws an **empty** picture when no library defines it, so `theme="halloween"` without `dodue`
draws no cheese at all, and with `dodue` a pile of candy (both verified in the game; the editor draws the plain cheese). The
event suffix is empty in the normal game; events set it while they run. Suffixed cheese pictures exist for:

<!-- BEGIN:cheese-suffixes -->
`Cahier`, `Citrouille`, `Epice`, `Glace`, `Herbe`, `Nounours`, `Or`, `PasFrais`, `Saumon`
<!-- END:cheese-suffixes -->

No attribute hides a hole.

## Decorations `P`

A decoration `P` is drawn with `$P_<T>`, its registration point at (`X`, `Y`), first frame. `P` is required: without it the map
fails to load.

- **Flip.** The second field of `P`: 1 flips the picture horizontally, 2 flips it at random (one time in two, decided when
  the map is drawn), anything else not. A mirrored room swaps flipped and unflipped.
- **Layer.** The first field of `P` set to 1 draws the decoration in the top layer, over the grounds, mice and objects;
  otherwise it is in the background layer, in map order with the holes and cheese.
- **Colours.** `C` paints the decoration's colourable parts (children named `Couleur<n>...`) in order with the given hex
  colours. A part beyond the end of the list is painted black. Without `C` those parts keep the colour they have in the game's
  library (grey for furniture); the colour written in the part's name is **not** applied. Verified in the game.

<!-- BEGIN:decoration-lists -->
| List | Decoration ids |
|---|---|
| Still drawn in minimalist mode | `89`, `90`, `131` |
| Interactive (live clips) | `15`, `16`, `17`, `19`, `25`, `67`, `68`, `89`, `90`, `104`, `105`, `131`, `158`, `166`, `167` |
| Always behind everything in the editor (not in the game) | `34`, `117` |
<!-- END:decoration-lists -->

## Other children

Any other tag is kept with its position and has no effect. Real maps contain some (spawn markers of editors, leftovers); the
parser keeps them with their tag in `kind`.
