import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { parseTfmMap } from "../src/index.js";

const xml = (await readFile(new URL("../test/fixtures/complex-features.xml", import.meta.url), "utf8")).trim();
const iterations = Number(process.argv[2] ?? 10000);

for (let i = 0; i < 100; i++) parseTfmMap(xml);
const start = performance.now();
for (let i = 0; i < iterations; i++) parseTfmMap(xml);
const elapsed = performance.now() - start;
console.log(JSON.stringify({
  iterations,
  bytesPerXml: Buffer.byteLength(xml),
  elapsedMs: Number(elapsed.toFixed(2)),
  mapsPerSecond: Math.round(iterations / (elapsed / 1000)),
  usPerMap: Number(((elapsed * 1000) / iterations).toFixed(2)),
}, null, 2));
