import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { parseTfmMap, renderTfmSvg } from "../src/index.js";

const xml = (await readFile(new URL("../test/fixtures/event-halloween-attic.xml", import.meta.url), "utf8")).trim();
const map = parseTfmMap(xml);
const iterations = Number(process.argv[2] ?? 1000);
for (let i = 0; i < 50; i++) renderTfmSvg(map);
const start = performance.now();
let bytes = 0;
for (let i = 0; i < iterations; i++) bytes += Buffer.byteLength(renderTfmSvg(map));
const elapsed = performance.now() - start;
console.log(JSON.stringify({
  iterations,
  mapBytes: Buffer.byteLength(xml),
  svgBytes: Math.round(bytes / iterations),
  elapsedMs: Number(elapsed.toFixed(2)),
  rendersPerSecond: Math.round(iterations / (elapsed / 1000)),
  msPerRender: Number((elapsed / iterations).toFixed(4)),
}, null, 2));
