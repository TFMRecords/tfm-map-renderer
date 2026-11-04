// The rasterizer pool (src/server/rasterize.js): resvg in child processes, so a resvg crash costs one picture, not the server.
// Needs the optional @resvg/resvg-js; skipped without it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createResvgRasterizer, RasterizerCrashError } from "../src/server/rasterize.js";
import { createRenderService } from "../src/server/render-service.js";
import { decodePng } from "../src/util/png.js";

const hasResvg = await import("@resvg/resvg-js").then(() => true, () => false);
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" viewBox="0 0 80 40">${body}</svg>`;
const OK = svg('<rect width="80" height="40" fill="red"/>');
// A group with opacity far outside the canvas: resvg 2.6 panics on it (an abort, not an exception; docs/rendering.md#culling).
const PANIC = svg('<g transform="translate(5000 0)"><g opacity="0.5"><rect width="40" height="40"/></g></g>');

test("the pool draws pictures and survives a resvg crash", { skip: !hasResvg }, async () => {
  const rasterizer = await createResvgRasterizer({ processes: 2 });
  try {
    assert.equal(rasterizer.processes, 2);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => rasterizer.rasterize(OK, { width: 80 })));
    for (const r of results) assert.deepEqual([r.width, r.height, r.png.subarray(1, 4).toString()], [80, 40, "PNG"]);
    // When resvg panics the job fails with a RasterizerCrashError; either way the pool keeps working.
    const crashed = await rasterizer.rasterize(PANIC, { width: 80 }).then(() => null, (error) => error);
    if (crashed) assert.ok(crashed instanceof RasterizerCrashError, crashed.message);
    const after = await Promise.all([1, 2, 3].map(() => rasterizer.rasterize(OK, { width: 160 })));
    for (const r of after) assert.equal(r.width, 160);
    const { memoryMB, ...status } = rasterizer.status;
    assert.deepEqual(status, { processes: 2, busy: 0, queued: 0, retries: 0 });
    assert.ok(memoryMB.length === 2 && memoryMB.some((mb) => mb > 0));
  } finally {
    rasterizer.close();
  }
});

const dataUri = (text) => `data:image/svg+xml;base64,${Buffer.from(text).toString("base64")}`;
const scene = (children) => ({ type: "svg", width: 80, height: 40, viewBox: "0 0 80 40", children });

test("the pool draws scenes with the compositor, stretched to the asked size", { skip: !hasResvg }, async () => {
  const rasterizer = await createResvgRasterizer({ processes: 1 });
  try {
    const picture = { type: "image", href: dataUri(OK), x: 0, y: 0, width: 40, height: 20 };
    const result = await rasterizer.renderScene(scene([picture, { ...picture, x: 40, y: 20 }]), { width: 160, height: 40 });
    assert.deepEqual([result.width, result.height, result.renderer], [160, 40, "compositor"]);
    const image = decodePng(result.png);
    const at = (x, y) => [...image.data.slice((y * 160 + x) * 4, (y * 160 + x) * 4 + 4)];
    assert.deepEqual([at(10, 5), at(120, 30), at(120, 5)], [[255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 0, 0]]);
    // What the compositor cannot draw (a curve) goes to resvg.
    const curve = await rasterizer.renderScene(scene([{ type: "path", d: "M0 0C40 40 40 0 80 40", stroke: "#000" }]), { width: 80, height: 40 });
    assert.deepEqual([curve.renderer, curve.unsupported], ["resvg", { "path curve": 1 }]);
  } finally {
    rasterizer.close();
  }
});

test("a scene whose process crashed is drawn once more with whole pictures", { skip: !hasResvg }, async () => {
  const rasterizer = await createResvgRasterizer({ processes: 1 });
  try {
    const crashed = await rasterizer.renderScene(scene([{ type: "image", href: dataUri(PANIC), x: 0, y: 0, width: 80, height: 40 }]), { width: 80, height: 40 }).then(() => null, (error) => error);
    // A picture that panics resvg whole as well: two tries, then the crash error.
    if (crashed) {
      assert.ok(crashed instanceof RasterizerCrashError, crashed.message);
      assert.equal(rasterizer.status.retries, 1);
    }
    assert.equal((await rasterizer.renderScene(scene([]), { width: 8, height: 4 })).width, 8);
  } finally {
    rasterizer.close();
  }
});

