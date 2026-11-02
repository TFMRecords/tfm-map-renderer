import { performance } from "node:perf_hooks";
import { parseTfmMap } from "../src/index.js";

const grounds = Number(process.argv[2] ?? 300);
const decorations = Number(process.argv[3] ?? 200);
const objects = Number(process.argv[4] ?? 200);
const iterations = Number(process.argv[5] ?? 1000);

const gs = Array.from({ length: grounds }, (_, i) =>
  `<S T="${i % 15}" X="${i * 3}" Y="${100 + (i % 250)}" L="80" H="20" P="0,0,0.3,0.2,0,0,0,0"/>`
).join("");
const ds = Array.from({ length: decorations }, (_, i) =>
  `<P T="${i % 100}" X="${i * 2}" Y="${50 + (i % 300)}" P="${i % 2},${i % 3}"/>`
).join("");
const os = Array.from({ length: objects }, (_, i) =>
  `<O C="${i % 30}" X="${i * 4}" Y="${60 + (i % 280)}" P="${i % 360},${i % 2}"/>`
).join("");
const xml = `<C><P L="5000" H="1000" G="0,10"/><Z><S>${gs}</S><D>${ds}</D><O>${os}</O></Z></C>`;

for (let i = 0; i < 20; i++) parseTfmMap(xml);
const start = performance.now();
for (let i = 0; i < iterations; i++) parseTfmMap(xml);
const elapsed = performance.now() - start;
console.log(JSON.stringify({
  grounds, decorations, objects, iterations,
  bytesPerXml: Buffer.byteLength(xml),
  elapsedMs: Number(elapsed.toFixed(2)),
  mapsPerSecond: Math.round(iterations / (elapsed / 1000)),
  msPerMap: Number((elapsed / iterations).toFixed(3)),
}, null, 2));
