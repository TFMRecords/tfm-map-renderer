#!/usr/bin/env node
// PNG render server: `node bin/tfm-render-server.mjs --release .assets/release --port 3000`. See src/server/http.js for the request format.
//   --release DIR     asset release written by `tfm-assets build` (default $TFM_ASSETS_RELEASE, else .assets/release when it exists; none = placeholder art)
//   --port N          default $PORT or 3000          --host H     default 127.0.0.1 (use 0.0.0.0 to listen on every interface)
//   --precedence P    normal (default) or client: which bundle wins for symbols two bundles define (docs/rendering.md, "Pictures from the game")
//   --no-flash-blur   use FFDec's Gaussian blurs instead of Flash's exact box blurs
//   --no-share-assets render every SVG asset placement as its own <image> (slower; sub-pixel identical to the game-facing default)
//   --concurrency N   simultaneous renders (default 2)       --timeout MS   per render (default 30000)       --max-pixels N   largest output (default 16777216)
//   --no-map-images   do not fetch the map's own images (D, d, i, APS, ...); by default they are fetched from the game's image hosts,
//                     cached in memory, and drawn ($TFM_MAP_IMAGES=0 also turns it off; a request can with "mapImages": false)
//   --max-map-images N   most images fetched for one map (default 32)     --max-image-bytes N   largest image (default 4000000)
//   --unofficial-images  also load absolute URLs on other hosts where the game can (ground i, tiled D)   (docs/api/http.md#map-images)
//   --default-options JSON   renderer options every request gets unless it sets them, e.g. '{"spawnMarkers":"editor"}' (default $TFM_RENDER_DEFAULT_OPTIONS)
import { existsSync } from "node:fs";
import { createRenderService } from "../src/server/render-service.js";
import { createRenderServer } from "../src/server/http.js";
import { createResvgRasterizer } from "../src/server/rasterize.js";
import { loadRelease } from "../src/assets/release.js";
import { createMapImageFetcher } from "../src/server/map-images.js";

// Accepts `--key value`, `--key=value` and a lone number as the port. npm on Windows/PowerShell can swallow `--` and eat the flags, so `npm run server`
// (no arguments) reads PORT / TFM_ASSETS_RELEASE, and a flag npm took for itself is recovered from npm_config_<flag>.
const FLAGS = new Set(["no-flash-blur", "no-share-assets", "no-map-images", "map-images", "unofficial-images"]);
const VALUE_FLAGS = ["release", "port", "host", "precedence", "concurrency", "timeout", "max-pixels", "max-map-images", "max-image-bytes", "default-options"];
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (/^\d+$/.test(a) && args.port === undefined) { args.port = a; continue; }
  if (!a.startsWith("--")) { console.error(`unexpected argument ${a} (try: node bin/tfm-render-server.mjs --port 3000)`); process.exit(2); }
  const eq = a.indexOf("=");
  const key = (eq < 0 ? a : a.slice(0, eq)).slice(2);
  if (FLAGS.has(key)) args[key] = true;
  else args[key] = eq < 0 ? process.argv[++i] : a.slice(eq + 1);
}
for (const key of VALUE_FLAGS) {
  const fromNpm = process.env[`npm_config_${key.replaceAll("-", "_")}`];
  if (args[key] === undefined && fromNpm && fromNpm !== "true") args[key] = fromNpm;
}
const releaseDir = args.release ?? process.env.TFM_ASSETS_RELEASE ?? (existsSync(".assets/release/release.json") ? ".assets/release" : null);
let assetResolver = null;
if (releaseDir) {
  const release = await loadRelease(releaseDir, { flashBlur: !args["no-flash-blur"], precedence: args.precedence ?? "normal" });
  assetResolver = release.resolver;
  console.log(`asset release: ${releaseDir} (${[...release.bundles.keys()].join(", ")})`);
} else console.warn("no asset release: maps are drawn with placeholder art (run `npm run assets -- build --out .assets/release`)");
const rasterizer = await createResvgRasterizer();
// Map images are on unless turned off (`--map-images` is accepted and changes nothing).
const withMapImages = !args["no-map-images"] && process.env.npm_config_no_map_images !== "true" && process.env.TFM_MAP_IMAGES !== "0";
const positive = (value, fallback) => (value === undefined ? fallback : Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fail(`not a positive whole number: ${value}`));
function fail(message) { console.error(message); process.exit(2); }
const mapImages = withMapImages ? createMapImageFetcher({
  allowUnofficial: Boolean(args["unofficial-images"]),
  maxImages: positive(args["max-map-images"], 32), maxBytes: positive(args["max-image-bytes"], 4_000_000),
}) : null;
console.log(mapImages
  ? `map images: fetched from the game's image hosts${args["unofficial-images"] ? " and other hosts" : ""} (at most ${positive(args["max-map-images"], 32)} per map)`
  : "map images: off");
const defaultOptionsText = args["default-options"] ?? process.env.TFM_RENDER_DEFAULT_OPTIONS;
let defaultOptions = {};
if (defaultOptionsText) {
  try { defaultOptions = JSON.parse(defaultOptionsText); } catch (error) { fail(`--default-options: not JSON: ${error.message}`); }
  console.log(`default options: ${JSON.stringify(defaultOptions)}`);
}
let service;
try {
  service = createRenderService({
    rasterizer, assetResolver, mapImages, defaultOptions,
    shareAssets: !args["no-share-assets"], concurrency: Number(args.concurrency ?? 2), timeoutMs: Number(args.timeout ?? 30000), maxPixels: Number(args["max-pixels"] ?? 4096 * 4096),
  });
} catch (error) { fail(`--default-options: ${error.message}`); }
const server = createRenderServer(service, { info: { backend: rasterizer.name, release: Boolean(assetResolver), mapImages: Boolean(mapImages) } });
const port = Number(args.port ?? process.env.PORT ?? 3000);
server.listen(port, args.host ?? "127.0.0.1", () => console.log(`tfm-render-server (${rasterizer.name}) listening on http://${args.host ?? "127.0.0.1"}:${port}`));
