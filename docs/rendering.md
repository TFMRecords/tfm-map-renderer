# Rendering

How the game draws a map, how this project's renderer (`renderTfmSvg`) reproduces it, what has been compared with the game, and
where the two still differ. The map format itself is in [`xml/`](xml/README.md).

## Draw order

The game stacks a map in these layers. Inside a layer, things are drawn in map order unless said otherwise.

<!-- BEGIN:draw-order -->
| Layer (bottom first) | Contents | Checked in the game |
|---|---|---|
| 1. background | the room colour, the map background `F`, the background images `D` (first), then in map order every decoration, hole and cheese that is not in the foreground; `ARPS` images when they appear | yes |
| 2. built-in objects | only used by the game's built-in maps; empty for XML maps | yes |
| 3. grounds | joint lines that are not in the foreground, every ground (with the galaxy strip behind its ground), then the foreground holes (`D` on `T`) | yes |
| 4. mice | the mice and the arrow (object 0); the renderer draws no mice | yes |
| 5. objects | shaman objects, the foreground cheese (`D` on `F`) | yes |
| 6. top | foreground joint lines, foreground `d` images (first), foreground grounds (`N`; types 9, 15, 21), foreground decorations, `APS` images, the soulmate heart | yes |
| 7. screen | the `Ca` frame, over everything and never mirrored | no |
<!-- END:draw-order -->

The renderer follows this order: room colour, background `F`, background `D` images, the background layer in map order,
`ARPS` and `IP` images (only on request), joints behind the grounds, grounds and foreground holes, objects and foreground cheese,
foreground joints, foreground `d` images, foreground grounds, foreground decorations, `APS` images, the soulmate heart (on
request), the `Ca` frame (on request). Verified in the game: a hole or cheese without `D` is hidden by a ground over it,
foreground holes are over the grounds, the top strip of a galaxy is behind the mice, and the layers of the images were checked
with `test/maps/images-1.xml` and `images-2.xml`.

The room colour is `#6A7495` (only Lua can change it; `backgroundColor` sets it, `null` for none).

## Grounds

- A textured ground is built from 40 x 40 tiles (`$T_n`); each type has its own recipe: a random interior tile per cell, edge
  tiles on the top row, corner tiles when the width is a multiple of 40. Tiles are cropped to their cell, never scaled.
- The game uses a pre-rendered 400 x 400 bitmap (100 x 100 under 20 px) instead of tiles for a dynamic ground, a ground over
  1400 px, and in slow mode or on mobile. A static ground drawn from tiles also gets the `$E_1` overlay (blend mode overlay)
  and, for types 0, 1, 2 and 4, a vector picture.
- Types 12 and 13 are plain colours (`o`, white without it), 14 is invisible, 16 and the undefined types are the plain plank
  `$Sol_Dur` stretched.
- `tint` applies a colour transform: each channel multiplied by the tint's channel / 128.
- The galaxy (21) has a strip along its top row, drawn behind the mice; it shows through the transparent top of the galaxy
  picture.
- In a mirrored room a ground's position is mirrored and its angle negated; its texture is not flipped. The game offsets the
  mirrored picture by `-ceil(width / 2)`, which is what flipping the whole picture gives.

The renderer reproduces all of this (`textures`, `textureSeed`, `pregeneratedBitmaps`); verified in the game with every type,
static and dynamic, tinted and mirrored.

## Pictures from the game

Holes, cheese, decorations, objects, backgrounds and ground tiles are pictures from the game's libraries. The asset tools
(`tfm-assets build`) extract them with FFDec into bundles (format: [`asset-bundle-format.md`](asset-bundle-format.md)); the renderer
draws them through a resolver. Without bundles it draws placeholders.

FFDec's SVG export is not exactly what Flash draws. The renderer puts back what it loses:

- **Colour transforms and blend modes of placed sprites.** FFDec drops blend modes that have no CSS name (`add`) and some colour
  transforms. The asset tools read the placements from the SWF and store them (`effects.json`); the renderer applies them as a
  colour-matrix filter and `mix-blend-mode`. FFDec already bakes a colour transform into the fills, except when the placement
  also has a blend mode; so for the decorations a transform is re-applied only where the placement has a blend mode, and for
  the other libraries to every gradient (rule found by comparison with the game). Lava and ice tiles, decorations and skinned
  objects then match.
- **Colours in instance names.** A part named `Couleur<n>_<hex>` of a skinned shaman object is drawn in that colour (each
  channel / 128). Decorations do not get it (their parts stay grey without `C`).
- **Seams.** Flash fills a tile's paths without seams; SVG anti-aliases each path, so hairlines appear. Tiles that cover their
  whole cell are backed by their first fill colour.
