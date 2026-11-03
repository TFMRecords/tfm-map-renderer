# Lua modules

Some Lua modules (room scripts) read attributes of their own from the map XML. The game ignores these attributes; the module
reads the map text itself when a map starts. The parser decodes each supported module's conventions into
`map.modules.<name>` for every map, whether or not the map is one of that module's maps (each entry says whether it looks like
one), and the renderer can draw what they mean ([`../api/renderer.md`](../api/renderer.md#modules)). The attributes are listed
with status `extension` in the tables of [`objects.md`](objects.md) and [`decorations.md`](decorations.md).

| Module | Source | `map.modules` |
|---|---|---|
| parkour | [a801-luadev/parkour](https://github.com/a801-luadev/parkour), `modes/parkour/maps.lua` | `parkour` |

## parkour

Parkour maps are races through checkpoints. The module reads the map like this (verified against its source; the third-party
editor [Miceditor](https://github.com/entibo/miceditor) shows the same checkpoints):

1. **Checkpoint 1** is the first mouse spawn `DS`. It may carry `size` (the mouse's size at the start, default 1) and
   `cheese`.
2. **Then every yellow nail**, `<O C="22" …/>`, in map order. Only elements named `O` count, and `C` must be 22 as a number
   (`22`, ` 22 `, `0x16`; not a skin such as `2201`). Each may carry `size`, `cheese` and `stop`.
3. **The last checkpoint is the end chair**: the first decoration `<P T="19" C="329cd2" …/>`, read 40 px above the chair, size 1.
   `C` must be exactly `329cd2`: one colour, lower case. (Miceditor compares only the first colour, ignoring case.)

The module reads attribute values with Lua's `tonumber` (decimal or `0x` hex, surrounding spaces allowed) and keeps a value that
is not a number as text; for a repeated attribute the last one wins.

| Attribute | On | Effect |
|---|---|---|
| `size` | `DS`, nails | The mouse's size from that checkpoint on. Not a number, or absent: the size of the previous checkpoint (the spawn's is 1). The `smol` mode of the module halves every size at run time. |
| `cheese` | `DS`, nails | `0` (also `0.0`) takes the cheese away at that checkpoint, any other value, even an empty one, gives it. |
| `stop` | nails | Written at all (any value): the mouse is stopped at that checkpoint (it is respawned there, losing its speed). |

The module rejects a map with a hole (`T`) or without a mouse spawn; unless the map's author is `#Module`, also one without the
chair or without a nail. The parser reports these as `problems`: `hole`, `no-mouse-spawn`, `no-chair`, `no-checkpoint` (the
author is not part of the XML, so the last two are always reported). In a mirrored room the module mirrors every checkpoint's x.

`map.modules.parkour`:

| Field | Meaning |
|---|---|
| `detected` | the map has the end chair: it is a parkour map. The renderer draws the checkpoints when this is true |
| `valid` | `problems` is empty |
| `problems` | see above |
| `chair` | `{decorationIndex, x, y, foreground}` of the end chair, or `null` (`foreground`: the first field of its `P` is `1`) |
| `checkpoints[]` | in order: `number` (1 is the spawn; nails are numbered from 2 even when the spawn is missing), `kind` (`spawn`, `nail`, `chair`), `decorationIndex` or `objectIndex`, `x`, `y`, `size` (after inheritance), `sizeAttribute` (the number written, or `null`), `stop`, `cheese` (`give`, `remove` or `null`) |

Miceditor treats a map as parkour only when it is also 1600 x 800, has no `defilante` and no hole; the parser does not, since
parkour maps of other sizes exist and the module itself checks only what is listed above.
