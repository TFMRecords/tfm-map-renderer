// Rasters of the game's pictures (the `image` nodes of a scene, src/render/scene.js) as they land on the output, for the PNG
// compositor. The rasteriser is passed in (resvg in the server, src/server/rasterize.js), so this module stays plain JS.
//
// A picture is rasterised in device space: with its placement's scale, rotation and flip, and its sub-pixel offset (to 1/8
// pixel), so the compositor copies the pixels without resampling and the picture is as sharp as when resvg draws the whole SVG.
// Placements that differ only by whole pixels share one raster.
//
// A picture mostly out of view (a large ground rotated across a zoomed viewport) is rasterised cropped to the part that can
// show, on a grid of CROP_GRID pixels from its corner so that nearby crops are shared. resvg can panic on such crops (measured:
// $F_4 at 6x, 9603 px wide, panics in crops up to 4000 px wide and not from 4800 px on), and a panic ends the process: with
// `crop: false` every picture is rasterised whole, for a process that must not end (the server's own; the pool's children
// retry a crashed render that way, src/server/rasterize.js). A picture above `maxPixels` is rasterised at a lower resolution
// (`scale` below 1) and stretched by the compositor, so it is softer. Rasters are kept in a least-recently-used cache of at
// most `maxBytes`.
import { escapeXml } from "../render/svg-util.js";

/** Sub-pixel steps of a placement: offsets are rounded to 1/PHASES of a pixel. */
const PHASES = 8;
const round6 = (n) => Math.round(n * 1e6) / 1e6;
/**
 * Crops are whole multiples of CROP_GRID pixels from the picture's corner, and only made for a picture of CROP_MIN pixels or more
 * when they halve its raster or more: smaller pictures cost little whole, and every crop risks a resvg panic.
 */
const CROP_GRID = 64;
const CROP_MIN = 1024 * 1024;

/**
 * @typedef {{ data: Uint8Array, x0: number, y0: number, scale: number, width: number, height: number }} PictureRaster a
 *   picture as it lands on the output, premultiplied RGBA: raster pixel (i, j) covers the device pixel (x0 + i / scale,
 *   y0 + j / scale); `scale` is 1 unless the picture is larger than `maxPixels`.
 */

/**
 * @param {{ rasterize: (svg: string) => { pixels: Uint8Array, width: number, height: number }, maxBytes?: number,
 *   maxPixels?: number, crop?: boolean }} options `rasterize` turns an SVG document into premultiplied RGBA pixels of its width x
 *   height; `crop` (default true) rasterises only the part of a picture that is needed
 */
export function createPictureCache({ rasterize, maxBytes = 256 * 1024 * 1024, maxPixels = 4096 * 4096, crop = true }) {
  if (typeof rasterize !== "function") throw new TypeError("createPictureCache needs a rasterize function");
  const ids = new Map(); // href -> short id for the cache keys
  const rasters = new Map(); // key -> raster data, oldest first
  let bytes = 0;
  const stats = { hits: 0, misses: 0, evicted: 0, cropped: 0 };

  return {
    /**
     * The raster of a picture placed with `matrix` (picture space to device pixels, as [a, b, c, d, e, f] of SVG) over `box`
     * (its `x`, `y`, `width`, `height` in picture space).
     * @param {string} href the picture (an SVG or PNG data URI, as in the scene)
     * @param {number[]} matrix
     * @param {{x: number, y: number, width: number, height: number}} box
     * @param {string} [preserveAspectRatio] as on the scene's `image` node
     * @param {{x0: number, y0: number, x1: number, y1: number}} [need] the device pixels the picture can show in; the raster may
     *   then cover only those (and more)
     * @returns {PictureRaster|null} null when the placement is degenerate or out of `need`
     */
    picture(href, matrix, box, preserveAspectRatio, need) {
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
      let x0 = Math.floor(minX), y0 = Math.floor(minY);
      let fullW = Math.max(1, Math.ceil(maxX) - x0), fullH = Math.max(1, Math.ceil(maxY) - y0);
      if (crop && need && fullW * fullH >= CROP_MIN) {
        const snap = (v, o, n, up) => Math.max(0, Math.min(n, (up ? Math.ceil : Math.floor)((v - o) / CROP_GRID) * CROP_GRID));
        const cx0 = snap(need.x0, x0, fullW, false), cx1 = snap(need.x1, x0, fullW, true);
        const cy0 = snap(need.y0, y0, fullH, false), cy1 = snap(need.y1, y0, fullH, true);
        if (cx0 >= cx1 || cy0 >= cy1) return null;
        if ((cx1 - cx0) * (cy1 - cy0) * 2 <= fullW * fullH) {
          x0 += cx0; y0 += cy0; fullW = cx1 - cx0; fullH = cy1 - cy0;
          stats.cropped++;
        }
      }
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
