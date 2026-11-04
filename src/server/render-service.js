// The render service behind `tfm-render-server`: a request body in, a PNG out. Same request shape as entibo/miceditor-map-preview
// (`{ xml, raw?, width?, height? }`) plus the renderer's options; the answer is JSON with the image in base64 (or the bare PNG with `raw: true`). No upload anywhere.
import { createHash } from "node:crypto";
import { parseTfmDocument } from "../tfm/parse-map.js";
import { renderTfmSvg, renderedViewport } from "../render/svg.js";
import { shareSvgAssets } from "../render/share-assets.js";
import { RENDER_MODULES } from "../render/modules/index.js";
import { resolveParkourStyle } from "../render/modules/parkour.js";

/** The renderer options a client may set (JSON values only: no resolvers or callbacks). Anything else in `options` is rejected. */
export const ALLOWED_OPTIONS = Object.freeze({
  mirrorX: "boolean", minimalist: "boolean", restricted: "boolean", clientLimits: "preset-or-object", backgroundColor: "string-or-null",
  objectMode: ["editor", "game"], nailVisibility: ["all", "client"], objectPlaceholders: "boolean", spawnMarkers: ["circles", "editor", "none"],
  renderJoints: "boolean", renderAppearingImages: "boolean", renderIpImages: "boolean", renderSoulmateHeart: "boolean", renderHideOffscreenFrame: "boolean",
  renderTiledBackgrounds: "boolean", compositeRandomBackground: "boolean", randomBackgroundIndex: "number", randomDecorationFlip: "boolean",
  textures: "boolean", textureSeed: "number", pregeneratedBitmaps: "boolean", cheeseSuffix: "string", defaultAssets: "boolean", flashBlur: "boolean",
  scale: "number", rotation: "number", borders: ["none", "map", "all"], debugMarkers: "boolean", viewport: "viewport",
  modules: "modules", parkourNails: "boolean", parkourStyle: "parkour-style",
});
/** Short names accepted at the top level of the request (the miceditor-map-preview style): `mirror` is `options.mirrorX`. */
const ALIASES = Object.freeze({ mirror: "mirrorX" });

export class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.name = "RequestError"; this.status = status; }
}

function checkOption(name, value) {
  const rule = ALLOWED_OPTIONS[name];
  if (rule === "parkour-style") {
    try { resolveParkourStyle(value); } catch (error) { throw new RequestError(`invalid value for option "${name}": ${error.message}`); }
    return;
  }
  const ok = Array.isArray(rule) ? rule.includes(value)
    : rule === "boolean" ? typeof value === "boolean"
    : rule === "number" ? typeof value === "number" && Number.isFinite(value)
    : rule === "string" ? typeof value === "string" && value.length <= 64
    : rule === "string-or-null" ? value === null || (typeof value === "string" && value.length <= 64)
    : rule === "preset-or-object" ? typeof value === "string" || (value && typeof value === "object" && !Array.isArray(value))
    : rule === "viewport" ? value && typeof value === "object" && ["x", "y", "width", "height"].every((k) => value[k] === undefined || Number.isFinite(value[k]))
    : rule === "modules" ? value === false || (value && typeof value === "object" && !Array.isArray(value)
      && Object.entries(value).every(([k, v]) => k in RENDER_MODULES && (v === "auto" || v === true || v === false)))
    : false;
  if (!ok) throw new RequestError(`invalid value for option "${name}"`);
}

/**
 * Extracts and validates the renderer options of a request: `options` object plus the top-level shorthands (`mirror`, and any allowed option name).
 * @returns {object}
 */
export function parseOptions(body) {
  const options = {};
  const take = (source, strict) => {
    for (const [key, value] of Object.entries(source ?? {})) {
      const name = ALIASES[key] ?? key;
      if (!(name in ALLOWED_OPTIONS)) { if (strict) throw new RequestError(`unknown option "${key}"`); continue; }
      checkOption(name, value);
      options[name] = value;
    }
  };
  if (body.options != null && (typeof body.options !== "object" || Array.isArray(body.options))) throw new RequestError('"options" must be an object');
  take(body, false);
  take(body.options, true);
  return options;
}

/** Rewrites the root `<svg>` to the final pixel size (stretching the map to it like `fit: "fill"` of the miceditor service). */
export function sizeSvg(svg, width, height) {
  return svg.replace(/^<svg([^>]*?) width="[^"]*" height="[^"]*"/, `<svg$1 width="${width}" height="${height}" preserveAspectRatio="none"`);
}

