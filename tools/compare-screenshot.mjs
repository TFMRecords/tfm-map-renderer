#!/usr/bin/env node
// Compares our render of a map with a screenshot of the real game. Renders the XML with the asset release, rasterises it with resvg
// (or takes `--ours-png`), finds where the render sits inside the screenshot, and prints the overall error and the error per region (each ground, decoration,
// hole, cheese and object, or regions you give). Writes `ours.png`, `shot-aligned.png` and `diff.png` into `--out`.
//
//   node tools/compare-screenshot.mjs --xml test/maps/mirrored-4.xml --shot ~/mirrored.png --mirror --release .assets/release --out /tmp/cmp
//
// Options: --xml FILE (required)  --shot FILE (required)  --release DIR (asset release; none = placeholders)  --mirror (mirrorX)
//   --options JSON (extra renderTfmSvg options, e.g. '{"flashBlur":false,"clientLimits":"restricted"}')  --ours-png FILE (skip the rasteriser)
//   --regions "name:x,y,w,h;..." (default: one per map element)
//   --ignore-top N (default 24) --ignore-bottom N (default 20): rows of the map the game covers with its own bars  --offset dx,dy (skip the alignment)
//   --search x0,x1,y0,y1 (alignment range; default: every placement with enough overlap)  --out DIR  --json (machine-readable output)
// Reading the numbers: RMSE is the root-mean-square channel difference (0 to 255) over the pixels; identical renders give 0, a flipped or misplaced element 20 or
// more, plain anti-aliasing and the game's random tile choice 3 to 10. Regions with random textures (grounds) are noisier than clips.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseTfmMap, renderTfmSvg } from "../src/index.js";
import { decodePng, encodePng } from "../src/util/png.js";
import { alignImages, regionErrors, diffImage, autoRegions, rmse } from "../src/util/compare.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const key = a.slice(2);
    if (["mirror", "json"].includes(key)) args[key] = true;
    else args[key] = argv[++i];
  }
  return args;
}

async function rasterise(svg, width, height) {
  const { createResvgRasterizer } = await import("../src/server/rasterize.js");
  const r = await (await createResvgRasterizer()).rasterize(svg, { width, height });
  return decodePng(r.png);
}

function crop(image, box) {
  const x0 = Math.max(0, box.x), y0 = Math.max(0, box.y);
  const x1 = Math.min(image.width, box.x + box.w), y1 = Math.min(image.height, box.y + box.h);
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(image.data.subarray(((y0 + y) * image.width + x0) * 4, ((y0 + y) * image.width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, data };
}

const args = parseArgs(process.argv.slice(2));
if (!args.xml || !args.shot) { console.error("usage: node tools/compare-screenshot.mjs --xml FILE --shot FILE [--release DIR] [--mirror] [--out DIR] (see the header of this file)"); process.exit(2); }
const map = parseTfmMap(await readFile(args.xml, "utf8"));
const options = { ...(args.options ? JSON.parse(args.options) : {}), ...(args.mirror ? { mirrorX: true } : {}) };
if (args.release) {
  const { loadRelease } = await import("../src/assets/index.js");
  options.assetResolver = (await loadRelease(args.release, { flashBlur: options.flashBlur !== false })).resolver;
}
const width = map.settings.width ?? 800, height = map.settings.height ?? 400;
let ours;
if (args["ours-png"]) ours = decodePng(await readFile(args["ours-png"]));
else ours = await rasterise(renderTfmSvg(map, options), width, height);
const shot = decodePng(await readFile(args.shot));

const ignoreTop = Number(args["ignore-top"] ?? 24), ignoreBottom = Number(args["ignore-bottom"] ?? 20);
let offset;
if (args.offset) { const [dx, dy] = args.offset.split(",").map(Number); offset = { dx, dy, ...rmse(ours, shot, { x: 0, y: ignoreTop, w: ours.width, h: ours.height - ignoreTop - ignoreBottom }, dx, dy) }; }
else {
  const range = args.search ? (([x0, x1, y0, y1]) => ({ x: [x0, x1], y: [y0, y1] }))(args.search.split(",").map(Number)) : null;
  offset = alignImages(ours, shot, { range, ignoreTop, ignoreBottom });
}

let regions;
if (args.regions) regions = args.regions.split(";").filter(Boolean).map((r) => { const [label, box] = r.split(":"); const [x, y, w, h] = box.split(",").map(Number); return { label, x, y, w, h }; });
else regions = autoRegions(map, { mirrorWidth: args.mirror ? width : null });
const errors = regionErrors(ours, shot, offset, regions).sort((a, b) => b.rmse - a.rmse);

if (args.out) {
  await mkdir(args.out, { recursive: true });
  await writeFile(path.join(args.out, "ours.png"), encodePng(ours));
  await writeFile(path.join(args.out, "shot-aligned.png"), encodePng(crop(shot, { x: offset.dx, y: offset.dy, w: ours.width, h: ours.height })));
  await writeFile(path.join(args.out, "diff.png"), encodePng(diffImage(ours, shot, offset)));
}
const result = { offset: { dx: offset.dx, dy: offset.dy }, overall: { rmse: Number(offset.rmse.toFixed(2)), pixels: offset.pixels }, regions: errors.map((e) => ({ label: e.label, rmse: Number(e.rmse.toFixed(1)), shift: [e.dx, e.dy] })) };
if (args.json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`alignment: our render at (${offset.dx}, ${offset.dy}) in the screenshot; RMSE ${result.overall.rmse} over the ${offset.pixels} non-background pixels that fall inside it${offset.coverage != null ? ` (${Math.round(offset.coverage * 100)}% of ours)` : ""}`);
  console.log("region                                   RMSE  local shift");
  for (const e of result.regions) console.log(`${e.label.padEnd(40)} ${Number.isFinite(e.rmse) ? String(e.rmse).padStart(5) : "  n/a"}  ${Number.isFinite(e.rmse) ? `(${e.shift.join(", ")})` : "(outside the screenshot)"}`);
}
