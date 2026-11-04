# PNG render server

`npm run server` starts an HTTP server that renders map XML to PNG: JSON in, a base64 PNG (or the bare PNG) out. It runs the
same parser and renderer as the library and rasterises with resvg, without a browser. The request shape follows
`entibo/miceditor-map-preview` (`{ xml, width, height, raw }`), so clients of that service can switch. Machine-readable form:
[`openapi.yaml`](openapi.yaml).

## Run from zero

Needs Node 20 or newer, Java (only for the one-time asset build; FFDec runs on it) and internet access (the build downloads
the game's SWF files).

```sh
git clone https://github.com/tfmrecords/tfm-map-renderer.git
cd tfm-map-renderer
npm install              # also installs the optional @resvg/resvg-js
npm run assets:build     # once, about two minutes: writes .assets/release (git-ignored)
npm run server           # http://127.0.0.1:3000/test
```

Without a release the server draws placeholders. On Windows, `npm run name -- --flag value` can lose the `--`; use the scripts
without arguments (the `PORT` and `TFM_ASSETS_RELEASE` environment variables configure the server; in PowerShell
`$env:PORT=3001; npm run server`) or call node directly:

```sh
node bin/tfm-render-server.mjs --port 3000 --release .assets/release
```

| Flag | Default | Meaning |
|---|---|---|
| `--release DIR` | `$TFM_ASSETS_RELEASE`, else `.assets/release` when it exists | the asset release; none: placeholders |
| `--port N` | `$PORT`, else 3000 | a bare number works too |
| `--host H` | `127.0.0.1` | `0.0.0.0` listens on every interface |
| `--precedence P` | `normal` | `client`: the game's order for pictures two bundles define ([`assets.md`](assets.md#which-bundle-wins)) |
| `--no-flash-blur` | | Gaussian blurs instead of Flash's box blurs |
| `--no-share-assets` | | every placement of a picture as its own `<image>` (slower; see "Performance") |
| `--concurrency N` | 2 | renders at the same time; further requests wait in a queue of 16 |
| `--rasterizer-processes N` | `--concurrency` | child processes that rasterise ([below](#performance)); each draws one picture at a time. 0 rasterises in the server process |
| `--renderer R` | `$TFM_RENDERER`, else `compositor` | how PNGs are drawn unless a request sets `renderer`: `compositor` from the scene ([`../rendering.md`](../rendering.md#png-compositor)), or `resvg` from the SVG (smaller processes, slower) |
| `--picture-cache-mb N` | 256 | the compositor's picture cache in each rasteriser process |
| `--timeout MS` | 30000 | per render |
| `--max-pixels N` | 16777216 | largest output (width times height); at most 8192 per side. A larger picture is truncated ([below](#response)) |
| `--no-map-images` | | do not fetch the map's own images ([below](#map-images)); also `TFM_MAP_IMAGES=0` |
| `--max-map-images N` | 32 | most images fetched for one map |
| `--max-image-bytes N` | 4000000 | largest image |
| `--unofficial-images` | | also absolute URLs on other hosts, where the game can load them |
| `--default-options JSON` | `$TFM_RENDER_DEFAULT_OPTIONS`, else none | renderer options every request gets unless it sets them itself (top level or in `options`), e.g. `'{"spawnMarkers":"editor"}'`; a bad value stops the start |
| `--max-map-size WxH` | `$TFM_MAX_MAP_SIZE`, else none | soft limit in map pixels: a larger map (or `viewport`) is drawn only up to W x H from its top-left corner, with a `map-cropped` warning, instead of failing; one number sets both. A part above `--max-pixels` is then truncated |

## Endpoints

| Request | Answer |
|---|---|
| `POST /` or `POST /render` | render (below) |
| `GET /health` | `{ ok, running, waiting, backend, release, mapImages }` (`backend` the default renderer) |
| `GET /test`, or `GET /` from a browser | a test page: paste XML or pick a file; set any request field or renderer option in a form (it edits the request JSON, and the JSON edits it); Render (Ctrl+Enter) shows the PNG, the whole SVG (previewed by the browser, copied or downloaded; fetched on demand when the answer has none), the warnings and the response |
| `GET /` | usage text |

Responses allow any origin (CORS).

## Request

`POST` with a JSON body:

| Field | Meaning |
|---|---|
| `xml` | the map XML (required, at most 2 MB). Lenient parsing unless `"lenient": false` |
| `width`, `height` | output size in pixels, 1 to 8192. One alone keeps the aspect ratio; both stretch the map to that size |
| `raw` | `true`: the answer is the bare `image/png` (or `image/svg+xml` with `"rasterize": false`), with `x-map-width` and `x-map-height` headers |
| `svg` | `true`: the answer also contains the SVG, even when rasterising fails ([below](#errors)) |
| `rasterize` | `false` (needs `"svg": true`): answer with the SVG only, at its own size; resvg is not used, so `width`, `height`, the pixel limits and `--max-map-size` do not apply |
| `lenient` | `false`: strict XML parsing |
| `mapImages` | `false`: skip the map's own images for this request |
| `renderer` | `resvg` or `compositor`: how this PNG is drawn (default `--renderer`); the answer's `backend` says which drew it |
| `options` | renderer options ([`renderer.md`](renderer.md#options)), JSON values only. Unknown names are an error |

Any renderer option may also be given at the top level, and `mirror` is short for `mirrorX`; unknown top-level fields are
ignored. Without `width` and `height` the output is the map size times `scale`.

| `svg` | `rasterize` | `raw` | Answer |
|---|---|---|---|
| | | | JSON with the PNG |
| `true` | | | JSON with the PNG and the SVG |
| | | `true` | the bare PNG |
| `true` | | `true` | the bare PNG |
| `true` | `false` | | JSON with the SVG |
| `true` | `false` | `true` | the bare SVG |
| | `false` | | 400 |

```sh
curl -s localhost:3000/render -H 'content-type: application/json' \
  -d '{"xml":"<C><P/><Z><S><S T=\"0\" X=\"400\" Y=\"380\" L=\"800\" H=\"40\"/></S><D/><O/></Z></C>","width":400}'
```

## Response

```json
{ "image": "<base64 PNG>", "mimeType": "image/png", "width": 800, "height": 400,
  "mapWidth": 800, "mapHeight": 400, "backend": "compositor", "clientLoads": true, "warnings": [] }
```

`clientLoads` is `false` when the game would fail to load the map; `warnings` are the first 50 XML diagnostics. With map images on,
`mapImages` is `{ requested, loaded, missing }` and a `map-image-unavailable` warning counts the images that could not be loaded. With
`--max-map-size`, a map cut down to that size gets a `map-cropped` warning with the drawn part (`x`, `y`, `width`, `height`, in map
pixels); `mapWidth` and `mapHeight` stay the map's own size. A picture above the output limits (8192 per side, `--max-pixels` in
all) is truncated, not scaled: the width is kept up to 8192, then the rows that fit, and only that top-left part of the map is
drawn; an `image-truncated` warning gives the size asked for (`requestedWidth`, `requestedHeight`) and the size drawn (`width`,
`height`). With `svg: true` the SVG is the one rasterised, so it is truncated too. A repeated identical request is answered from a
cache of 64 results and has `"cached": true`. When the compositor meets what it cannot draw (none of today's maps), resvg draws
the picture, `backend` is `resvg` and a `compositor-fallback` warning counts what was `unsupported`.

## Errors

Errors are `{ "error": "message" }`. When rasterising fails (a crash, or the timeout) and the request has `"svg": true`, the error
status stays and the body also has the SVG and the rest of the answer except the image (`svg`, `warnings`, `mapWidth`, ...); with
`"raw": true` the body is the bare SVG and the message is in the `x-render-error` header.

| Status | When |
|---|---|
| 400 | not JSON, missing `xml`, XML that cannot be parsed, an unknown or invalid option, `"rasterize": false` without `"svg": true`, a viewport or scale above the renderer's `limits` |
| 404 | another path |
| 413 | `xml` above 2 MB, or the body above 3 MB |
| 422 | the picture crashed the rasteriser's process (a resvg bug; the server keeps running) |
| 503 | the queue is full, or the render took longer than the timeout |
| 500 | an internal error |

## Map images

Many maps load pictures from the game's image hosts: `D`, `d`, ground `i`, `APS`, and on request `ARPS`, `IP` and tiled `D`
([`../xml/images.md`](../xml/images.md)). The renderer never downloads anything, so the server does it (unless started with
`--no-map-images`). It renders each map once to learn which images the renderer would draw, downloads them, and renders again
with them embedded. The parser lists every image a map refers to, but which are drawn depends on the options and client limits
(restricted maps drop ground `i`, `APS` and `IP`; `ARPS`, `IP` and tiled `D` are opt-in; minimalist mode drops `D`), and the
renderer needs each image's size to lay it out, so asking the renderer is exact; building the SVG takes about 2 ms, and the
second pass only happens when an image was loaded.

- URLs are built with the game's rules ([`../xml/images.md`](../xml/images.md#image-urls)) over `https`. Only
  `www.transformice.com` and `images.atelier801.com` are contacted, also after redirects; absolute URLs on other hosts only with
  `--unofficial-images`, and only where the game itself can load them (ground `i`, tiled `D`).
- `..` in a path is resolved like any URL, on the same host: `../wp-content/a.gif` in `D` is
  `www.transformice.com/wp-content/a.gif`.
- PNG, GIF and JPEG only (checked by content), at most 4 MB each and 32 per map (`--max-image-bytes`, `--max-map-images`),
  10 s per download.
- Images are cached in memory (64 MB, least recently used); a failed download is retried after 10 minutes. Concurrent requests
  share one download. A render that misses an image is not put in the result cache.

In the library, `createTfmImageResolver({ assets, external: true })` gives the renderer the URLs instead, which suits SVG
shown in a browser ([`assets.md`](assets.md#resolvers)).

## Performance

Measured with `node bench/render-server.mjs` over the maps of `test/maps` (resvg 2.6.2): parsing takes about 0.3 ms and building
the SVG about 2 ms; rasterising is nearly all of the time (61 ms on average, 300 ms at worst) and PNG encoding adds about 7 ms.

- **Shared assets** (on by default): every distinct picture is defined once and placed with `<use>`, instead of one embedded
  image per placement. Maps with many repeated grounds, objects or nails render 2 to 7 times faster. Anti-aliased edge pixels
  can move slightly; `--no-share-assets` turns it off.
- **Concurrency**: rasterising runs in a pool of child processes (`--rasterizer-processes`, by default as many as
  `--concurrency`), so renders run in parallel and the event loop stays free. A pool larger than `--concurrency` leaves
  processes idle. Each process holds its own resvg (some tens of MB). Sending the SVG and the PNG between processes costs a
  few milliseconds; the times above did not change measurably.
- **Crashes**: resvg aborts its process on some pictures (a Rust panic, not an exception; [`../rendering.md`](../rendering.md#culling)).
  The renderer avoids the known cases, and the pool contains the rest: only that child ends, the request is answered with 422,
  and a new child starts. On timeout the child drawing the picture is stopped the same way. With `--rasterizer-processes 0`
  resvg runs in the server, and such a crash ends the server. With the compositor, a map whose child crashed is drawn once more
  in a new child with whole pictures (the compositor crops large pictures, and resvg can panic on a crop); only a second crash
  is answered with 422.
- **Compositor**: each child keeps its own picture cache (`--picture-cache-mb`), so a child is larger (up to about 700 MB
  measured, against about 430 MB with resvg) and repeated pictures are drawn without resvg. On the corpus it is 1.2 to 1.5
  times as fast as resvg in total ([`../rendering.md`](../rendering.md#png-compositor)). With `--rasterizer-processes 0` it draws in
  the server process and blocks it while drawing.
- **Result cache**: 64 results, keyed by the whole request.