/**
 * @param {object} config
 * @param {{rasterize: Function, name: string}} config.rasterizer `rasterize(svg, { width, height, signal })`; `signal` aborts on timeout.
 *   A `RasterizerCrashError` (the picture crashed the rasterizer's process) is answered with 422
 * @param {object} [config.assetResolver] resolver of the loaded asset release (placeholders when absent)
 * @param {number} [config.maxXmlBytes] default 2 MB
 * @param {number} [config.maxPixels] largest output (width * height), default 4096 * 4096
 * @param {number} [config.maxDimension] default 8192
 * @param {number} [config.timeoutMs] default 30000
 * @param {number} [config.concurrency] simultaneous renders, default 2; further requests wait (up to `maxQueue`, default 16, then 503)
 * @param {object} [config.mapImages] a `createMapImageFetcher()`: the map's own images (`D`, `d`, `i`, `APS`, ...) are fetched and
 *   drawn; a request turns it off with `"mapImages": false`. Without it they are not drawn (docs/api/http.md#map-images)
 * @param {object} [config.defaultOptions] renderer options every request gets unless it sets them itself (same names and checks as a
 *   request's `options`; a bad value throws here)
 * @param {{width:number, height:number}} [config.maxMapSize] soft limit in map units: a larger map (or viewport) is drawn only up to
 *   this size from its top-left corner, with a `map-cropped` warning, instead of failing. Default none
 */
