#!/usr/bin/env node
// tfm-assets: inspect a SWF, extract static assets with a pinned FFDec, and pack release bundles.
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readSwf } from "../src/swf/reader.js";
import { embeddedSwfs, isLoaderSwf, unwrapLoaderSwf } from "../src/swf/unwrap.js";
import { RELEASE_SOURCES, buildEffects, buildRelease } from "../src/assets/release.js";
import { MAP_SWFS, fetchSwf } from "../src/assets/swf-sources.js";
import { extractAssets, inspectSwf } from "../src/assets/extract.js";
import { ensureFfdec, detectJava } from "../src/assets/ffdec.js";
import { packBundle, bundleFileName, readBundleDirectory, writeBundleDirectory } from "../src/assets/bundle.js";

const USAGE = `Usage:
  tfm-assets ffdec install [--cache-dir DIR]
  tfm-assets inspect <file.swf> [--match REGEX] [--kind shape,sprite,image] [--json]
  tfm-assets extract <file.swf> --out DIR [--bundle FILE.tar.gz] [--match REGEX] [--ids 1,2,3]
                     [--scope named|all] [--frames all|first] [--ffdec-jar PATH] [--java PATH]
  tfm-assets pack <bundle-dir> --out FILE.tar.gz
  tfm-assets unwrap <Transformice.swf> --out FILE      rebuild the real game SWF from the downloaded loader
  tfm-assets embedded <game.swf> --out DIR             write the SWFs embedded as binary data (the client's graphics libraries)
  tfm-assets effects [--out DIR]                       write effects.json (colour transforms, blend modes) into an existing release
  tfm-assets build [--out DIR] [--only name,name] [--swf-dir DIR] [--code-ref REF]
                                                       fetch everything (or read the SWFs from --swf-dir) and write a release
                                                       (one bundle per source + release.json; --code-ref is recorded in it)
  tfm-assets fetch --out DIR [--only a.swf,b.swf] [--raw]
                                                       download (and unwrap, unless --raw) the SWFs a map renderer needs;
                                                       prints each file's SHA-256

--out defaults to .assets/release for build and effects. Both "--out DIR" and "--out=DIR" work.
Environment: TFM_FFDEC_JAR (use this jar), TFM_ASSETS_CACHE (FFDec cache directory).`;

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" }, bundle: { type: "string" }, match: { type: "string" }, kind: { type: "string" },
    ids: { type: "string" }, scope: { type: "string", default: "named" }, frames: { type: "string", default: "all" },
    "ffdec-jar": { type: "string" }, java: { type: "string", default: "java" }, "cache-dir": { type: "string" }, only: { type: "string" },
    "swf-dir": { type: "string" }, "code-ref": { type: "string" }, raw: { type: "boolean", default: false },
    json: { type: "boolean", default: false }, help: { type: "boolean", default: false },
  },
});

// Default release location, so `npm run assets:build` needs no arguments (npm on Windows/PowerShell can swallow `--out DIR`).
const DEFAULT_RELEASE = ".assets/release";
const fail = (message) => { console.error(message); process.exit(2); };
const [command, ...rest] = positionals;
if (opt.help || !command) { console.log(USAGE); process.exit(command ? 0 : 2); }

async function jar() {
  const found = await ensureFfdec({ jar: opt["ffdec-jar"] ?? process.env.TFM_FFDEC_JAR, cacheDir: opt["cache-dir"], log: (m) => console.error(m) });
  return found;
}

