// The render service behind `tfm-render-server`: a request body in, a PNG out. Same request shape as entibo/miceditor-map-preview
// (`{ xml, raw?, width?, height? }`) plus the renderer's options; the answer is JSON with the image in base64 (or the bare PNG with `raw: true`). No upload anywhere.
import { createHash } from "node:crypto";
import { parseTfmDocument } from "../tfm/parse-map.js";
import { renderTfmSvg } from "../render/svg.js";
import { shareSvgAssets } from "../render/share-assets.js";

/** The renderer options a client may set (JSON values only: no resolvers or callbacks). Anything else in `options` is rejected. */
export const ALLOWED_OPTIONS = Object.freeze({
  mirrorX: "boolean", minimalist: "boolean", restricted: "boolean", clientLimits: "preset-or-object", backgroundColor: "string-or-null",
  objectMode: ["editor", "game"], nailVisibility: ["all", "client"], objectPlaceholders: "boolean", spawnMarkers: ["circles", "editor", "none"],
  renderJoints: "boolean", renderAppearingImages: "boolean", renderIpImages: "boolean", renderSoulmateHeart: "boolean", renderHideOffscreenFrame: "boolean",
  renderTiledBackgrounds: "boolean", compositeRandomBackground: "boolean", randomBackgroundIndex: "number", randomDecorationFlip: "boolean",
  textures: "boolean", textureSeed: "number", pregeneratedBitmaps: "boolean", cheeseSuffix: "string", defaultAssets: "boolean", flashBlur: "boolean",
  scale: "number", rotation: "number", borders: ["none", "map", "all"], debugMarkers: "boolean", viewport: "viewport",
});
/** Short names accepted at the top level of the request (the miceditor-map-preview style): `mirror` is `options.mirrorX`. */
const ALIASES = Object.freeze({ mirror: "mirrorX" });

export class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.name = "RequestError"; this.status = status; }
}

function checkOption(name, value) {
  const rule = ALLOWED_OPTIONS[name];
  const ok = Array.isArray(rule) ? rule.includes(value)
    : rule === "boolean" ? typeof value === "boolean"
    : rule === "number" ? typeof value === "number" && Number.isFinite(value)
    : rule === "string" ? typeof value === "string" && value.length <= 64
    : rule === "string-or-null" ? value === null || (typeof value === "string" && value.length <= 64)
    : rule === "preset-or-object" ? typeof value === "string" || (value && typeof value === "object" && !Array.isArray(value))
    : rule === "viewport" ? value && typeof value === "object" && ["x", "y", "width", "height"].every((k) => value[k] === undefined || Number.isFinite(value[k]))
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
 * @param {{rasterize: Function, name: string}} config.rasterizer
 * @param {object} [config.assetResolver] resolver of the loaded asset release (placeholders when absent)
 * @param {number} [config.maxXmlBytes] default 2 MB
 * @param {number} [config.maxPixels] largest output (width * height), default 4096 * 4096
 * @param {number} [config.maxDimension] default 8192
 * @param {number} [config.timeoutMs] default 30000
 * @param {number} [config.concurrency] simultaneous renders, default 2; further requests wait (up to `maxQueue`, default 16, then 503)
 */
export function createRenderService({ rasterizer, assetResolver = null, maxXmlBytes = 2_000_000, maxPixels = 4096 * 4096, maxDimension = 8192, timeoutMs = 30_000, concurrency = 2, maxQueue = 16, shareAssets = true, cacheEntries = 64 }) {
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
    const options = parseOptions(body);
    const cacheKey = cacheEntries > 0 ? createHash("sha1").update(JSON.stringify([body.xml, options, body.width, body.height, body.lenient, body.svg === true])).digest("hex") : null;
    if (cacheKey && cache.has(cacheKey)) { const hit = cache.get(cacheKey); cache.delete(cacheKey); cache.set(cacheKey, hit); return { ...hit, cached: true }; }
    let parsed;
    try {
      parsed = parseTfmDocument(body.xml, body.lenient === false ? { lenient: false } : {});
    } catch (error) {
      throw new RequestError(`cannot parse the XML: ${error.message}`);
    }
    const { map, document } = parsed;
    let svg;
    try {
      svg = renderTfmSvg(map, { ...options, ...(assetResolver && options.defaultAssets !== false ? { assetResolver } : {}) });
    } catch (error) {
      if (error instanceof RangeError) throw new RequestError(`${error.message} (pass "viewport": {"x":0,"y":0,"width":800,"height":400} to render a part of a huge map)`);
      throw error;
    }
    if (shareAssets) svg = shareSvgAssets(svg);
    const natural = /^<svg[^>]* width="([\d.]+)" height="([\d.]+)"/.exec(svg);
    const naturalWidth = Math.round(Number(natural?.[1] ?? 800)), naturalHeight = Math.round(Number(natural?.[2] ?? 400));
    let width = body.width ?? naturalWidth;
    let height = body.height ?? naturalHeight;
    if (body.width != null && body.height == null) height = Math.max(1, Math.round(naturalHeight * width / naturalWidth));
    if (body.height != null && body.width == null) width = Math.max(1, Math.round(naturalWidth * height / naturalHeight));
    if (width > maxDimension || height > maxDimension || width * height > maxPixels) throw new RequestError(`the image would be ${width}x${height} pixels, above the limit (${maxDimension} per side, ${maxPixels} in all)`, 413);
    await acquire();
    let result;
    try {
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new RequestError("rendering took too long", 503)), timeoutMs); });
      try {
        result = await Promise.race([rasterizer.rasterize(sizeSvg(svg, width, height), { width, height }), timeout]);
      } finally {
        clearTimeout(timer);
      }
    } finally {
      release();
    }
    const response = {
      png: result.png,
      width: result.width,
      height: result.height,
      mapWidth: map.settings.width ?? 800,
      mapHeight: map.settings.height ?? 400,
      backend: rasterizer.name,
      clientLoads: map.source?.clientLoads ?? null,
      warnings: (document.diagnostics ?? []).slice(0, 50),
      ...(body.svg === true ? { svg } : {}),
    };
    if (cacheKey) { cache.set(cacheKey, response); if (cache.size > cacheEntries) cache.delete(cache.keys().next().value); }
    return response;
  }
  return { render, get status() { return { running, waiting: waiting.length }; } };
}