test("aborting a picture rejects it and frees its process", { skip: !hasResvg }, async () => {
  const rasterizer = await createResvgRasterizer({ processes: 1 });
  try {
    const controller = new AbortController();
    const reason = new Error("stop");
    const running = rasterizer.rasterize(OK, { width: 80, signal: controller.signal });
    const queued = rasterizer.rasterize(OK, { width: 80, signal: controller.signal });
    controller.abort(reason);
    await Promise.all([assert.rejects(running, (error) => error === reason), assert.rejects(queued, (error) => error === reason)]);
    assert.equal((await rasterizer.rasterize(OK, { width: 40 })).width, 40);
  } finally {
    rasterizer.close();
  }
});

test("a crash is answered with 422 by the render service", async () => {
  const rasterizer = { name: "fake", async rasterize() { throw new RasterizerCrashError("the rasterizer crashed on this picture"); } };
  const service = createRenderService({ rasterizer });
  await assert.rejects(service.render({ xml: "<C><P/><Z><S/><D/><O/></Z></C>" }), (error) => error.status === 422 && /crashed/.test(error.message));
});

test("processes: 0 rasterizes in this process", { skip: !hasResvg }, async () => {
  const rasterizer = await createResvgRasterizer({ processes: 0 });
  assert.equal(rasterizer.processes, 0);
  assert.equal((await rasterizer.rasterize(OK, { width: 80 })).height, 40);
  assert.equal((await rasterizer.renderScene(scene([{ type: "image", href: dataUri(OK), x: 0, y: 0, width: 80, height: 40 }]), { width: 80, height: 40 })).renderer, "compositor");
  await assert.rejects(createResvgRasterizer({ processes: -1 }), TypeError);
});

test("the render service draws with the renderer a request or the server picks", async () => {
  const calls = [];
  const rasterizer = {
    name: "resvg",
    async rasterize(svg, { width, height }) { calls.push("resvg"); return { png: Buffer.alloc(0), width, height }; },
    async renderScene(scene, { width, height }) { calls.push(scene.type); return { png: Buffer.alloc(0), width, height, renderer: "compositor" }; },
  };
  const xml = "<C><P/><Z><S/><D/><O/></Z></C>";
  const service = createRenderService({ rasterizer, cacheEntries: 0 });
  assert.equal((await service.render({ xml })).backend, "resvg");
  const composed = await service.render({ xml, renderer: "compositor" });
  assert.equal(composed.backend, "compositor");
  assert.equal(composed.svg, undefined);
  assert.match((await service.render({ xml, renderer: "compositor", svg: true })).svg, /^<svg/);
  assert.deepEqual(calls, ["resvg", "svg", "svg"]);
  await assert.rejects(service.render({ xml, renderer: "cairo" }), (error) => error.status === 400);
  assert.equal((await createRenderService({ rasterizer, renderer: "compositor" }).render({ xml })).backend, "compositor");
  const plain = { name: "fake", async rasterize(svg, { width, height }) { return { png: Buffer.alloc(0), width, height }; } };
  assert.throws(() => createRenderService({ rasterizer: plain, renderer: "compositor" }), TypeError);
  await assert.rejects(createRenderService({ rasterizer: plain }).render({ xml, renderer: "compositor" }), (error) => error.status === 400);
});

test("with the pool: a map drawn by the compositor through the service is close to resvg's", { skip: !hasResvg }, async () => {
  const rasterizer = await createResvgRasterizer({ processes: 1 });
  try {
    const xml = readFileSync(new URL("./maps/mirrored-4.xml", import.meta.url), "utf8");
    const service = createRenderService({ rasterizer, cacheEntries: 0 });
    const [a, b] = await Promise.all(["resvg", "compositor"].map((renderer) => service.render({ xml, renderer, width: 400, height: 300, options: { rotation: 10 } })));
    assert.deepEqual([b.backend, b.width, b.height], ["compositor", 400, 300]);
    const [ia, ib] = [decodePng(a.png), decodePng(b.png)];
    let off = 0;
    for (let i = 0; i < ia.data.length; i += 4) if (Math.max(...[0, 1, 2, 3].map((c) => Math.abs(ia.data[i + c] - ib.data[i + c]))) > 48) off++;
    assert.ok(off / (400 * 300) < 0.01, `${off} pixels differ`);
  } finally {
    rasterizer.close();
  }
});
