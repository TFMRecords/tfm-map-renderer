# Assets

The renderer draws the game's own pictures: ground tiles, backgrounds, holes and cheese, decorations and shaman objects. They
are not part of this repository. The asset tools download the game's SWF files from `www.transformice.com`, extract the
pictures as SVG with FFDec and write an **asset release**: four bundles plus an index. The format is in
[`../asset-bundle-format.md`](../asset-bundle-format.md), so anyone can build compatible bundles.

The pictures are Atelier 801's. Build a release locally, or use one published from
[tfmrecords/tfm-map-assets](https://github.com/tfmrecords/tfm-map-assets), whose `NOTICE` explains the terms.

## Building a release

Needs Java (FFDec runs on it) and internet access.

```sh
npm run assets:build                                  # writes .assets/release (git-ignored), about two minutes
node bin/tfm-assets.mjs build --out DIR --only pictos  # another directory, or only some bundles
```

The first build downloads FFDec 26.3.0 (SHA-256 checked) into a cache directory (`TFM_ASSETS_CACHE`); `TFM_FFDEC_JAR` uses an
existing `ffdec-cli.jar` instead. The build then:

1. downloads `Transformice.swf`, `x_pictos_editeur.swf` and `x_items_chaman.swf`;
2. unwraps `Transformice.swf`, which is a loader: the game is stored inside it in shuffled pieces. A small interpreter runs the
   loader's own script to put them in order (no Java needed);
3. takes the two picture libraries embedded in the game SWF;
4. extracts every named shape and sprite of the four SWFs with FFDec and writes one bundle per source;
5. reads the colour transforms and blend modes of the placed sprites from the SWF tags into `effects.json` (FFDec's SVG export
   drops some of them, [`../rendering.md`](../rendering.md#pictures-from-the-game)).

| Bundle | From | Holds |
|---|---|---|
| `game-resources` | the game SWF | ground tiles `$T_n`, `$Sol_*`, backgrounds `$F_n`, cheese, holes |
| `game-fla` | the game SWF | ground variants, `$Trou`, `$Sol`, level clips |
| `pictos` | `x_pictos_editeur.swf` | decorations `$P_n` |
| `shaman-items` | `x_items_chaman.swf` | shaman objects and skins `$Objet_n` |

Please keep downloads rare: a release only changes when the game's files do.

## Using a published release

Instead of building, download a release from
[tfmrecords/tfm-map-assets](https://github.com/tfmrecords/tfm-map-assets/releases) into a directory and load it the same way:

```sh
gh release download --repo tfmrecords/tfm-map-assets --dir .assets/release    # the latest release
```

Releases are tagged `assets-YYYYMMDD-f<version>`; the `f` number is the format version `loadRelease` must support.

## Loading a release

```js
import { renderTfmSvg } from "tfm-map-renderer";
import { loadRelease } from "tfm-map-renderer/node";

const release = await loadRelease(".assets/release", { precedence: "normal", flashBlur: true });
const svg = renderTfmSvg(map, { assetResolver: release.resolver });
```

`loadRelease(dir)` checks the format version and every bundle's SHA-256, and returns `{ index, bundles, effects, resolver }`.
Pictures are looked up by symbol name (`$F_5`, `$P_12`, `$Objet_101`), never by id. A release without `effects.json` still
loads (without the colour corrections).

### Which bundle wins

Some names are defined in two bundles, most visibly `$Fromage`, the cheese. The game looks names up in this order: game
resources, shaman items, decorations, game graphics (`precedence: "client"`). The default (`"normal"`) puts `game-fla` first
instead, because the releases so far were built during an event and `game-resources` then held the event's cheese; the
everyday yellow cheese is in `game-fla`. An array of bundle names sets any order.

## Resolvers

A resolver is any object with `resolve(reference)` returning `{ href, width, height, origin }` or `null`. The renderer only
reads pictures through it and never fetches anything itself.

| Resolver | From | Use |
|---|---|---|
| `loadRelease(dir).resolver` | `tfm-map-renderer/node` | a release: the usual case |
| `createBundleResolver(bundle)` | `tfm-map-renderer/node` | one bundle, by symbol name |
| `createMemoryAssetResolver({ key: asset })` | `tfm-map-renderer/node` | preloaded pictures (tests, browsers) |
| `createFilesystemAssetResolver(dir)` | `tfm-map-renderer/node` | a directory of extracted files |
| `createTfmImageResolver({ assets, external })` | `tfm-map-renderer/node` | map images (`D`, `d`, `i`, ...): asks `assets` first, and returns the game's URL only with `external: true` |

### Bundles from elsewhere

`loadAssetBundle(location, options)` (`tfm-map-renderer/node`) loads one bundle from a directory, a `.tar.gz` or `.zip` file, a
URL (`{ type: "url", url, sha256 }` checks the hash) or a GitHub release
(`{ type: "github-release", repo: "owner/name", tag, asset }`). Downloads are cached in `cacheDir` and reused when the network is
down (`refresh: true` downloads again). `loadAssetBundleOrNull` returns `null` instead of throwing.

## Command line

`node bin/tfm-assets.mjs --help` (or `npm run assets -- --help`) lists everything:

| Command | Does |
|---|---|
| `build [--out DIR] [--only a,b] [--swf-dir DIR] [--code-ref REF]` | fetch (or read from `--swf-dir`), unwrap, extract and write a release |
| `fetch --out DIR [--raw]` | only download (and unwrap, unless `--raw`) the SWFs; prints their SHA-256 |
| `unwrap <Transformice.swf> --out FILE` | rebuild the game SWF from the loader |
| `embedded <game.swf> --out DIR` | write the SWFs embedded in the game SWF |
| `inspect <file.swf>` | list the characters and symbol names of a SWF |
| `extract <file.swf> --out DIR [--bundle FILE]` | extract one SWF into a bundle directory (and archive) |
| `pack <bundle-dir> --out FILE.tar.gz` | archive a bundle directory |
| `effects [--out DIR]` | (re)write `effects.json` of an existing release |
| `ffdec install` | download the pinned FFDec |

## Offline mode

Without a release the renderer draws placeholders ([`renderer.md`](renderer.md#placeholders)); nothing else changes.
