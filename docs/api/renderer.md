# Renderer API

`renderTfmSvg(map, options)` turns a parsed map into an SVG string. It is deterministic, has no dependencies and fetches
nothing: images come from an asset resolver, usually the one of an asset release.

```js
import { parseTfmMap, renderTfmSvg } from "tfm-map-renderer";
import { loadRelease } from "tfm-map-renderer/node";

const { resolver } = await loadRelease(".assets/release");   // see assets.md
const svg = renderTfmSvg(parseTfmMap(xml), {
  assetResolver: resolver,
  viewport: { x: 0, y: 0, width: 800, height: 400 },
  scale: 2,
});
```

With a release it draws the game's picture: textured grounds, decorations, shaman objects and their skins, holes and cheese,
backgrounds, joints, the map images, mirrored rooms. Without one it draws placeholders (below). How the game stacks a map, what
was compared with the game and where the renderer still differs are in [`../rendering.md`](../rendering.md).

## Parser and renderer

The parser returns what the XML says ([`parser.md`](parser.md)); every decision about how the game would show it is a renderer
option: map size defaults when `L`/`H` are absent, viewport and scale, camera rotation, mirroring, the client limits of a
restricted map, which pictures appear only at run time, placeholders. The parsed map is never modified.

## Options

Defaults in brackets. The server accepts the same names (except the callbacks and the resolver), and a test keeps this table
and the server's list in step.

