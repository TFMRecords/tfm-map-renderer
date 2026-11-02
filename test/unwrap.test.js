import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import * as b from "../test-support/swf-builder.js";
import { isLoaderSwf, unwrapLoaderSwf } from "../src/swf/unwrap.js";
import { readSwf } from "../src/swf/reader.js";

test("a plain SWF is not a loader and cannot be unwrapped", () => {
  const swf = b.buildSwf([b.defineShapeRect(1, 0, 0, 100, 100)], {});
  assert.equal(isLoaderSwf(swf), false);
  assert.throws(() => unwrapLoaderSwf(swf), /DoABC/);
});

// Needs the real https://www.transformice.com/Transformice.swf (not committed): TFM_LOADER_SWF=path
const loaderPath = process.env.TFM_LOADER_SWF;
test("the real loader unwraps to a readable game SWF", { skip: !loaderPath || !existsSync(loaderPath) }, () => {
  const loader = readFileSync(loaderPath);
  assert.equal(isLoaderSwf(loader), true);
  const { swf, order } = unwrapLoaderSwf(loader);
  assert.equal(order.length, 12);
  assert.equal(new Set(order).size, 12);
  assert.ok(readSwf(swf).symbols.length > 0);
});
