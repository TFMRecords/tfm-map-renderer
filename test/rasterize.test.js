// The rasterizer pool (src/server/rasterize.js): resvg in child processes, so a resvg crash costs one picture, not the server.
// Needs the optional @resvg/resvg-js; skipped without it.
import test from "node:test";
import assert from "node:assert/strict";
import { createResvgRasterizer, RasterizerCrashError } from "../src/server/rasterize.js";
import { createRenderService } from "../src/server/render-service.js";

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
    assert.deepEqual(rasterizer.status, { processes: 2, busy: 0, queued: 0 });
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
  await assert.rejects(createResvgRasterizer({ processes: -1 }), TypeError);
});
