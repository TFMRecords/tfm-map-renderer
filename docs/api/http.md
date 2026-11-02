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
| `--timeout MS` | 30000 | per render |
| `--max-pixels N` | 16777216 | largest output (width times height); at most 8192 per side |

## Endpoints

| Request | Answer |
|---|---|
| `POST /` or `POST /render` | render (below) |
| `GET /health` | `{ ok, running, waiting, backend, release }` |
| `GET /test`, or `GET /` from a browser | a test page: paste XML or pick a file, edit the request JSON, press Render (Ctrl+Enter) |
| `GET /` | usage text |

Responses allow any origin (CORS).

## Request

`POST` with a JSON body:

| Field | Meaning |
|---|---|
| `xml` | the map XML (required, at most 2 MB). Lenient parsing unless `"lenient": false` |
| `width`, `height` | output size in pixels, 1 to 8192. One alone keeps the aspect ratio; both stretch the map to that size |
| `raw` | `true`: the answer is the bare `image/png`, with `x-map-width` and `x-map-height` headers |
| `svg` | `true`: the answer also contains the SVG |
| `lenient` | `false`: strict XML parsing |
| `options` | renderer options ([`renderer.md`](renderer.md#options)), JSON values only. Unknown names are an error |

Any renderer option may also be given at the top level, and `mirror` is short for `mirrorX`; unknown top-level fields are
ignored. Without `width` and `height` the output is the map size times `scale`.

```sh
curl -s localhost:3000/render -H 'content-type: application/json' \
  -d '{"xml":"<C><P/><Z><S><S T=\"0\" X=\"400\" Y=\"380\" L=\"800\" H=\"40\"/></S><D/><O/></Z></C>","width":400}'
```

## Response

```json
{ "image": "<base64 PNG>", "mimeType": "image/png", "width": 800, "height": 400,
  "mapWidth": 800, "mapHeight": 400, "backend": "resvg", "clientLoads": true, "warnings": [] }
```

`clientLoads` is `false` when the game would fail to load the map; `warnings` are the first 50 XML diagnostics. A repeated
identical request is answered from a cache of 64 results and has `"cached": true`.

Errors are `{ "error": "message" }`:

| Status | When |
|---|---|
| 400 | not JSON, missing `xml`, XML that cannot be parsed, an unknown or invalid option, an output above the size limits |
| 404 | another path |
| 413 | `xml` above 2 MB, or the body above 3 MB |
| 503 | the queue is full, or the render took longer than the timeout |
| 500 | an internal error |

## Performance

Measured with `node bench/render-server.mjs` over the maps of `test/maps` (resvg 2.6.2): parsing takes about 0.3 ms and building
the SVG about 2 ms; rasterising is nearly all of the time (61 ms on average, 300 ms at worst) and PNG encoding adds about 7 ms.

- **Shared assets** (on by default): every distinct picture is defined once and placed with `<use>`, instead of one embedded
  image per placement. Maps with many repeated grounds, objects or nails render 2 to 7 times faster. Anti-aliased edge pixels
  can move slightly; `--no-share-assets` turns it off.
- **Concurrency**: rasterising runs on the libuv thread pool (`UV_THREADPOOL_SIZE`, default 4), so `--concurrency` renders in
  parallel and the event loop stays free.
- **Result cache**: 64 results, keyed by the whole request.
