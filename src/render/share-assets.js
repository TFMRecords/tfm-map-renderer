// SVG-to-SVG optimisation: every distinct SVG asset that the renderer embeds as an `<image href="data:image/svg+xml;base64,...">` is moved once into `<defs>` as a
// nested `<svg>` (ids prefixed so assets cannot collide) and each placement becomes a `<use>`. resvg parses and renders every `<image>` data URI separately, so a map with
// 88 nail/ground placements of 9 assets goes from ~290 ms to ~55 ms. The pixels are the same up to sub-pixel anti-aliasing: the nested SVG is drawn as vector at the
// placement's own sub-pixel offset instead of through an intermediate raster. Assets with filters (Flash blur, glow) stay `<image>`: shared, they render no faster
// (measured 150 -> 290 ms on decorations-effects-6 before they were excluded) and their pixels are only guaranteed identical when drawn the plain way.

const IMAGE = /<image href="data:image\/svg\+xml;base64,([^"]+)"([^>]*)\/>/g;
const attrOf = (text, name) => text.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function prefixIds(svg, prefix) {
  let out = svg;
  for (const id of new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))) {
    const e = escapeRegExp(id);
    out = out
      .replace(new RegExp(`(\\sid=")${e}"`, "g"), `$1${prefix}${id}"`)
      .replace(new RegExp(`url\\(#${e}\\)`, "g"), `url(#${prefix}${id})`)
      .replace(new RegExp(`((?:xlink:)?href=")#${e}"`, "g"), `$1#${prefix}${id}"`);
  }
  return out;
}

/** @param {string} svg an SVG produced by `renderTfmSvg`. @returns {string} the same picture with shared assets (unchanged when nothing can be shared). */
export function shareSvgAssets(svg) {
  const ids = new Map();
  const defs = [];
  let uses = 0;
  const body = svg.replace(IMAGE, (whole, b64, rest) => {
    const [x, y, width, height] = ["x", "y", "width", "height"].map((n) => attrOf(rest, n));
    if (width == null || height == null) return whole; // no explicit size: keep the image's own
    const par = attrOf(rest, "preserveAspectRatio");
    if (/\sstyle="/.test(rest)) return whole;
    const key = `${b64}|${par ?? ""}`;
    let id = ids.get(key);
    if (!id) {
      id = `s${ids.size}`;
      let inner = Buffer.from(b64, "base64").toString("utf8").replace(/^\s*<\?xml[^>]*\?>/, "").replace(/<!DOCTYPE[^>]*>/, "").trim();
      if (!/^<svg\b/.test(inner) || /<filter\b/.test(inner)) return whole;
      inner = prefixIds(inner, `${id}_`).replace(/^<svg\b/, `<svg id="${id}"${par ? ` preserveAspectRatio="${par}"` : ""}`);
      ids.set(key, id);
      defs.push(inner);
    }
    uses++;
    return `<use href="#${id}"${x != null ? ` x="${x}"` : ""}${y != null ? ` y="${y}"` : ""} width="${width}" height="${height}"/>`;
  });
  if (uses === 0) return svg;
  return body.replace(/<svg\b[^>]*>/, (open) => `${open}<defs>${defs.join("")}</defs>`);
}
