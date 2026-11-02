import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import * as b from "../test-support/swf-builder.js";
import { extractAssets, classifyExport, inspectSwf, pngSize } from "../src/assets/extract.js";
import { AssetBundle, packBundle, bundleFileName, writeBundleDirectory } from "../src/assets/bundle.js";
import { readSwf } from "../src/swf/reader.js";
import { validateManifest } from "../src/assets/bundle-manifest.js";
import { detectJava } from "../src/assets/ffdec.js";

const SHAPE_1 = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns:ffdec="https://www.free-decompiler.com/flash" xmlns:xlink="http://www.w3.org/1999/xlink" ffdec:objectType="shape" height="40.0px" width="20.0px" xmlns="http://www.w3.org/2000/svg">
  <g transform="matrix(1.0, 0.0, 0.0, 1.0, 10.0, 20.0)">
    <path d="M-10.0 -20.0 L10.0 -20.0 10.0 20.0 -10.0 20.0 -10.0 -20.0" fill="#ff0000" fill-rule="evenodd" stroke="none"/>
  </g>
</svg>
`;
const SPRITE_FRAME = (n) => `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns:ffdec="https://www.free-decompiler.com/flash" xmlns:xlink="http://www.w3.org/1999/xlink" ffdec:objectType="frame" height="${10 * n}.0px" width="55.0px" xmlns="http://www.w3.org/2000/svg">
  <g transform="matrix(1.0, 0.0, 0.0, 1.0, 5.0, 20.0)">
    <use ffdec:characterId="1" height="40.0" transform="matrix(1.0, 0.0, 0.0, 1.0, 5.0, 0.0)" width="20.0" xlink:href="#shape0"/>
  </g>
  <defs><g id="shape0"><path d="M0 0 L5 5" fill="#ff0000"/></g></defs>
