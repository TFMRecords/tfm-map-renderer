import test from "node:test";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { createRenderService, parseOptions, RequestError } from "../src/server/render-service.js";
import { createRenderServer } from "../src/server/http.js";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const fakeRasterizer = { name: "fake", async rasterize(svg, width) { return { png: PNG, width, height: width / 2 }; } };
const XML = '<C><P L="800" H="400"/><Z><S><S L="100" H="50" X="400" Y="350" T="0" P="0,0,0.3,0.2,0,0,0,0"/></S></Z></C>';

test("parseOptions accepts shorthands and aliases, rejects unknown", () => {
  assert.equal(parseOptions({ mirror: true }).mirrorX, true);
  assert.equal(parseOptions({ options: { minimalist: true } }).minimalist, true);
  assert.throws(() => parseOptions({ options: { nope: 1 } }), RequestError);
});

test("service renders and validates", async () => {
  const service = createRenderService({ rasterizer: fakeRasterizer });
  const r = await service.render({ xml: XML, width: 400 });
  assert.equal(r.png, PNG);
  await assert.rejects(service.render({ xml: XML, width: 0 }), RequestError);
  await assert.rejects(service.render({}), RequestError);
});

test("defaultOptions apply unless the request sets the option, and are checked", async () => {
  const seen = [];
  const rasterizer = { name: "fake", async rasterize(svg, { width, height }) { seen.push(svg); return { png: PNG, width, height }; } };
  const xml = '<C><P/><Z><S/><D><DS X="100" Y="100"/></D><O/></Z></C>';
  const circles = (await createRenderService({ rasterizer }).render({ xml, svg: true })).svg;
  const none = createRenderService({ rasterizer, defaultOptions: { spawnMarkers: "none" } });
  assert.notEqual((await none.render({ xml, svg: true })).svg, circles);
  assert.equal((await none.render({ xml, svg: true, spawnMarkers: "circles" })).svg, circles);
  assert.equal((await none.render({ xml, svg: true, options: { spawnMarkers: "circles" } })).svg, circles);
  assert.throws(() => createRenderService({ rasterizer, defaultOptions: { spawnMarkers: "bogus" } }), RequestError);
  assert.throws(() => createRenderService({ rasterizer, defaultOptions: { nope: 1 } }), RequestError);
});

test("http returns JSON base64 and raw png", async () => {
  const server = createRenderServer(createRenderService({ rasterizer: fakeRasterizer }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const j = await (await fetch(base, { method: "POST", body: JSON.stringify({ xml: XML }) })).json();
    assert.equal(j.mimeType, "image/png");
    assert.deepEqual(Buffer.from(j.image, "base64"), PNG);
    const raw = await fetch(base, { method: "POST", body: JSON.stringify({ xml: XML, raw: true }) });
    assert.equal(raw.headers.get("content-type"), "image/png");
    assert.equal((await fetch(base, { method: "POST", body: "{" })).status, 400);
    assert.equal((await fetch(base + "/health")).status, 200);
  } finally { server.close(); }
});

import { shareSvgAssets } from "../src/render/share-assets.js";

const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const asset = (id) => `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><defs><g id="${id}"><path d="M0 0h10v10z"/></g></defs><use href="#${id}"/></svg>`;

test("shareSvgAssets moves repeated SVG assets into defs once and keeps ids apart", () => {
  const a = dataUri(asset("shape0")), b = dataUri(asset("shape0").replace("M0 0", "M1 1"));
  const out = shareSvgAssets(`<svg width="20" height="10"><image href="${a}" x="0" y="0" width="10" height="10"/><image href="${a}" x="10" y="0" width="10" height="10" preserveAspectRatio="none"/><image href="${a}" x="5" y="5" width="10" height="10"/><image href="${b}" x="0" y="0" width="10" height="10"/></svg>`);
  assert.equal((out.match(/<use href="#s\d+" x=/g) ?? []).length, 4);
  assert.equal((out.match(/<svg id="s\d+"/g) ?? []).length, 3); // a, a with preserveAspectRatio, b
  assert.ok(out.includes('id="s0_shape0"') && out.includes('id="s2_shape0"'));
  assert.ok(!out.includes("<image"));
});

test("shareSvgAssets leaves filtered, styled, sizeless and raster images alone", () => {
  const filtered = dataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><filter id="f"/><rect filter="url(#f)"/></svg>`);
  const input = `<svg><image href="${filtered}" x="0" y="0" width="1" height="1"/><image href="${dataUri(asset("a"))}" width="1"/><image href="${dataUri(asset("a"))}" x="0" y="0" width="1" height="1" style="opacity:.5"/><image href="data:image/png;base64,AAAA" x="0" y="0" width="1" height="1"/></svg>`;
  assert.equal(shareSvgAssets(input), input);
});

test("service caches identical requests", async () => {
  let calls = 0;
  const service = createRenderService({ rasterizer: { name: "fake", async rasterize(svg, { width }) { calls++; return { png: PNG, width, height: 1 }; } } });
  await service.render({ xml: XML });
  const again = await service.render({ xml: XML });
  assert.equal(again.cached, true);
  await service.render({ xml: XML, mirror: true });
  assert.equal(calls, 2);
});

test("the test page is served at /test and to browsers at /, plain usage text otherwise", async () => {
  const server = createRenderServer(createRenderService({ rasterizer: fakeRasterizer }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base + "/test");
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /<textarea id="xml"/);
    assert.match(await (await fetch(base, { headers: { accept: "text/html" } })).text(), /<!doctype html>/);
    assert.match(await (await fetch(base)).text(), /^tfm-render-server/);
  } finally { server.close(); }
});

import { spawnSync } from "node:child_process";

test("CLI entry points load (usage text) and reject stray arguments clearly", () => {
  const help = spawnSync(process.execPath, ["bin/tfm-assets.mjs", "--help"], { encoding: "utf8" });
  assert.match(help.stdout, /--out defaults to \.assets\/release/);
  const bad = spawnSync(process.execPath, ["bin/tfm-render-server.mjs", "oops"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unexpected argument oops \(try: node bin\/tfm-render-server\.mjs --port 3000\)/);
});

import { readFile } from "node:fs/promises";
import { ALLOWED_OPTIONS } from "../src/server/render-service.js";

const RENDERER_DOC = new URL("../docs/api/renderer.md", import.meta.url);

test("every option the server accepts is documented in docs/api/renderer.md", { skip: !existsSync(RENDERER_DOC) && "docs/api/renderer.md is not written yet (phase 3)" }, async () => {
  const doc = await readFile(RENDERER_DOC, "utf8");
  const missing = Object.keys(ALLOWED_OPTIONS).filter((name) => !doc.includes(`\`${name}\``) && !doc.includes(`\`${name} `) && !new RegExp(`\`[^\`]*\\b${name}\\b[^\`]*\``).test(doc));
  assert.deepEqual(missing, [], "options missing from the Options table in docs/api/renderer.md");
});

