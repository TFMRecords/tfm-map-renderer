// Rasters of the game's pictures (the `image` nodes of a scene, src/render/scene.js) as they land on the output, for the PNG
// compositor. The rasteriser is passed in (resvg in the server, src/server/rasterize.js), so this module stays plain JS.
//
// A picture is rasterised in device space: with its placement's scale, rotation and flip, and its sub-pixel offset (to 1/8
// pixel), so the compositor copies the pixels without resampling and the picture is as sharp as when resvg draws the whole SVG.
// Placements that differ only by whole pixels share one raster.
//
// A picture is always rasterised whole. Cropping it to the part in view would save memory, but resvg panics on crops much
// narrower than the picture (measured: $F_4 at 6x, 9603 px wide, panics in crops up to 4000 px wide and not from 4800 px on),
// and a nested layer is allocated at nearly the picture's size anyway. A picture above `maxPixels` is rasterised at a lower
// resolution (`scale` below 1) and stretched by the compositor, so it is softer. Rasters are kept in a least-recently-used
// cache of at most `maxBytes`.
import { escapeXml } from "../render/svg-util.js";

/** Sub-pixel steps of a placement: offsets are rounded to 1/PHASES of a pixel. */
const PHASES = 8;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * @typedef {{ data: Uint8Array, x0: number, y0: number, scale: number, width: number, height: number }} PictureRaster a
 *   picture as it lands on the output, premultiplied RGBA: raster pixel (i, j) covers the device pixel (x0 + i / scale,
 *   y0 + j / scale); `scale` is 1 unless the picture is larger than `maxPixels`.
 */

/**
 * @param {{ rasterize: (svg: string) => { pixels: Uint8Array, width: number, height: number }, maxBytes?: number,
 *   maxPixels?: number }} options `rasterize` turns an SVG document into premultiplied RGBA pixels of its width x height
 */
export function createPictureCache({ rasterize, maxBytes = 256 * 1024 * 1024, maxPixels = 4096 * 4096 }) {
  if (typeof rasterize !== "function") throw new TypeError("createPictureCache needs a rasterize function");
  const ids = new Map(); // href -> short id for the cache keys
  const rasters = new Map(); // key -> raster data, oldest first
  let bytes = 0;
  const stats = { hits: 0, misses: 0, evicted: 0 };

  return {
    /**
     * The raster of a picture placed with `matrix` (picture space to device pixels, as [a, b, c, d, e, f] of SVG) over `box`
     * (its `x`, `y`, `width`, `height` in picture space).
     * @param {string} href the picture (an SVG or PNG data URI, as in the scene)
     * @param {number[]} matrix
     * @param {{x: number, y: number, width: number, height: number}} box
     * @param {string} [preserveAspectRatio] as on the scene's `image` node
     * @returns {PictureRaster|null} null when the placement is degenerate
     */
    picture(href, matrix, box, preserveAspectRatio) {
      const [a, b, c, d] = matrix;
      const e = Math.round(matrix[4] * PHASES) / PHASES;
      const f = Math.round(matrix[5] * PHASES) / PHASES;
      const { x, y, width: w, height: h } = box;
      if (!(w > 0 && h > 0) || !Number.isFinite(a + b + c + d + e + f) || a * d - b * c === 0) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
        const dx = a * px + c * py + e, dy = b * px + d * py + f;
        minX = Math.min(minX, dx); minY = Math.min(minY, dy); maxX = Math.max(maxX, dx); maxY = Math.max(maxY, dy);
      }
      const x0 = Math.floor(minX), y0 = Math.floor(minY);
      const fullW = Math.max(1, Math.ceil(maxX) - x0), fullH = Math.max(1, Math.ceil(maxY) - y0);
      const scale = Math.min(1, Math.sqrt(maxPixels / (fullW * fullH)));
      const rw = Math.max(1, Math.ceil(fullW * scale)), rh = Math.max(1, Math.ceil(fullH * scale));
      // The placement relative to the raster's corner: the same for every placement that differs by whole pixels.
      const local = [a, b, c, d, e - x0, f - y0].map((n) => round6(n * scale));
      let id = ids.get(href);
      if (id === undefined) ids.set(href, (id = ids.size));
      const key = `${id}|${local.join(",")}|${x},${y},${w},${h}|${preserveAspectRatio ?? ""}|${rw}x${rh}`;
      let data = rasters.get(key);
      if (data) {
        stats.hits++;
        rasters.delete(key);
        rasters.set(key, data);
      } else {
        stats.misses++;
        const out = rasterize(`<svg xmlns="http://www.w3.org/2000/svg" width="${rw}" height="${rh}" viewBox="0 0 ${rw} ${rh}">`
          + `<image href="${escapeXml(href)}" x="${x}" y="${y}" width="${w}" height="${h}"`
          + `${preserveAspectRatio ? ` preserveAspectRatio="${escapeXml(preserveAspectRatio)}"` : ""} transform="matrix(${local.join(" ")})"/></svg>`);
        if (out.width !== rw || out.height !== rh || out.pixels.length !== rw * rh * 4) throw new Error(`picture came back ${out.width}x${out.height}, expected ${rw}x${rh}`);
        data = out.pixels;
        rasters.set(key, data);
        bytes += data.length;
        for (const [old, value] of rasters) {
          if (bytes <= maxBytes || old === key) break;
          rasters.delete(old);
          bytes -= value.length;
          stats.evicted++;
        }
      }
      return { data, x0, y0, scale, width: rw, height: rh };
    },
    /** Cache counters and the bytes held. */
    get stats() {
      return { ...stats, rasters: rasters.size, bytes };
    },
  };
}
