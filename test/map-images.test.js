// Map images in the PNG server (docs/api/http.md#map-images), with a fake network.
import test from "node:test";
import assert from "node:assert/strict";
import { createMapImageFetcher } from "../src/server/map-images.js";
import { createRenderService } from "../src/server/render-service.js";
import { encodePng } from "../src/util/png.js";

const PNG = encodePng({ width: 3, height: 2, data: new Uint8Array(3 * 2 * 4).fill(255) });
const rasterizer = { name: "stub", rasterize: async (svg, { width, height }) => ({ png: Buffer.from(svg), width, height }) };

function network(files = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const body = files[url];
    if (!body) return { ok: false, status: 404, url, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, url, headers: new Map(), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) };
  };
  return { calls, fetchImpl };
}
const service = (net, config = {}) => createRenderService({ rasterizer, mapImages: createMapImageFetcher({ fetchImpl: net.fetchImpl, ...config }), cacheEntries: 0 });
const map = (settings = "", grounds = "") => `<C><P ${settings}/><Z><S>${grounds}</S><D/><O/></Z></C>`;

test("map images are fetched from the official host and embedded with their size", async () => {
  const net = network({ "https://www.transformice.com/images/a.png": PNG });
  const result = await service(net).render({ xml: map(`D="a.png,10,20"`), svg: true });
  assert.deepEqual(net.calls, ["https://www.transformice.com/images/a.png"]);
  assert.match(result.svg, /<image href="data:image\/png;base64,[^"]+" x="10" y="20" width="3" height="2"/);
  assert.deepEqual(result.mapImages, { requested: 1, loaded: 1, missing: 0 });
});

test("each URL is downloaded once and then served from the cache", async () => {
  const net = network({ "https://www.transformice.com/images/a.png": PNG });
  const s = service(net);
  await s.render({ xml: map(`D="a.png,0,0" d="a.png,5,5"`) });
  await s.render({ xml: map(`D="a.png,1,1"`), width: 400 });
  assert.equal(net.calls.length, 1);
});

test("a bare name.ext in APS uses images.atelier801.com; ARPS is fetched only when drawn", async () => {
  const net = network({ "https://images.atelier801.com/b.png": PNG });
  const s = service(net);
  await s.render({ xml: map(`APS="b.png,0,0,0,10,10,0,0" ARPS="c.png,0,0,0,10,10,0,0"`) });
  assert.deepEqual(net.calls, ["https://images.atelier801.com/b.png"]);
  await s.render({ xml: map(`ARPS="c.png,0,0,0,10,10,0,0"`), options: { renderAppearingImages: true } });
  assert.equal(net.calls.at(-1), "https://images.atelier801.com/c.png");
});

test("absolute URLs follow the game's rules and the host check", async () => {
  const ground = (url) => `<S T="0" X="100" Y="100" L="50" H="50" i="0,0,${url}"/>`;
  const net = network({ "http://example.org/x.png": PNG, "http://images.atelier801.com/y.png": PNG });
  await service(net).render({ xml: map(`D="http://example.org/x.png,0,0"`) });
  assert.deepEqual(net.calls, [], "D cannot load an absolute URL in the game");
  await service(net).render({ xml: map("", ground("http://example.org/x.png")) });
  assert.deepEqual(net.calls, [], "another host only with allowUnofficial");
  await service(net).render({ xml: map("", ground("http://images.atelier801.com/y.png")) });
  assert.deepEqual(net.calls, ["http://images.atelier801.com/y.png"]);
  await service(net, { allowUnofficial: true }).render({ xml: map("", ground("http://example.org/x.png")) });
  assert.equal(net.calls.at(-1), "http://example.org/x.png");
});

test("a missing, oversized or non-image file is skipped with a warning", async () => {
  const net = network({ "https://www.transformice.com/images/text.png": Buffer.from("not an image"), "https://www.transformice.com/images/big.png": PNG });
  const result = await service(net, { maxBytes: 10 }).render({ xml: map(`D="gone.png,0,0;text.png,0,0;big.png,0,0"`), svg: true });
  assert.deepEqual(result.mapImages, { requested: 3, loaded: 0, missing: 3 });
  assert.deepEqual(result.warnings.at(-1), { code: "map-image-unavailable", severity: "info", count: 3 });
  assert.doesNotMatch(result.svg, /<image/);
});

test("a request can turn map images off, and without a fetcher none are drawn", async () => {
  const net = network({ "https://www.transformice.com/images/a.png": PNG });
  const off = await service(net).render({ xml: map(`D="a.png,0,0"`), mapImages: false, svg: true });
  assert.deepEqual(net.calls, []);
  assert.equal(off.mapImages, undefined);
  const plain = await createRenderService({ rasterizer }).render({ xml: map(`D="a.png,0,0"`), svg: true });
  assert.doesNotMatch(plain.svg, /<image/);
});
