import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as b from "../test-support/swf-builder.js";
import { buildRelease, loadRelease, RELEASE_SOURCES, createLayeredResolver, orderBundles, BUNDLE_PRECEDENCE, CLIENT_BUNDLE_PRECEDENCE } from "../src/assets/release.js";
import { AssetBundle } from "../src/assets/bundle.js";

test("a release has one bundle per source and loads back into a layered resolver", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tfm-release-"));
  const swf = b.buildSwf([b.defineShapeRect(1, 0, 0, 100, 100), b.symbolClass([[1, "$F_3"]])], { compress: true });
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => swf.buffer.slice(swf.byteOffset, swf.byteOffset + swf.length) });
  // The synthetic SWF is not a loader, so only the plain-SWF sources can be built; extraction is faked (no Java in unit tests).
  const only = RELEASE_SOURCES.filter((s) => !s.embedded).map((s) => s.name);
  const extract = async ({ swfPath }) => {
    assert.ok((await readFile(swfPath)).length > 0);
    return fakeBundle();
  };
  const index = await buildRelease({ outDir: path.join(dir, "out"), workDir: path.join(dir, "work"), only, fetchImpl, extract });
  assert.deepEqual(index.bundles.map((x) => x.name), only);
  const release = await loadRelease(path.join(dir, "out"));
  assert.equal(release.bundles.size, only.length);
  assert.ok(release.resolver.resolve({ key: "$F_3" }));
  assert.equal(release.resolver.resolve({ key: "$Missing" }), null);
});

test("an embedded source that is missing is reported by name", async () => {
  const swf = b.buildSwf([b.defineShapeRect(1, 0, 0, 10, 10)], {});
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => swf.buffer.slice(swf.byteOffset, swf.byteOffset + swf.length) });
  await assert.rejects(
    buildRelease({ outDir: "x", workDir: "y", only: ["game-resources"], fetchImpl, extract: async () => fakeBundle() }),
    /DoABC|no embedded SWF/,
  );
});

test("createLayeredResolver asks each bundle in turn", () => {
  const a = new AssetBundle(fakeBundle().files);
  const resolver = createLayeredResolver([a]);
  assert.equal(resolver.resolve({ key: "nothing" }), null);
});

// A genuine (valid) bundle without Java: one shape named $F_3.
function fakeBundle() {
  const files = new Map();
  files.set("svg/shapes/1.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><path d="M0 0H100V100H0Z"/></svg>'));
  const manifest = {
    format: "tfm-assets", version: 1, source: { swf: { name: "x.swf", sha256: "0".repeat(64), size: 1 } }, extractor: { version: "test", ffdec: "test" },
    assets: { 1: { id: 1, kind: "shape", names: ["$F_3"], frames: [{ file: "svg/shapes/1.svg", width: 100, height: 100, origin: { x: 0, y: 0 } }] } },
    symbols: { $F_3: 1 }, warnings: [],
  };
  files.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
  return { manifest, files };
}

test("bundle precedence: the everyday look puts game-fla first, the client code's order puts game-resources first and game-fla last", () => {
  const names = ["pictos", "game-fla", "shaman-items", "game-resources"];
  assert.deepEqual(orderBundles(names, BUNDLE_PRECEDENCE), ["game-fla", "game-resources", "pictos", "shaman-items"]);
  assert.deepEqual(orderBundles(names, CLIENT_BUNDLE_PRECEDENCE), ["game-resources", "shaman-items", "pictos", "game-fla"]);
  assert.deepEqual(orderBundles(["x", "game-fla"], ["game-fla"]), ["game-fla", "x"]);
});