export function createRenderService({ rasterizer, assetResolver = null, mapImages = null, defaultOptions = {}, maxXmlBytes = 2_000_000, maxPixels = 4096 * 4096, maxDimension = 8192, timeoutMs = 30_000, concurrency = 2, maxQueue = 16, shareAssets = true, cacheEntries = 64, maxMapSize = null }) {
  const defaults = Object.freeze(parseOptions({ options: defaultOptions }));
  let running = 0;
  const waiting = [];
  const acquire = () => new Promise((resolve, reject) => {
    if (running < concurrency) { running++; resolve(); return; }
    if (waiting.length >= maxQueue) { reject(new RequestError("service busy, try again later", 503)); return; }
    waiting.push(resolve);
  });
  const release = () => { const next = waiting.shift(); if (next) next(); else running--; };

  const cache = new Map(); // LRU of finished results, keyed by the whole normalised request
  async function render(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("the request body must be a JSON object");
    if (typeof body.xml !== "string" || !body.xml.trim()) throw new RequestError('missing "xml"');
    if (Buffer.byteLength(body.xml) > maxXmlBytes) throw new RequestError(`"xml" is larger than ${maxXmlBytes} bytes`, 413);
    for (const key of ["width", "height"]) {
      if (body[key] != null && !(Number.isInteger(body[key]) && body[key] >= 1 && body[key] <= maxDimension)) throw new RequestError(`"${key}" must be an integer from 1 to ${maxDimension}`);
    }
    if (body.rasterize !== undefined && typeof body.rasterize !== "boolean") throw new RequestError('"rasterize" must be true or false');
    const rasterize = body.rasterize !== false;
    if (!rasterize && body.svg !== true) throw new RequestError('"rasterize": false needs "svg": true');
    // The size limits protect the rasteriser: an SVG-only answer has neither the soft map size (`maxMapSize`) nor the renderer's
    // output size check (`limits`).
    const options = { ...defaults, ...parseOptions(body), ...(rasterize ? (maxMapSize ? { maxViewport: maxMapSize } : {}) : { limits: false }) };
    const withImages = Boolean(mapImages) && body.mapImages !== false;
    const cacheKey = cacheEntries > 0 ? createHash("sha1").update(JSON.stringify([body.xml, options, body.width, body.height, body.lenient, body.svg === true, rasterize, withImages])).digest("hex") : null;
    if (cacheKey && cache.has(cacheKey)) { const hit = cache.get(cacheKey); cache.delete(cacheKey); cache.set(cacheKey, hit); return { ...hit, cached: true }; }
    let parsed;
    try {
      parsed = parseTfmDocument(body.xml, body.lenient === false ? { lenient: false } : {});
    } catch (error) {
      throw new RequestError(`cannot parse the XML: ${error.message}`);
    }
    const { map, document } = parsed;
    let drawn;
    try {
      drawn = renderedViewport(map, options);
    } catch (error) {
      if (error instanceof RangeError) throw new RequestError(error.message);
      throw error;
    }
    // The output size, known before drawing: the drawn part of the map times `scale`, or the asked `width` / `height`.
    const scale = options.scale ?? 1;
    if (!(scale > 0)) throw new RequestError("SVG scale must be positive");
    const naturalWidth = Math.round(drawn.width * scale), naturalHeight = Math.round(drawn.height * scale);
    let width = body.width ?? naturalWidth;
    let height = body.height ?? naturalHeight;
    if (body.width != null && body.height == null) height = Math.max(1, Math.round(naturalHeight * width / naturalWidth));
    if (body.height != null && body.width == null) width = Math.max(1, Math.round(naturalWidth * height / naturalHeight));
    // Above the output limits the picture stops there: the width is kept up to `maxDimension` and the rows up to `maxPixels`, and
    // only that top-left part of the map is drawn (a smaller viewport, so the cut-off part is culled and never reaches resvg).
    let truncated = null;
    if (rasterize && (width > maxDimension || height > maxDimension || width * height > maxPixels)) {
      const keptWidth = Math.min(width, maxDimension);
      const keptHeight = Math.max(1, Math.min(height, maxDimension, Math.floor(maxPixels / keptWidth)));
      truncated = { code: "image-truncated", severity: "info", requestedWidth: width, requestedHeight: height, width: keptWidth, height: keptHeight };
      options.viewport = { x: drawn.x, y: drawn.y, width: drawn.width * keptWidth / width, height: drawn.height * keptHeight / height };
      width = keptWidth;
      height = keptHeight;
    }
    const assets = assetResolver && options.defaultAssets !== false ? assetResolver : null;
    const draw = (resolver) => {
      try {
        return renderTfmSvg(map, { ...options, ...(resolver ? { assetResolver: resolver } : {}) });
      } catch (error) {
        if (error instanceof RangeError) throw new RequestError(`${error.message} (pass "viewport": {"x":0,"y":0,"width":800,"height":400} to render a part of a huge map)`);
        throw error;
      }
    };
    let svg;
    let images = null;
    if (withImages) {
      // First pass: learn which map images the renderer draws; then fetch them and draw again with them embedded.
      const session = mapImages.session(assets);
      svg = draw(session.recorder);
      const { loaded, requested, missing } = await session.fetchAll();
      images = { requested, loaded: loaded.size, missing };
      if (loaded.size) svg = draw(session.resolverWith(loaded));
    } else {
      svg = draw(assets);
    }
    if (shareAssets) svg = shareSvgAssets(svg);
    const info = {
      mapWidth: map.settings.width ?? 800,
      mapHeight: map.settings.height ?? 400,
      backend: rasterize ? rasterizer.name : "svg",
      clientLoads: map.source?.clientLoads ?? null,
      warnings: [
        ...(document.diagnostics ?? []).slice(0, 50),
        ...(images?.missing ? [{ code: "map-image-unavailable", severity: "info", count: images.missing }] : []),
        ...(drawn.cropped ? [{ code: "map-cropped", severity: "info", x: drawn.x, y: drawn.y, width: drawn.width, height: drawn.height }] : []),
        ...(truncated ? [truncated] : []),
      ],
      ...(images ? { mapImages: images } : {}),
      ...(body.svg === true ? { svg } : {}),
    };
    let response;
    if (!rasterize) {
      // The SVG at its own size; `width` and `height` apply to the PNG only.
      response = { width: naturalWidth, height: naturalHeight, ...info };
    } else {
      let result;
      try {
        await acquire();
        try {
          let timer;
          // On timeout the rasterizer is told to stop (a pool kills that child), so the picture does not keep a process busy.
          const controller = new AbortController();
          const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => { const error = new RequestError("rendering took too long", 503); controller.abort(error); reject(error); }, timeoutMs);
          });
          try {
            result = await Promise.race([rasterizer.rasterize(sizeSvg(svg, width, height), { width, height, signal: controller.signal }), timeout]);
          } catch (error) {
            if (error?.name === "RasterizerCrashError") throw new RequestError(error.message, error.status ?? 422);
            throw error;
          } finally {
            clearTimeout(timer);
          }
        } finally {
          release();
        }
      } catch (error) {
        // With `svg: true` the answer keeps the SVG (and the rest) next to the error.
        if (body.svg === true && error && typeof error === "object") error.partial = info;
        throw error;
      }
      response = { png: result.png, width: result.width, height: result.height, ...info };
    }
    // A render that misses map images is not kept: the next request tries them again.
    if (cacheKey && !images?.missing) { cache.set(cacheKey, response); if (cache.size > cacheEntries) cache.delete(cache.keys().next().value); }
    return response;
  }
  return { render, get status() { return { running, waiting: waiting.length }; } };
}
