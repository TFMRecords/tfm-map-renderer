import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  parseTfmMap,
  renderTfmSvg,
  IMAGE_BASES,
  isAtelier801BareImageName,
  resolveTfmImageUrl,
  classifyImageReference,
} from "../src/index.js";
import {
  buildFfdecExportArgs,
  exportFfdecAssets,
  createFilesystemAssetResolver,
  createMemoryAssetResolver,
  createTfmImageResolver,
  scanAssetDirectory,
  writeAssetManifest,
} from "../src/node.js";

const ONE_BY_ONE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScXQWQAAAABJRU5ErkJggg==", "base64");


test("the bare-name pattern matches only bare alphanumeric filename plus alphabetic extension", () => {
  assert.equal(isAtelier801BareImageName("foo.png"), true);
  assert.equal(isAtelier801BareImageName("FOO.PNG"), true);
  assert.equal(isAtelier801BareImageName("foo-bar.png"), false);
  assert.equal(isAtelier801BareImageName("x_transformice/foo.png"), false);
  assert.equal(isAtelier801BareImageName("foo.png?x=1"), false);
  assert.equal(isAtelier801BareImageName("foo.png/other"), false);
});

test("image URL bases follow the standard and bare-name rules", () => {
  assert.equal(resolveTfmImageUrl("foo.png", "bare-name"), `${IMAGE_BASES.atelier801}foo.png`);
  assert.equal(resolveTfmImageUrl("x_transformice/foo.png", "bare-name"), `${IMAGE_BASES.transformice}x_transformice/foo.png`);
  assert.equal(resolveTfmImageUrl("foo.png", "standard"), `${IMAGE_BASES.transformice}foo.png`);
  assert.equal(classifyImageReference("foo.png", "bare-name").rule, "bare-name");
  assert.equal(classifyImageReference("foo.png", "standard").rule, "default-base");
});

test("FFDec extraction command uses documented image/shape export modes", () => {
  const args = buildFfdecExportArgs({ input: "game.swf", outputDir: "assets" });
  assert.deepEqual(args.slice(0, 5), ["-cli", "-format", "shape:svg", "-export", "image,shape"]);
  assert.equal(basename(args.at(-1)) === "game.swf", true);
  assert.equal(basename(args.at(-2)) === "assets", true);
});