test("rasterize: false answers the SVG only, and needs svg: true", async () => {
  let calls = 0;
  const rasterizer = { name: "fake", async rasterize(svg, { width, height }) { calls++; return { png: PNG, width, height }; } };
  const service = createRenderService({ rasterizer });
  const r = await service.render({ xml: XML, svg: true, rasterize: false });
  assert.equal(calls, 0);
  assert.equal(r.png, undefined);
  assert.match(r.svg, /^<svg /);
  assert.deepEqual([r.width, r.height, r.backend], [800, 400, "svg"]);
  // No pixels, so no output size limit: a map far above 16384 still gives its SVG.
  const huge = await service.render({ xml: '<C><P L="8000000" H="4000000"/><Z><S/><D/><O/></Z></C>', svg: true, rasterize: false });
  assert.deepEqual([huge.width, huge.height], [8000000, 4000000]);
  await assert.rejects(service.render({ xml: XML, rasterize: false }), /needs "svg": true/);
  await assert.rejects(service.render({ xml: XML, svg: true, rasterize: "no" }), /true or false/);
});

test("http: a failed raster keeps its error status, with the SVG when svg: true", async () => {
  const rasterizer = { name: "fake", async rasterize() { throw new RequestError("the rasterizer crashed on this picture", 422); } };
  const server = createRenderServer(createRenderService({ rasterizer, cacheEntries: 0 }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const post = (body) => fetch(`http://127.0.0.1:${server.address().port}/render`, { method: "POST", body: JSON.stringify({ xml: XML, ...body }) });
  try {
    const plain = await post({});
    assert.equal(plain.status, 422);
    assert.deepEqual(Object.keys(await plain.json()), ["error"]);
    const json = await post({ svg: true });
    assert.equal(json.status, 422);
    const body = await json.json();
    assert.match(body.error, /crashed/);
    assert.match(body.svg, /^<svg /);
    assert.ok(Array.isArray(body.warnings));
    const raw = await post({ svg: true, raw: true });
    assert.equal(raw.status, 422);
    assert.match(raw.headers.get("content-type"), /^image\/svg\+xml/);
    assert.match(raw.headers.get("x-render-error"), /crashed/);
    assert.match(await raw.text(), /^<svg /);
    const svgOnly = await post({ svg: true, rasterize: false, raw: true });
    assert.equal(svgOnly.status, 200);
    assert.match(svgOnly.headers.get("content-type"), /^image\/svg\+xml/);
    const svgJson = await (await post({ svg: true, rasterize: false })).json();
    assert.equal(svgJson.image, undefined);
    assert.match(svgJson.svg, /^<svg /);
  } finally {
    server.close();
  }
});
