# Limits and modes

What limits the editor and the game put on a map, and the game modes that change how a map looks. None of this is applied by
the parser: the parser reports what the XML says, and the renderer takes limits and modes as options. The index is
[`README.md`](README.md).

## The editor

The in-game editor refuses to save a map containing any character outside this set:

<!-- BEGIN:editor-characters -->
`a-z`, `A-Z`, `0-9`, the space (no tab, no newline) and `< > " ' - _ . , : ; = / #`
<!-- END:editor-characters -->

`$` only occurs in old maps and admin tools. The game itself reads any text; the parser reports `editor-disallowed-characters`.
Consequences:

| Consequence | Why |
|---|---|
| no comments, CDATA, declarations or processing instructions | `!` and `?` are not allowed |
| no entities | `&` is not allowed, so values are always literal |
| an editor map is one line; only spaces separate tags | no newline or tab |
| absolute image URLs can be written, but never a query string | `:` `/` `.` `-` `_` `#` are allowed; `?` `&` `%` `+` are not |
| colours are written without `#` | how the game reads them |
| `D="#url,w,h"` backgrounds and `id="#rrggbb"` particles can be written | `#` is allowed |

The editor also draws only the first 40 shaman objects of a map, draws a map smaller than 800 x 400 at that size, and keeps a
ground's `L` and `H` at 10 or more.

## Map size

The default map is 800 x 400. The documented maximum, 1600 x 800 (4800 wide with `defilante`), is enforced only for restricted
maps; saved maps can be far larger. A renderer needs its own size cap (this project's renderer has `limits`, in pixels).

## Restricted maps

Some limits depend on how a map is opened, not on the room:

- an **official** map (author `Tigrounette`, `Transformice`, or a name starting with `_`) has no limits;
- a map whose author is `#Module` (loaded by a Lua module) has no limits, but no `ARPS` and a particle limit;
- an **ordinary** player map, including the editor's test mode, is restricted.

An admin switch of the editor also lifts the limits. Other map permissions may allow more; none is known.

<!-- BEGIN:limits-restricted -->
| What | Restricted map | Official map | `#Module` map |
|---|---|---|---|
| Map width `L` | at most 1600 (4800 with `defilante`) | no limit | no limit |
| Map height `H` | at most 800 | no limit | no limit |
| Grounds | the first 60 | all | all |
| Decoration-container children | the first 50 | all | all |
| Shaman objects | the first 40, and none after child index 200 | all | all |
| Tiled background `D="#url,w,h"` | ignored | drawn | drawn |
| Repeated `D` and `d` images | ignored | drawn | drawn |
| Ground image `i` | ignored | drawn | drawn |
| `APS`, `IP` | ignored | used | used |
| `ARPS` | ignored | used | ignored |
| Particles | at most 5 | no limit | at most 5 |
<!-- END:limits-restricted -->

These always apply:

<!-- BEGIN:limits-always -->
| What | Limit |
|---|---|
| Repeats of a `D` image | at most 20 |
| Repeats of a `d` image | no limit |
| Numbers in `DS="m;..."` | the first 40 (20 points) |
| Ground `L` and `H` | kept between 10 and 4000 |
| Particle `dur` | at most 10000 ms |
<!-- END:limits-always -->

Some clients load tiled `D` backgrounds in module maps and others do not. The renderer's `clientLimits` option has the presets
`restricted`, `module` and `unrestricted` (the default) and accepts custom values for every limit above.

## Mirrored rooms

The server opens a map mirrored (usually at random; Lua can ask for it). The game then mirrors positions around the map width
`L` and negates angles, wind, the `Mv` of objects and joint axes. Pictures are **not** flipped, except decorations (by their
flip code) and images: holes, cheese, grounds (their texture too) and shaman objects keep their orientation. The clockwise and
anticlockwise nails trade places. Verified in the game with maps of grounds, objects, decorations and images.

## Minimalist mode

A player option. Grounds of types 0 to 15 and 17 to 21 are drawn as flat colours ([`grounds.md`](grounds.md)), types 16 and
above 21 keep their picture, there is no background `F` and no `D` image, and of the decorations only 89, 90 and 131 are drawn.
It is off in the tutorial and in defilante maps. Verified in the game.

## Events

While an event runs, the game can change pictures at run time: the cheese gets an event suffix ([`decorations.md`](decorations.md)),
and some pictures in the game's libraries may be event versions. The normal game has none of this.

## Things that only exist at run time

The map cannot describe these, so a picture of a map shows them in a fixed state: the random choices of the game (decoration
flip 2, background `-2`, balloon 28, ground texture tiles), the physics (dynamic grounds, balloons and bubbles move, nails
appear or not), mice, and the images that `ARPS` and `IP` show later.
