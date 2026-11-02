# Asset bundle format

The format of an asset release, as written by `tfm-assets build` and read by `loadRelease`
([`api/assets.md`](api/assets.md)). Anyone can build compatible releases from the game's SWF files with this description.
Everything is deterministic: no timestamps or absolute paths, sorted keys, so the same SWF, FFDec and extractor versions give
the same bytes.

## Release directory

```text
release.json             index (below)
effects.json             colour transforms and blend modes per bundle
game-resources.tar.gz    one bundle per source
game-fla.tar.gz
pictos.tar.gz
shaman-items.tar.gz
```

`release.json`:

```json
{
  "format": "tfm-assets-release",
  "version": 1,
  "ffdec": "26.3.0",
  "bundles": [
    { "name": "game-resources", "file": "game-resources.tar.gz", "sha256": "…", "bytes": 1562278,
      "purpose": "grounds ($T_n tiles, $Sol_*), backgrounds ($F_n), cheese, holes, joints",
      "assets": 499, "symbols": 499, "warnings": 0 }
  ]
}
```

| Field | Meaning |
|---|---|
| `format` | always `tfm-assets-release` |
| `version` | the format version, see "Versions" |
| `ffdec` | the FFDec version that extracted the pictures |
| `bundles[]` | `name`, archive `file` (next to `release.json`), its `sha256` and size in `bytes` (checked when loading), a `purpose` text, and the number of `assets`, `symbols` and extractor `warnings` |

Bundle names the renderer knows: `game-resources`, `game-fla`, `pictos`, `shaman-items`. Character ids repeat across SWFs, which
is why each source is its own bundle.

## Bundle

A `.tar.gz` (a `.zip` loads too; a single top-level folder inside it is stripped) with:

```text
manifest.json
svg/shapes/<id>.svg            a shape
svg/sprites/<id>.svg           a sprite, frame 1
svg/sprites/<id>_f<n>.svg      frame n, where more frames are exported
images/<id>.<png|jpg|gif>      a bitmap
```

The SVG files are FFDec's export, normalised: ids prefixed so they cannot collide when several pictures share a document, and
the size and origin moved into the manifest.

`manifest.json`:

```json
{
  "format": "tfm-assets",
  "version": 1,
  "source": {
    "swf": { "name": "pictos.swf", "sha256": "…", "size": 554835, "swfVersion": 10,
             "stage": { "x": 0, "y": 0, "width": 800, "height": 400 }, "compression": "zlib" },
    "ffdec": { "version": "26.3.0" },
    "extractor": { "version": "0.1.0" }
  },
  "assets": {
    "2": { "id": 2, "kind": "sprite", "names": ["$P_306"],
           "frames": [{ "file": "svg/sprites/2.svg", "width": 75.85, "height": 40.6, "origin": { "x": 38.2, "y": 31.4 } }] }
  },
  "symbols": { "$P_306": 2 },
  "bindings": {},
  "warnings": []
}
```

| Field | Meaning |
|---|---|
| `source` | the SWF the bundle was extracted from, and the tool versions |
| `assets` | by character id (as a string, which must equal `id`). `kind` is `shape`, `sprite` or `image`. Shapes and sprites have `frames` (at least one): the SVG `file`, its `width` and `height`, and the `origin`, the position of the registration point inside the SVG. Images have `file`, `width` and `height` |
| `symbols` | symbol name to character id; every id must exist in `assets` |
| `bindings` | reserved for reviewed feature-to-symbol mappings; empty |
| `warnings` | extractor warnings, sorted; `duplicate-symbol-name:<name>` when two ids claim one name |

A picture is placed with its registration point at the map position: the renderer draws the SVG at `(x - origin.x, y - origin.y)`.

## `effects.json`

FFDec's SVG export draws the sprites a sprite places but drops their colour transforms and the blend modes that have no CSS
name. `effects.json` keeps them, read straight from the SWF's PlaceObject tags:

```json
{ "game-resources": { "$Sol_Rebond": [ { "cx": null, "blend": null },
                                       { "cx": { "mul": [1, 1, 1, 0.28125], "add": [0, 0, 0, 0] }, "blend": 8 } ], … }, … }
```

Per bundle and symbol, only for sprites that need it: the first-frame placements in depth order. `cx` is a colour transform
(multipliers and offsets for red, green, blue, alpha) or `null`; `blend` is the Flash blend-mode number or `null`. An entry can
also be `{ "top": [...], "kinds": "...", "nested": { "sprite0": { "rows": [...], "kinds": "..." } } }` when sprites nested inside
need corrections too (`kinds` lists the placed children: `s` sprite, `h` shape, `o` other, so a mismatch can be detected). A row
may carry `name` (a `Couleur<n>` part a decoration's `C` colours) or `nm: true` (the colour comes from the instance name). The
renderer matches rows to the placed elements in order and applies nothing when the counts disagree.

## Versions

`version` in `release.json` and in each `manifest.json` is 1. A change that an older reader would misread raises it, and
`loadRelease` refuses a release whose version it does not know, with a message naming both versions. Adding optional fields
does not raise it.
