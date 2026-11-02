// Adapter from an extracted AssetBundle to the renderer's resolver interface ({ resolve(reference) }).
import { standaloneSvg } from "./svg-normalize.js";
import { applyClipEffects } from "./clip-effects.js";
import { flashBlurChains } from "../util/flash-blur.js";

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml" };

function mimeOf(file) {
  return MIME[String(file).split(".").pop().toLowerCase()] ?? "application/octet-stream";
}

/**
 * Resolve references against a bundle by numeric id or exported symbol name (`reference.key ?? reference.source`).
 * Images become data URIs; vector assets become a standalone SVG data URI whose registration point is the
 * origin (`origin` is returned so a caller can offset the image). `reference.frame` (1-based, default 1) picks a frame of an
 * animated clip. Unknown keys resolve to `null`, which makes the
 * renderer fall back to its built-in placeholders.
 * @param {import("./bundle.js").AssetBundle} bundle
 * @param {Record<string, Array<object>>} [effects] colour transforms and blend modes per symbol name (`effects.json`)
 * @param {{gradients?: boolean, flashBlur?: boolean}} [options] `flashBlur` (default true) swaps FFDec's Gaussian chains for Flash's exact box blurs (`src/util/flash-blur.js`); `false` keeps FFDec's filters
 */
export function createBundleResolver(bundle, effects = {}, { gradients = true, flashBlur = true } = {}) {
  return {
    resolve(reference) {
      const key = String(reference.key ?? reference.source ?? "");
      if (!key || !bundle.has(key)) return null;
      const image = bundle.image(key);
      if (image) {
        return { key, kind: "image", width: image.width ?? undefined, height: image.height ?? undefined,
          href: `data:${mimeOf(image.asset.file)};base64,${image.bytes.toString("base64")}` };
      }
      const frame = Math.max(1, Math.trunc(Number(reference.frame)) || 1);
      const vector = bundle.vector(key, frame);
      if (!vector) return null;
      const placed = frame === 1 ? effects[key] : undefined; // effects.json holds the first frame's placements
      const { defs, body } = applyClipEffects({ defs: vector.defs, body: vector.body }, placed, { colors: Array.isArray(reference.colors) ? reference.colors : undefined, gradients });
      const svg = standaloneSvg({ bounds: vector.bounds, defs: flashBlur ? flashBlurChains(defs) : defs, body: flashBlur ? flashBlurChains(body) : body });
      return { key, kind: vector.asset.kind, width: vector.bounds.width, height: vector.bounds.height, origin: vector.origin,
        href: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` };
    },
  };
}