- **Flash blur.** A Flash blur or glow of size `b` and quality `q` is `q` box blurs of width `b`, not a Gaussian. The renderer
  replaces FFDec's Gaussian chains with box blurs (`flashBlur`, on by default); the hole glows, the Christmas tree lights and
  the poster match the game better this way.
- **Frames.** The renderer draws frame 1 of every picture, except the arrow (object 0), whose first frame is empty: it draws
  frame 12, as the editor shows it.
- **Two libraries define the same name.** The game resolves names in this order: game resources, shaman items, decorations,
  game graphics. The renderer's default order puts the game graphics first, because the game resources fetched during an event
  contained an event cheese; `loadRelease(dir, { precedence: "client" })` gives the game's order.

## What is verified

Maps in `test/maps/` were loaded in the game (as a `#Module` map, so unrestricted) and in the in-game editor, and compared with
the renderer's output, by eye and by measuring regions.

| Area | Maps | Result |
|---|---|---|
| Ground types, static and dynamic, tints | `static-*`, `dynamic-all-types`, `tints` | match |
| Shaman objects 0 to 97, angles, ghosts, skins | `objects-*` | match; the game shows only the types it creates |
| Holes, cheese, glows, `dodue`, `halloween` | `holes-cheese*` | match in the game; the editor draws the plain cheese and no glow |
| Decorations: colour parts, `C`, flips, foreground, blends, large backdrops | `decorations-*` | match in the game and the editor |
| Backgrounds `F` 0 to 11, stretched on a larger map | `backgrounds-*` | match in the game; the editor does not stretch |
| Minimalist mode | `minimalist-*` | match, except a 1 px outline the game draws around types 16 and 22 |
| Mirrored rooms: grounds, objects, decorations, images | `mirrored-*`, `images-1` | match |
| `D` and `d` images, repeats, the `d` offset bug; ground `i`, `APS`, `ARPS`, `IP` | `images-1`, `images-2` | match, mirrored and not, restricted and not |
| Spawn markers | `markers-1` | the game draws none; `spawnMarkers: "editor"` reproduces the editor |
| Nails | `nails-1`, `nails-2` | which nails show matches the game's rules |
| Joints | `joints-1` | match |
| Flash blur | `blur-flash`, `fridge`, `armchair` | box blur matches better than Gaussian |
| Number conversions, case, repeated attributes | `numeric-edge`, `tint-edge`, `number-*`, `lowercase`, `repeated-attribute` | as documented in [`xml/values.md`](xml/values.md) |

## Known differences

| Difference | Why |
|---|---|
| Random choices are fixed: ground tiles are seeded (`textureSeed`), a decoration with flip 2 is drawn unflipped (`randomDecorationFlip` for a seeded coin), background `-2` is a composite of its candidates (`compositeRandomBackground`), balloon 28 is the first balloon | the game picks at random |
| Physics is not simulated: dynamic grounds, balloons and bubbles stay at their start position, joints are drawn in their start state | a picture of the map |
| Every nail is drawn by default; `nailVisibility: "client"` applies the game's rules with boxes as bodies | whether a nail exists depends on the physics |
| Nested coloured parts (`GroupeCouleur`) are painted at the first level only; about 85% of nested sprites get their colour transform back, the others keep FFDec's | the asset tools patch the first level |
| A sprite with both filters and a blend mode keeps FFDec's blend | not handled |
| Flash blurs of even width use alternating centres | not compared with the game |
| Thickness-0 joint lines are 1 unit wide, so they scale with the picture (Flash keeps a hairline at 1 px) | SVG |
| Interactive decorations and animated pictures show their first frame | no playback |
| Particles (`<particles>`) and mice are not drawn | not implemented; the parser reads particles |
| Gradient highlights on some decorations show hairline seams at large zoom | anti-aliasing between a gradient and its base fill |
| Objects 5, 8, 9, 21 and 64 have no picture: a dashed placeholder in the editor mode, nothing in the game mode | not in the game's libraries |
| Placeholder ground colours (no bundles) are averages of a third-party editor's textures | not the game's art |
| Sharing one SVG per asset (`shareAssets`, the server's default) moves anti-aliased edge pixels slightly | speed |

## Renderer choices

Where the game and the editor differ, or the game is random, the renderer has an option. Defaults: the game's picture, except
for objects (`objectMode: "editor"` draws every object that has a picture; `"game"` draws only what the game creates), spawn
markers (debug circles; `"none"` for the game, `"editor"` for the editor's pictures), nails (all drawn), and the pictures the
game shows only later or on request (`renderAppearingImages`, `renderIpImages`, `renderTiledBackgrounds`, `renderSoulmateHeart`,
`renderHideOffscreenFrame`, all off). `clientLimits` applies the limits of [`xml/limits-and-modes.md`](xml/limits-and-modes.md);
`minimalist`, `mirrorX` and `cheeseSuffix` select the game modes.
