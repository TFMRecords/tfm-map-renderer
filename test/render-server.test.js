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
