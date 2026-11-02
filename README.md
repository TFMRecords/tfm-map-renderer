# tfm-map-renderer

Parser, renderer and PNG render server for [Transformice](https://www.transformice.com) map XML. The target is the picture the
game itself draws.

- **Parser**: pure JavaScript, no dependencies, browser and Node. Returns what the XML says, with every attribute documented,
  keeps the source byte for byte for exact edits, and reports maps the game would refuse instead of throwing.
- **Renderer**: map to SVG with the game's own pictures (textured grounds, decorations, shaman objects and skins, holes and
  cheese, backgrounds, joints, map images, mirrored and minimalist modes, the limits of restricted maps). Deterministic, no
  network access.
- **Assets**: builds the pictures from the game's SWF files with FFDec, on your machine.
- **Server**: XML in, PNG out (resvg, no browser), with a test page.
- **XML reference**: [`docs/xml/`](docs/xml/README.md) describes every element and attribute of the format, how the game
  reads it, and what is still unknown.

**Status.** The parser handles every attribute the game reads; its rules are checked against the game, and the few that are
not are marked unverified. The renderer is compared with game screenshots for grounds, decorations, objects, holes and cheese,
backgrounds, images, joints, nails, mirrored rooms and minimalist mode ([`docs/rendering.md`](docs/rendering.md) lists what
was compared and the known differences). Not drawn yet: particles, mice, physics (dynamic grounds stay where the map puts
them). The API is not stable before 1.0.

## Quick start

Needs Node 20 or newer; Java and internet access only for the one-time asset build.

```sh
git clone https://github.com/tfmrecords/tfm-map-renderer.git
cd tfm-map-renderer
npm install
npm run assets:build     # about two minutes: the game's pictures into .assets/release
npm run server           # PNG render server, test page at http://127.0.0.1:3000/test
```

Without the asset build everything works with placeholder pictures.

## Library

```js
import { parseTfmMap, renderTfmSvg } from "tfm-map-renderer";
import { loadRelease } from "tfm-map-renderer/node";

const map = parseTfmMap(xml);                          // what the XML says; no game limits or modes applied
const { resolver } = await loadRelease(".assets/release");
const svg = renderTfmSvg(map, { assetResolver: resolver, mirrorX: false, clientLimits: "restricted" });
```

## Documentation

| | |
|---|---|
| [`docs/xml/`](docs/xml/README.md) | the map format: every attribute, how the game reads it, verified or not |
| [`docs/rendering.md`](docs/rendering.md) | how the game draws a map, what the renderer reproduces, known differences |
| [`docs/api/parser.md`](docs/api/parser.md) | parser functions, structure modes, derived values, editing |
| [`docs/api/renderer.md`](docs/api/renderer.md) | renderer options, client limits, screenshot comparison |
| [`docs/api/assets.md`](docs/api/assets.md) | building and loading the game's pictures |
| [`docs/api/http.md`](docs/api/http.md) | the PNG server ([`openapi.yaml`](docs/api/openapi.yaml)) |
| [`docs/asset-bundle-format.md`](docs/asset-bundle-format.md) | the asset release format |
| [`docs/architecture.md`](docs/architecture.md) | layers and design rules |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | how to contribute, test and check against the game |

## Tools

- `npm test`: all tests (no assets or network needed)
- `npm run compare -- --xml MAP.xml --shot SHOT.png --release .assets/release`: compare a render with a game screenshot
- `node bin/tfm-assets.mjs --help`: build releases, inspect and extract SWFs
- `node bin/parse-map.mjs MAP.xml`: print the parsed map as JSON
- `npm run bench:parser`, `bench:parser-large`, `bench:render-svg`: benchmarks

## Legal

The code is under the [MIT licence](LICENSE). Transformice and its pictures belong to Atelier 801; this project is not
affiliated with or endorsed by Atelier 801, and it contains none of the game's code or files ([`NOTICE`](NOTICE)).