test("FFDec adapter invokes a configured executable without shell interpolation", { skip: process.platform === "win32" && "the fake executable is a POSIX shell script" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "tfm-ffdec-"));
  try {
    const fake = join(root, "ffdec");
    const output = join(root, "out");
    const input = join(root, "game.swf");
    const argsFile = join(root, "args.txt");
    await writeFile(input, "fake");
    await writeFile(fake, `#!/bin/sh
printf '%s\n' "$@" > "${argsFile}"
mkdir -p "$6"
printf '<svg viewBox="0 0 2 3"></svg>' > "$6/fake.svg"
`);
    await chmod(fake, 0o755);

    const result = await exportFfdecAssets({ executable: fake, input, outputDir: output });
    assert.equal(result.executable, fake);
    const args = (await readFile(argsFile, "utf8")).trim().split("\n");
    assert.deepEqual(args.slice(0, 5), ["-cli", "-format", "shape:svg", "-export", "image,shape"]);
    assert.equal(args.at(-1), input);
    assert.equal(args.at(-2), output);
    assert.equal((await readFile(join(output, "fake.svg"), "utf8")).includes("viewBox"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("asset directory scan creates deterministic manifest metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "tfm-assets-"));
  try {
    await writeFile(join(root, "shape.svg"), `<svg viewBox="0 0 32 16"></svg>`);
    await writeFile(join(root, "image.png"), ONE_BY_ONE_PNG);
    const manifest = await scanAssetDirectory(root);
    assert.deepEqual(manifest.assets.map((a) => a.path), ["image.png", "shape.svg"]);
    assert.deepEqual(manifest.assets.find((a) => a.path === "shape.svg").dimensions, { width: 32, height: 16, viewBox: [0, 0, 32, 16] });
    assert.deepEqual(manifest.assets.find((a) => a.path === "image.png").dimensions, { width: 1, height: 1 });
    assert.deepEqual(manifest.assets.find((a) => a.path === "image.png").aliases, []);
    assert.match(manifest.assets[0].sha256, /^[0-9a-f]{64}$/);

    const manifestPath = join(root, "manifest.json");
    await writeAssetManifest(manifest, manifestPath);
    const written = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(written.version, 1);
    assert.equal(written.assets.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("filesystem and memory asset resolvers embed assets without network access", async () => {
  const root = await mkdtemp(join(tmpdir(), "tfm-assets-"));
  try {
    await writeFile(join(root, "foo.svg"), `<svg viewBox="0 0 10 20"></svg>`);
    const manifest = await scanAssetDirectory(root);
    const filesystem = createFilesystemAssetResolver(root, manifest);
    const local = filesystem.resolve({ source: "foo.svg" });
    assert.equal(local.href.startsWith("data:image/svg+xml;base64,"), true);
    assert.equal(local.dimensions.width, 10);

    const memory = createMemoryAssetResolver({ "foo.svg": { data: Buffer.from("svg").toString("base64"), mime: "image/svg+xml" } });
    assert.equal(memory.resolve({ source: "foo.svg" }).href, `data:image/svg+xml;base64,${Buffer.from("svg").toString("base64")}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Tfm image resolver refuses external resources by default", () => {
  const resolver = createTfmImageResolver();
  assert.equal(resolver.resolve({ source: "foo.png", kind: "bare-name" }), null);
  const external = createTfmImageResolver({ external: true });
  assert.equal(external.resolve({ source: "foo.png", kind: "bare-name" }).href, `${IMAGE_BASES.atelier801}foo.png`);
});

test("SVG renderer uses map defaults, source images and explicit mirror transform", () => {
  const map = parseTfmMap(`<C><P D="bg.svg,10,20,2,5" d="fg.svg,30,40" IP="ip.svg,50,60"/><Z><S><S T="0" X="1" Y="2" L="30" H="40" o="112233" i="0,0,ground.svg"/></S><D><T X="5" Y="6"/></D><O><O C="1" X="7" Y="8"/></O></Z></C>`);
  const resolver = createMemoryAssetResolver({
    "bg.svg": { data: Buffer.from("bg").toString("base64"), mime: "image/svg+xml" },
    "fg.svg": { data: Buffer.from("fg").toString("base64"), mime: "image/svg+xml" },
    "ip.svg": { data: Buffer.from("ip").toString("base64"), mime: "image/svg+xml" },
    "ground.svg": { data: Buffer.from("ground").toString("base64"), mime: "image/svg+xml" },
  });
  const svg = renderTfmSvg(map, { assetResolver: resolver, mirrorX: true, debugMarkers: true, borders: "map" });
  assert.match(svg, /viewBox="0 0 800 400"/);
  assert.match(svg, /transform="translate\(800 0\) scale\(-1 1\)"/);
  assert.equal((svg.match(/<image/g) ?? []).length, 5, "the IP image is not part of the picture at load time");
  assert.match(svg, /<rect x="0" y="0" width="800" height="400"/);
  assert.match(svg, /data-kind="T"/);
  assert.match(svg, /data-type="1"/);
});

test("SVG renderer draws grounds centred and rotated, with built-in placeholders when no assets exist", () => {
  const map = parseTfmMap(`<C><P/><Z><S><S T="12" X="100" Y="50" L="40" H="20" P="0,0,0.3,0.2,30,0,0,0" o="ff0000"/><S T="13" X="200" Y="60" L="15" H="1"/><S T="0" X="300" Y="70" L="10" H="10" m=""/></S><D><DS X="1" Y="2"/><F X="3" Y="4"/><T X="5" Y="6" CT="1"/></D><O/></Z></C>`);
  const svg = renderTfmSvg(map);
  assert.match(svg, /<g data-type="12" transform="translate\(100 50\) rotate\(30\)"><rect x="-20" y="-10" width="40" height="20" fill="#ff0000"\/>/);
  assert.match(svg, /<g data-type="13" transform="translate\(200 60\)"><circle r="15" fill="#ffffff"\/>/);
  assert.doesNotMatch(svg, /data-type="0"/, "an invisible (m) ground has no graphic");
  assert.match(svg, /data-role="mouse-spawn"/);
  assert.match(svg, /data-role="cheese"/);
  assert.match(svg, /data-role="hole"/);
  const bare = renderTfmSvg(map, { defaultAssets: false });
  assert.doesNotMatch(bare, /<rect|<circle|<ellipse/);
});

test("SVG renderer places the ground i image inside the rotated ground like the game", () => {
  const map = parseTfmMap(`<C><P/><Z><S><S T="12" X="100" Y="50" L="40" H="20" P="0,0,0.3,0.2,0,0,0,0" i="3,4,pic.png"/></S><D/><O/></Z></C>`);
  const resolver = createMemoryAssetResolver({ "pic.png": { data: "AA==", mime: "image/png" } });
  const svg = renderTfmSvg(map, { assetResolver: resolver, defaultAssets: false });
  assert.match(svg, /<g data-type="12" transform="translate\(100 50\)"><image href="data:image\/png;base64,AA==" x="-17" y="-6"\/>/);
});

test("SVG renderer tiles the tiled D bitmaps to the requested target dimensions", () => {
  const map = parseTfmMap(`<C><P D="#tile.svg,5,4"/><Z><S/><D/><O/></Z></C>`);
  const resolver = createMemoryAssetResolver({
    "tile.svg": {
      data: Buffer.from("tile").toString("base64"),
      mime: "image/svg+xml",
      width: 2,
      height: 2,
    },
  });
  assert.equal(renderTfmSvg(map, { assetResolver: resolver }).includes("tiled-0"), false, "tiled D backgrounds are off by default");
  const svg = renderTfmSvg(map, { assetResolver: resolver, renderTiledBackgrounds: true });
  assert.equal((svg.match(/href="data:image\/svg\+xml;base64,/g) ?? []).length, 6);
  assert.match(svg, /width="2" height="2"/);
  assert.match(svg, /width="5" height="4"/);
  assert.match(svg, /clip-path="url\(#tiled-0\)"/);
});

test("SVG renderer reproduces D/d repeat offsets including the client's d quirk", () => {
  const map = parseTfmMap(`<C><P D="bg.svg,10,20,2,5" d="fg.svg,30,40,2,7"/><Z><S/><D/><O/></Z></C>`);
  const resolver = createMemoryAssetResolver({
    "bg.svg": { data: Buffer.from("bg").toString("base64"), mime: "image/svg+xml" },
    "fg.svg": { data: Buffer.from("fg").toString("base64"), mime: "image/svg+xml" },
  });
  assert.equal(renderTfmSvg(map, { assetResolver: resolver }).includes("tiled-0"), false, "tiled D backgrounds are off by default");
  const svg = renderTfmSvg(map, { assetResolver: resolver, renderTiledBackgrounds: true });
  assert.equal((svg.match(/href="data:image\/svg\+xml;base64,/g) ?? []).length, 6);
  assert.match(svg, /x="15"/);
  assert.match(svg, /x="20"/);
  assert.match(svg, /x="35"/);
  assert.match(svg, /x="40"/);
  assert.equal(svg.includes('x="37"'), false);
});

test("in a mirrored map the repeat clones of D and d walk the other way inside the mirrored picture (they go right on screen)", () => {
  const map = parseTfmMap(`<C><P D="bg.svg,100,20,2,60"/><Z><S/><D/><O/></Z></C>`);
  const resolver = createMemoryAssetResolver({ "bg.svg": { data: Buffer.from("bg").toString("base64"), mime: "image/svg+xml", width: 10, height: 10 } });
  const xs = (options) => [...renderTfmSvg(map, { assetResolver: resolver, ...options }).matchAll(/<image[^>]* x="(-?\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(xs({}), [100, 160, 220]);
  assert.deepEqual(xs({ mirrorX: true }), [100, 40, -20]);
});