if (command === "ffdec" && rest[0] === "install") {
  const found = await jar();
  const java = await detectJava({ java: opt.java });
  console.log(JSON.stringify({ ...found, java }, null, 2));
} else if (command === "inspect") {
  const file = rest[0] ?? fail(USAGE);
  const swf = readSwf(await readFile(file));
  const rows = inspectSwf(swf, { match: opt.match ? new RegExp(opt.match, "i") : null, kinds: opt.kind ? opt.kind.split(",") : null });
  if (opt.json) console.log(JSON.stringify({ version: swf.version, compression: swf.compression, stage: swf.frameSize, tagCounts: swf.tagCounts, rows }, null, 2));
  else {
    console.log(`SWF v${swf.version} ${swf.compression}, stage ${swf.frameSize.width}x${swf.frameSize.height}, ${swf.characters.size} characters, ${swf.symbols.length} symbols`);
    for (const r of rows) console.log(`${String(r.id).padStart(6)}  ${r.kind.padEnd(10)} ${String(r.width ?? "").padStart(7)}x${String(r.height ?? "").padEnd(7)} ${r.frames ? `${r.frames}f ` : "   "} ${r.names.join(", ")}`);
  }
} else if (command === "extract") {
  const file = rest[0] ?? fail(USAGE);
  if (!opt.out && !opt.bundle) fail("extract needs --out DIR and/or --bundle FILE");
  const found = await jar();
  const { manifest, files } = await extractAssets({
    swfPath: resolve(file), jar: found.jar, java: opt.java, scope: opt.scope, frames: opt.frames, ffdecVersion: found.version,
    match: opt.match ? new RegExp(opt.match, "i") : null, ids: opt.ids ? opt.ids.split(",").map(Number) : null,
    log: (m) => console.error(m),
  });
  if (opt.out) await writeBundleDirectory(resolve(opt.out), files);
  if (opt.bundle) {
    const packed = packBundle(files);
    await mkdir(dirname(resolve(opt.bundle)), { recursive: true });
    await writeFile(resolve(opt.bundle), packed.data);
    console.error(`bundle ${opt.bundle} sha256 ${packed.sha256} (suggested name ${bundleFileName(manifest)})`);
  }
  console.log(JSON.stringify({ assets: Object.keys(manifest.assets).length, symbols: Object.keys(manifest.symbols).length, warnings: manifest.warnings }, null, 2));
} else if (command === "pack") {
  const dir = rest[0] ?? fail(USAGE);
  if (!opt.out) fail("pack needs --out FILE.tar.gz");
  const packed = packBundle(await readBundleDirectory(resolve(dir)));
  await writeFile(resolve(opt.out), packed.data);
  console.log(JSON.stringify({ file: opt.out, sha256: packed.sha256, bytes: packed.data.length }, null, 2));
} else if (command === "unwrap") {
  const file = rest[0] ?? fail(USAGE);
  if (!opt.out) fail("unwrap needs --out FILE");
  const { swf, order } = unwrapLoaderSwf(await readFile(file));
  await mkdir(dirname(resolve(opt.out)), { recursive: true });
  await writeFile(resolve(opt.out), swf);
  console.log(JSON.stringify({ file: opt.out, bytes: swf.length, chunks: order.length }, null, 2));
} else if (command === "embedded") {
  const file = rest[0] ?? fail(USAGE);
  if (!opt.out) fail("embedded needs --out DIR");
  await mkdir(resolve(opt.out), { recursive: true });
  const written = [];
  for (const e of embeddedSwfs(await readFile(file))) {
    const target = resolve(opt.out, `${e.id}${e.name ? `_${e.name.replace(/[^\x20-\x7e]/g, "").replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^_+/, "")}` : ""}.swf`);
    await writeFile(target, e.data);
    written.push({ file: target, id: e.id, name: e.name, bytes: e.data.length });
  }
  console.log(JSON.stringify(written, null, 2));
} else if (command === "effects") {
  opt.out ??= DEFAULT_RELEASE;
  const needed = new Set(RELEASE_SOURCES.map((r) => r.swf));
  const files = new Map();
  for (const entry of MAP_SWFS.filter((e) => needed.has(e.name))) {
    let data = await fetchSwf(entry);
    if (entry.loader && isLoaderSwf(data)) data = unwrapLoaderSwf(data).swf;
    files.set(entry.name, data);
  }
  const effects = buildEffects(RELEASE_SOURCES, files);
  await writeFile(resolve(opt.out, "effects.json"), `${JSON.stringify(effects)}\n`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(effects).map(([k, v]) => [k, Object.keys(v).length])), null, 2));
} else if (command === "build") {
  opt.out ??= DEFAULT_RELEASE;
  const found = await jar();
  const index = await buildRelease({
    outDir: resolve(opt.out), workDir: resolve(opt.out, ".work"), jar: found.jar, java: opt.java, ffdecVersion: found.version,
    only: opt.only ? opt.only.split(",") : null, log: (m) => console.error(m),
    swfDir: opt["swf-dir"] ? resolve(opt["swf-dir"]) : null, code: opt["code-ref"] ? { ref: opt["code-ref"] } : null,
  });
  console.log(JSON.stringify(index, null, 2));
} else if (command === "fetch") {
  if (!opt.out) fail("fetch needs --out DIR");
  const only = opt.only ? new Set(opt.only.split(",")) : null;
  const done = [];
  for (const entry of MAP_SWFS.filter((e) => !only || only.has(e.name))) {
    let data = await fetchSwf(entry);
    if (entry.loader && !opt.raw && isLoaderSwf(data)) data = unwrapLoaderSwf(data).swf;
    const target = resolve(opt.out, entry.name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    done.push({ file: entry.name, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") });
    console.error(`fetched ${entry.name} (${data.length} bytes)`);
  }
  console.log(JSON.stringify(done, null, 2));
} else {
  fail(USAGE);
}