</svg>
`;
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

async function swfFile(dir, tags = null) {
  const file = path.join(dir, "t.swf");
  await writeFile(file, b.buildSwf(tags ?? [
    b.defineShapeRect(1, -200, -400, 400, 800),
    b.defineShapeRect(2, 0, 0, 1000, 200, [0, 128, 0, 255]),
    b.defineSprite(3, [b.placeObject2(1, 1, 100, 0)], 2),
    b.defineBitsLossless2(4, 4, 4, new Array(64).fill(255)),
    b.defineShapeRect(5, 0, 0, 20, 20), // anonymous, must be skipped in "named" scope
    b.symbolClass([[3, "tree_a"], [1, "Marker"], [4, "tex"]]),
    b.exportAssets([[2, "ground_green"]]),
  ], { compress: true }));
  return file;
}

// Emulates FFDec's output layout (captured from real runs of FFDec 26.3.0).
function fakeFfdec(log) {
  return async ({ args }) => {
    log.push(args);
    const outDir = args[args.length - 2];
    const ids = args[args.indexOf("-selectid") + 1];
    const wanted = new Set(ids.split(",").flatMap((r) => { const [a, z = a] = r.split("-").map(Number); return Array.from({ length: z - a + 1 }, (_, i) => a + i); }));
    const w = async (rel, data) => { await mkdir(path.dirname(path.join(outDir, rel)), { recursive: true }); await writeFile(path.join(outDir, rel), data); };
    if (wanted.has(1)) await w("shapes/1_Marker.svg", SHAPE_1);
    if (wanted.has(2)) await w("shapes/2_ground_green.svg", SHAPE_1);
    if (wanted.has(3)) { await w("sprites/DefineSprite_3_tree_a/1.svg", SPRITE_FRAME(4)); await w("sprites/DefineSprite_3_tree_a/2.svg", SPRITE_FRAME(5)); }
    if (wanted.has(4)) await w("images/4.png", PNG_1X1);
    if (wanted.has(5)) await w("shapes/5.svg", SHAPE_1);
    return { stdout: "OK", stderr: "" };
  };
}

test("classifyExport understands FFDec's export layout and ignores everything else", () => {
  assert.deepEqual(classifyExport("shapes/12_Marker.svg"), { kind: "shape", id: 12 });
  assert.deepEqual(classifyExport("shapes/12.svg"), { kind: "shape", id: 12 });
  assert.deepEqual(classifyExport("sprites/DefineSprite_3_tree_a/2.svg"), { kind: "sprite", id: 3, frame: 2 });
  assert.deepEqual(classifyExport("sprites/DefineSprite_3/1.svg"), { kind: "sprite", id: 3, frame: 1 });
  assert.deepEqual(classifyExport("images/4.png"), { kind: "image", id: 4, ext: "png" });
  assert.deepEqual(classifyExport("images/4_x.JPEG"), { kind: "image", id: 4, ext: "jpeg" });
  for (const bad of ["symbols.csv", "shapes/abc.svg", "sprites/1.svg", "scripts/a.as", "shapes/sub/1.svg"]) assert.equal(classifyExport(bad), null, bad);
});

test("pngSize reads IHDR and returns null for non-PNG", () => {
  assert.deepEqual(pngSize(PNG_1X1), { width: 1, height: 1 });
  assert.equal(pngSize(Buffer.from("GIF89a....")), null);
});

test("inspectSwf lists characters with names and sizes without Java", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ex-"));
  try {
    const swf = readSwf(b.buildSwf([b.defineShapeRect(1, 0, 0, 200, 100), b.symbolClass([[1, "Marker"]]), b.defineSprite(2, [], 3)]));
    assert.deepEqual(inspectSwf(swf), [
      { id: 1, kind: "shape", names: ["Marker"], frames: null, width: 10, height: 5 },
      { id: 2, kind: "sprite", names: [], frames: 3, width: null, height: null },
    ]);
    assert.equal(inspectSwf(swf, { match: /^mark/i }).length, 1);
    assert.equal(inspectSwf(swf, { kinds: ["sprite"] }).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("extractAssets builds a manifest and normalized files from FFDec output (named scope)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ex-"));
  try {
    const log = [];
    const { manifest, files } = await extractAssets({ swfPath: await swfFile(dir), jar: "/fake.jar", runner: fakeFfdec(log), ffdecVersion: "9.9.9" });
    validateManifest(manifest);
    assert.deepEqual(Object.keys(manifest.assets), ["1", "2", "3", "4"], "anonymous shape 5 is skipped");
    assert.deepEqual(manifest.symbols, { Marker: 1, ground_green: 2, tex: 4, tree_a: 3 });
    assert.deepEqual(manifest.assets["1"].frames[0], { file: "svg/shapes/1.svg", width: 20, height: 40, origin: { x: 10, y: 20 } });
    assert.equal(manifest.assets["3"].frames.length, 2);
    assert.deepEqual(manifest.assets["3"].frames.map((f) => f.file), ["svg/sprites/3.svg", "svg/sprites/3_f2.svg"]);
    assert.deepEqual(manifest.assets["4"], { id: 4, kind: "image", names: ["tex"], file: "images/4.png", width: 1, height: 1 });
    assert.equal(manifest.source.ffdec.version, "9.9.9");
    assert.equal(manifest.source.swf.compression, "zlib");
    assert.match(manifest.source.swf.sha256, /^[0-9a-f]{64}$/);
    assert.ok(files.has("manifest.json") && files.has("svg/shapes/1.svg") && files.has("images/4.png"));
    assert.doesNotMatch(files.get("svg/sprites/3.svg").toString(), /ffdec/);
    assert.equal(log.length, 1);
    assert.ok(log[0].includes("-selectid") && !log[0].includes("-select"), "all frames requested by default");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("extraction is deterministic: identical inputs give byte-identical bundles", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ex-"));
  try {
    const swfPath = await swfFile(dir);
    const a = await extractAssets({ swfPath, jar: "x", runner: fakeFfdec([]) });
    const c = await extractAssets({ swfPath, jar: "x", runner: fakeFfdec([]) });
    const pa = packBundle(a.files), pc = packBundle(c.files);
    assert.equal(pa.sha256, pc.sha256);
    assert.match(bundleFileName(a.manifest), /^tfm-assets-v1-[0-9a-f]{12}\.tar\.gz$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("filters: scope=all includes anonymous, match/ids narrow, chunking splits FFDec calls, frames=first limits animated sprites", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ex-"));
  try {
    const swfPath = await swfFile(dir);
    const all = await extractAssets({ swfPath, jar: "x", scope: "all", runner: fakeFfdec([]) });
    assert.ok(all.manifest.assets["5"]);
    const only = await extractAssets({ swfPath, jar: "x", match: /^tree/, runner: fakeFfdec([]) });
    assert.deepEqual(Object.keys(only.manifest.assets), ["3"]);
    const byId = await extractAssets({ swfPath, jar: "x", ids: [2], runner: fakeFfdec([]) });
    assert.deepEqual(Object.keys(byId.manifest.assets), ["2"]);
    const log = [];
    await extractAssets({ swfPath, jar: "x", chunkSize: 2, frames: "first", runner: fakeFfdec(log) });
    assert.equal(log.length, 2);
    const withSelect = log.find((a) => a.includes("-select"));
    assert.equal(withSelect[withSelect.indexOf("-select") + 1], "3:1");
    await assert.rejects(extractAssets({ swfPath, jar: "x", match: /nomatch/, runner: fakeFfdec([]) }), /nothing to extract/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("missing FFDec output is reported as a warning, not silently dropped", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ex-"));
  try {
    const runner = async ({ args }) => { const out = args[args.length - 2]; await mkdir(path.join(out, "shapes"), { recursive: true }); await writeFile(path.join(out, "shapes", "1_Marker.svg"), SHAPE_1); return {}; };
    const { manifest } = await extractAssets({ swfPath: await swfFile(dir), jar: "x", runner });
    assert.ok(manifest.warnings.includes("not-exported:2"));
    assert.ok(manifest.warnings.includes("not-exported:3"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a broken SVG becomes a warning and the rest of the bundle survives", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ex-"));
  try {
    const runner = async ({ args }) => { const out = args[args.length - 2]; await mkdir(path.join(out, "shapes"), { recursive: true }); await writeFile(path.join(out, "shapes", "1_Marker.svg"), SHAPE_1); await writeFile(path.join(out, "shapes", "2_ground_green.svg"), "<html/>"); return {}; };
    const { manifest } = await extractAssets({ swfPath: await swfFile(dir), jar: "x", ids: [1, 2], runner });
    assert.deepEqual(Object.keys(manifest.assets), ["1"]);
    assert.ok(manifest.warnings.some((w) => w.startsWith("svg-normalize-failed:2:1")));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("AssetBundle loads from directory and tar.gz identically and resolves by id or symbol", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ex-"));
  try {
    const { files } = await extractAssets({ swfPath: await swfFile(dir), jar: "x", runner: fakeFfdec([]) });
    const out = path.join(dir, "bundle");
    await writeBundleDirectory(out, files);
    const fromDir = await AssetBundle.fromDirectory(out);
    const fromTar = AssetBundle.fromTarGz(packBundle(files).data);
    for (const bundle of [fromDir, fromTar]) {
      assert.equal(bundle.has("Marker"), true);
      assert.equal(bundle.has(1), true);
      assert.equal(bundle.has("1"), true);
      assert.equal(bundle.has("nope"), false);
      const v = bundle.vector("tree_a");
      assert.deepEqual(v.origin, { x: 5, y: 20 });
      assert.deepEqual(v.bounds, { x: -5, y: -20, width: 55, height: 40 });
      assert.match(v.defs, /id="a3f1_shape0"/);
      assert.equal(bundle.vector("tree_a", 2).bounds.height, 50);
      assert.equal(bundle.vector("tree_a", 99).bounds.height, 50, "frame numbers clamp to the last frame");
      assert.equal(bundle.vector("tex"), null, "images are not vectors");
      assert.deepEqual(bundle.image("tex").bytes, PNG_1X1);
      assert.equal(bundle.image("Marker"), null);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("bundles without a valid manifest are rejected", () => {
  assert.throws(() => new AssetBundle(new Map()), /no manifest/);
  assert.throws(() => new AssetBundle(new Map([["manifest.json", Buffer.from('{"format":"x"}')]])), /format/);
  assert.throws(() => packBundle(new Map()), /manifest/);
});

// --- Real FFDec integration (skipped unless a jar + Java are available) -------------------------
const realJar = process.env.TFM_FFDEC_JAR && existsSync(process.env.TFM_FFDEC_JAR) ? process.env.TFM_FFDEC_JAR : null;
let javaOk = false;
if (realJar) { try { javaOk = (await detectJava()).major >= 8; } catch { javaOk = false; } }

test("real FFDec: extraction of a synthetic SWF yields correct origins, sizes and symbol names", { skip: !(realJar && javaOk) && "set TFM_FFDEC_JAR to an ffdec-cli.jar and install Java" }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ex-real-"));
  try {
    const { manifest, files } = await extractAssets({ swfPath: await swfFile(dir), jar: realJar, ffdecVersion: "real" });
    assert.deepEqual(manifest.warnings, []);
    assert.deepEqual(manifest.assets["1"].frames[0].origin, { x: 10, y: 20 });
    assert.deepEqual([manifest.assets["1"].frames[0].width, manifest.assets["1"].frames[0].height], [20, 40]);
    assert.deepEqual(manifest.assets["2"].frames[0].origin, { x: 0, y: 0 });
    assert.equal(manifest.assets["3"].frames.length, 2, "2-frame sprite exports two frames");
    assert.deepEqual(manifest.assets["3"].frames[0].origin, { x: 5, y: 20 });
    assert.equal(manifest.assets["4"].kind, "image");
    assert.deepEqual([manifest.assets["4"].width, manifest.assets["4"].height], [4, 4]);
    assert.equal(manifest.symbols.tree_a, 3);
    const bundle = new AssetBundle(files);
    assert.deepEqual(bundle.vector("Marker").bounds, { x: -10, y: -20, width: 20, height: 40 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("real FFDec: frames=first with per-character -select works on 26.3.0", { skip: !(realJar && javaOk) && "set TFM_FFDEC_JAR to an ffdec-cli.jar and install Java" }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ex-real-"));
  try {
    const { manifest } = await extractAssets({ swfPath: await swfFile(dir), jar: realJar, frames: "first" });
    assert.equal(manifest.assets["3"].frames.length, 1);
    void stat;
  } finally { await rm(dir, { recursive: true, force: true }); }
});