| Option | Meaning |
|---|---|
| `assetResolver` | where pictures come from (`loadRelease(dir).resolver`); none: placeholders |
| `defaultAssets` [true] | `false` draws only what the resolver supplies (no placeholders, no room colour) |
| `viewport` {x, y, width, height} | the part of the map to draw (default: the whole map) |
| `scale` [1] | output pixels per map unit |
| `rotation` [0] | camera rotation in degrees, around the viewport centre |
| `mirrorX` [false] | a mirrored room ([`limits-and-modes.md`](../xml/limits-and-modes.md#mirrored-rooms)) |
| `borders` ["none"] | `"map"` or `"all"`: a map outline |
| `limits` | the largest output in pixels (default 16384 x 16384; `{ maxWidth, maxHeight }`, or `false` for none); a `RangeError` beyond it |
| `maxViewport` | `{ width, height }` in map units: a larger viewport (or map) is cut down to it from its top-left corner instead of failing |
| `clientLimits` ["unrestricted"], `restricted` | what the game would cut or switch off (below) |
| `backgroundColor` ["#6a7495"] | the room colour behind everything; `null`, `"none"` or `"transparent"` for none |
| `minimalist` [false] | the game's minimalist mode ([`limits-and-modes.md`](../xml/limits-and-modes.md#minimalist-mode)) |
| `textures` [true] | ground textures from the release; `false` draws flat placeholders |
| `textureSeed` [1] | seed of the random tile and coin choices, so renders are reproducible |
| `pregeneratedBitmaps` [false] | draw static grounds the way the game does in slow mode or on mobile ([`../rendering.md`](../rendering.md#grounds)) |
| `objectMode` ["editor"] | `"editor"` draws every object that has a picture; `"game"` only what the game creates |
| `nailVisibility` ["all"] | `"client"` applies the game's rules for which nails show ([`objects.md`](../xml/objects.md#nails)) |
| `objectPlaceholders` [true] | a dashed placeholder for objects without a picture (editor mode) |
| `spawnMarkers` ["circles"] | `"circles"`, `"editor"` (the editor's spawn pictures) or `"none"` (the game) |
| `debugMarkers` [false] | outlines at every decoration and object position |
| `cheeseSuffix` [""] | an event suffix for the cheese picture ([`decorations.md`](../xml/decorations.md#holes-and-cheese)) |
| `flashBlur` [true] | Flash's box blurs for the hole glows; `false` uses a Gaussian blur |
| `compositeRandomBackground` [true] | `F="-2"` drawn as a strip of each candidate background; `false` picks one |
| `randomBackgroundIndex` | which candidate `F="-2"` picks when not composite |
| `randomDecorationFlip` [false] | decorations with flip code 2 flip by a seeded coin instead of staying unflipped |
| `renderJoints` [true] | joints that have a style `c` |
| `renderAppearingImages` [false] | `ARPS` images, as if shown |
| `renderIpImages` [false] | `IP` images, as if shown (alias `renderPortalImages`) |
| `renderTiledBackgrounds` [false] | tiled `D="#url,w,h"` backgrounds (external images) |
| `renderSoulmateHeart` [false] | the heart of `A` maps |
| `renderHideOffscreenFrame` [false] | the frame of `Ca` maps around the 800 x 600 play area |
| `modules` [{ parkour: "auto" }] | overlays of Lua modules (below); `false` hides them all |
| `parkourNails` [true] | the parkour overlay draws each checkpoint's nail again over its mouse |
| `parkourStyle` | look of the parkour overlay ([below](#modules)) |
| `resolveDecorationAsset`, `resolveObjectAsset` | callbacks that supply decoration or object pictures directly |

Server-only request fields are in [`http.md`](http.md).

## Modules

Maps made for a Lua module carry attributes the game ignores ([`../xml/modules.md`](../xml/modules.md)). The renderer draws what
they mean as an overlay above the map. `modules` sets each module to `"auto"` (the default: drawn when the parser detected one of
the module's maps), `true` (always) or `false` (never); `modules: false` turns them all off.

| Module | Detected by | Overlay |
|---|---|---|
| `parkour` | the end chair (decoration 19 coloured `329cd2`) | at every checkpoint: its number above it; a mouse at every nail (the editor's spawn picture) with the nail drawn again over it, turned as in the map (as in Miceditor; `parkourNails: false` leaves it out); when the size is not 1, a dotted circle of radius 16 x `size` and an `x2`-style label at the corner; a small cheese above the mouse for `cheese`, crossed out in red when the checkpoint takes it away; a blue tint on the mouse for `stop`. The spawn gets the annotations only (the spawn marker is the mouse); the chair is drawn by the map |

`parkourStyle` changes the look of the overlay; unset fields keep their defaults:

```js
parkourStyle: {
  stopColor: "#ff3300", // tint of a `stop` checkpoint's mouse ("#rgb" or "#rrggbb"); null (default) is the blue above
  stopAmount: 0.6,      // 0 to 1: how far the mouse is mixed towards stopColor
  number: { height: 9, color: "#ffffff", outline: "#1b1f2b" }, // the checkpoint number; height in map pixels, 1 to 100
  size: { height: 7, color: "#ffffff", outline: "#1b1f2b" },   // the x2-style size label
}
```

A taller number grows upwards and a taller size label downwards, away from the mouse.

Numbers and labels are drawn as paths, not text, so they look the same in every rasteriser. In a mirrored room the checkpoints
move with the map but their labels stay readable.

## Client limits

What the game cuts or switches off depends on how a map is loaded ([`limits-and-modes.md`](../xml/limits-and-modes.md#restricted-maps)).
`clientLimits` takes a preset or an object:

- `"unrestricted"` (default): everything the XML says. Lua maps without limits and the editor's admin mode get this.
- `"restricted"`: an ordinary player map. Width 1600 (4800 with `defilante`), height 800, the first 60 grounds, the first 50
  decoration nodes, 40 shaman objects (reading stops at child 200); ground `i`, `APS`, `ARPS`, `IP`, tiled `D` and the `D`/`d`
  repeat copies are off.
- `"module"`: a `#Module` map. No caps and the gated pictures on, except `ARPS`.
- `{ preset: "restricted", maxGrounds: 200, maxWidth: null }`: a preset with changes. Keys: `restricted` and `arps` (booleans),
  `maxWidth`, `maxWidthDefilante`, `maxHeight`, `maxGrounds`, `maxDecorations`, `maxObjects`, `maxObjectIndex` (a number, or
  `null` for no cap).

`restricted: true` is short for `clientLimits: "restricted"`. `applyClientLimits(map, limits)` returns the cut copy without
rendering. Not to be confused with `limits`, the output size.

## Size limits

The game puts no limit on a map loaded from XML (saved maps 50000 and more pixels wide exist), so the renderer refuses an output
(viewport times scale) above `limits` with a `RangeError`. A viewport or a smaller scale renders part of a huge map.

`maxViewport` is the soft form: the viewport (the whole map when none is given) is cut down to `{ width, height }` from its
top-left corner, so a huge map renders its first part instead of failing. `renderedViewport(map, options)` returns the part
that would be drawn, with `cropped: true` when it was cut. Whatever lies outside the viewport is left out of the SVG
([`../rendering.md`](../rendering.md#culling)), so a small part of a huge map is as cheap as a small map.

## Placeholders

Without a resolver, or for a picture the resolver does not have, the renderer draws stand-ins: grounds as plain shapes in a
colour per type (the averages of a third-party editor's textures, not the game's art; rectangle and circle grounds use their `o`
colour), and simple marks for spawns, holes and cheese. `defaultAssets: false` turns them off.

## Comparing with a game screenshot

```sh
npm run compare -- --xml MAP.xml --shot GAME.png --release .assets/release [--mirror] [--out DIR]
```

renders the map, rasterises it, finds where it sits in the screenshot (a crop of the game window; the flat room colour is
ignored) and prints the error overall and per ground, decoration, hole, cheese and object (RMSE from 0 to 255: anti-aliasing and
the game's random tiles give 3 to 10, a flipped or misplaced element 20 or more). `--out` writes `ours.png`, `shot-aligned.png`
and `diff.png`. The header of `tools/compare-screenshot.mjs` lists every option; [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)
describes how screenshots are taken.
