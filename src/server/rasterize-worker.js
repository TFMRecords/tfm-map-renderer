// One child process of the rasterizer pool (rasterize.js), one job at a time: an SVG drawn by resvg, or a scene drawn by the PNG
// compositor (src/raster) with a picture cache that this child keeps between jobs. resvg runs here and not in the server, so a
// resvg panic (it aborts the process) ends only this child.
import { renderScenePng, createPictureCache, flattenScene } from "../raster/index.js";
import { sceneToSvg } from "../render/scene.js";
import { shareSvgAssets } from "../render/share-assets.js";
import { unpackScene } from "./scene-transfer.js";
import { sizeSvg } from "./render-service.js";

let renderAsync, Resvg;
try {
  const mod = await import("@resvg/resvg-js");
  ({ renderAsync, Resvg } = mod.default ?? mod);
} catch (error) {
  process.send({ type: "failed", message: error.message });
  process.exit(1);
}

const pictureCacheBytes = Number(process.env.TFM_PICTURE_CACHE_BYTES) || undefined;
const rasterize = (svg) => {
  const rendered = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
  return { pixels: rendered.pixels, width: rendered.width, height: rendered.height };
};
// Cropped pictures by default; a render retried after a crash (a resvg panic on a crop) uses the cache of whole pictures.
const caches = {};
const cacheFor = (crop) => (caches[crop] ??= createPictureCache({ rasterize, crop, ...(pictureCacheBytes ? { maxBytes: pictureCacheBytes } : {}) }));

async function resvgPng(svg, width) {
  const rendered = await renderAsync(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } });
  return { png: rendered.asPng(), width: rendered.width, height: rendered.height };
}

// Each answer carries this process's memory, for the pool's status.
const send = (message) => process.send({ ...message, rss: process.memoryUsage.rss() });

process.on("message", async ({ id, svg, width, height, scene, crop }) => {
  try {
    if (scene) {
      const tree = unpackScene(scene);
      // What the compositor cannot draw goes to resvg instead, stretched to the output as the service's sizeSvg does.
      const { unsupported } = flattenScene(tree, { width, height, fit: "fill" });
      if (Object.keys(unsupported).length) {
        const text = sizeSvg(shareSvgAssets(sceneToSvg(tree)), width, height);
        send({ id, ...(await resvgPng(text, width)), renderer: "resvg", unsupported });
        return;
      }
      const result = await renderScenePng(tree, { pictures: cacheFor(crop !== false), width, height, fit: "fill" });
      send({ id, png: result.png, width: result.width, height: result.height, renderer: "compositor" });
      return;
    }
    send({ id, ...(await resvgPng(svg, width)) });
  } catch (error) {
    send({ id, error: error.message });
  }
});
// The server is gone: nothing left to do.
process.on("disconnect", () => process.exit(0));
process.send({ type: "ready" });
