// Rasters of the game's pictures (the `image` nodes of a scene, src/render/scene.js) at the size they are drawn, for the PNG
// compositor. The rasteriser is passed in (resvg in the server, src/server/rasterize.js), so this module stays plain JS.
//
// A picture is rasterised whole when it is small, otherwise in tiles of at least a third of its size on each axis: resvg panics
// on a layer lying wholly outside a band of twice the canvas around it (docs/rendering.md#culling), and a tile that large keeps every
// part of the picture inside that band (measured: thinner tiles of $P_1 at 20x panic, thirds do not). A picture larger than
// 3 x 3 tiles of `maxTilePixels` is rasterised at a lower resolution; the compositor stretches it to its box.
// Tiles are kept in a least-recently-used cache of at most `maxBytes`.
import { escapeXml } from "../render/svg-util.js";

/**
 * @typedef {{ data: Uint8Array, width: number, height: number, x: number, y: number }} PictureTile premultiplied RGBA of the
 *   picture's raster from (x, y), `width` x `height` pixels
 * @typedef {{ width: number, height: number, columns: number, rows: number, tileWidth: number, tileHeight: number,
 *   tile: (column: number, row: number) => PictureTile }} PictureRaster the raster of one picture, `width` x `height` pixels in
 *   `columns` x `rows` tiles (the last ones may be smaller)
 */

/**
 * @param {{ rasterize: (svg: string) => { pixels: Uint8Array, width: number, height: number }, maxBytes?: number,
 *   tileSize?: number, maxTilePixels?: number }} options `rasterize` turns an SVG document into premultiplied RGBA pixels of its
 *   width x height; a picture up to `tileSize` pixels on a side (default 2048) is one tile
 */
export function createPictureCache({ rasterize, maxBytes = 256 * 1024 * 1024, tileSize = 2048, maxTilePixels = 4096 * 4096 }) {
  if (typeof rasterize !== "function") throw new TypeError("createPictureCache needs a rasterize function");
  const ids = new Map(); // href -> short id for the cache keys
  const tiles = new Map(); // key -> PictureTile, oldest first
  let bytes = 0;
  const stats = { hits: 0, misses: 0, evicted: 0 };

  const split = (size) => {
    const count = size <= tileSize ? 1 : Math.min(3, Math.ceil(size / tileSize));
    return { count, step: Math.ceil(size / count) };
  };

  function rasterTile(href, preserveAspectRatio, width, height, x, y, w, h) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">`
      + `<image href="${escapeXml(href)}" x="0" y="0" width="${width}" height="${height}"${preserveAspectRatio ? ` preserveAspectRatio="${escapeXml(preserveAspectRatio)}"` : ""}/></svg>`;
    const out = rasterize(svg);
    if (out.width !== w || out.height !== h || out.pixels.length !== w * h * 4) throw new Error(`picture tile came back ${out.width}x${out.height}, expected ${w}x${h}`);
    return { data: out.pixels, width: w, height: h, x, y };
  }

  return {
    /**
     * The raster of a picture drawn at `width` x `height` pixels (rounded up, at least 1), or at a lower resolution when that is
     * too large (`maxTilePixels`): the result says its own size.
     * @param {string} href the picture (an SVG or PNG data URI, as in the scene)
     * @param {string} [preserveAspectRatio] as on the scene's `image` node
     * @returns {PictureRaster}
     */
    picture(href, width, height, preserveAspectRatio) {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new RangeError("picture size must be positive");
      const shrink = Math.min(1, Math.sqrt((9 * maxTilePixels) / (width * height)));
      const w = Math.max(1, Math.ceil(width * shrink));
      const h = Math.max(1, Math.ceil(height * shrink));
      let id = ids.get(href);
      if (id === undefined) ids.set(href, (id = ids.size));
      const across = split(w);
      const down = split(h);
      const prefix = `${id}|${w}x${h}|${preserveAspectRatio ?? ""}|`;
      return {
        width: w,
        height: h,
        columns: across.count,
        rows: down.count,
        tileWidth: across.step,
        tileHeight: down.step,
        tile(column, row) {
          const key = `${prefix}${column},${row}`;
          const hit = tiles.get(key);
          if (hit) {
            stats.hits++;
            tiles.delete(key);
            tiles.set(key, hit);
            return hit;
          }
          stats.misses++;
          const x = column * across.step;
          const y = row * down.step;
          const tile = rasterTile(href, preserveAspectRatio, w, h, x, y, Math.min(across.step, w - x), Math.min(down.step, h - y));
          tiles.set(key, tile);
          bytes += tile.data.length;
          for (const [old, value] of tiles) {
            if (bytes <= maxBytes || old === key) break;
            tiles.delete(old);
            bytes -= value.data.length;
            stats.evicted++;
          }
          return tile;
        },
      };
    },
    /** Cache counters and the bytes held. */
    get stats() {
      return { ...stats, tiles: tiles.size, bytes };
    },
  };
}
