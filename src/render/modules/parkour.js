// Parkour checkpoints (docs/xml/modules.md#parkour), drawn the way Miceditor shows them: a mouse at every checkpoint nail,
// its number, a dotted circle when its size is not 1, plus what the module does there (size, cheese, stop).
import { DEFAULT_MARKER_STYLES } from "../default-assets.js";
import { glyphLabel } from "../glyphs.js";
import { attr, finiteOr, imageElement, resolveImage } from "../svg-util.js";

const STOP_FILTER = `<filter id="parkour-stop" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.35 0 0 0 0  0 0.45 0 0 0.05  0 0 0.6 0 0.42  0 0 0 1 0"/></filter>`;
const format = (n) => String(Math.round(n * 100) / 100);

function clip(resolver, key, x, y) {
  const asset = resolveImage(resolver, key, "sprite", { key });
  return asset?.href ? imageElement(asset, x - (asset.origin?.x ?? 0), y - (asset.origin?.y ?? 0)) : "";
}

// The mouse of a checkpoint nail: the editor's spawn picture, or the spawn placeholder.
function mouse(resolver) {
  const picture = clip(resolver, "AnimStatique", 0, 0);
  if (picture) return picture;
  const s = DEFAULT_MARKER_STYLES["mouse-spawn"];
  return `<circle${attr("r", s.r)}${attr("fill", s.fill)}${attr("stroke", s.stroke)}/>`;
}

// A small cheese above the mouse's right ear; crossed out in red when the checkpoint takes the cheese away.
function cheese(resolver, mode) {
  const picture = clip(resolver, "$Fromage", 0, 0);
  const s = DEFAULT_MARKER_STYLES.cheese;
  const inner = picture || `<circle${attr("r", s.r * 2)}${attr("fill", s.fill)}${attr("stroke", s.stroke)}/>`;
  const cross = mode === "remove"
    ? `<path${attr("d", "M-5 -5L5 5M5 -5L-5 5")}${attr("stroke", "#e02424")}${attr("stroke-width", 2.4)}${attr("stroke-linecap", "round")}/>`
    : "";
  return `<g${attr("transform", "translate(12 -16)")}${attr("data-parkour", mode === "remove" ? "uncheese" : "cheese")}><g${attr("transform", "scale(0.5)")}>${inner}</g>${cross}</g>`;
}

/**
 * The overlay of a map's parkour checkpoints (`map.modules.parkour`). The spawn (checkpoint 1) gets the annotations only, since
 * the spawn marker already draws a mouse there; the chair (the last checkpoint) is drawn by the map itself.
 * @param {object} data `map.modules.parkour`
 * @param {{resolver?: object, mirrored?: boolean}} context
 */
export function renderParkour(data, { resolver = null, mirrored = false } = {}) {
  const out = [];
  let stops = false;
  for (const c of data?.checkpoints ?? []) {
    if (c.kind === "chair" || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    const size = finiteOr(c.size, 1);
    const radius = Math.max(2, Math.abs(size) * 16 - 1);
    const parts = [];
    if (c.kind === "nail") {
      if (c.stop) stops = true;
      parts.push(c.stop ? `<g${attr("filter", "url(#parkour-stop)")}${attr("data-parkour", "stop")}>${mouse(resolver)}</g>` : mouse(resolver));
    }
    // The size circle only where the size differs from the default.
    if (size !== 1) parts.push(`<circle${attr("r", format(radius))}${attr("fill", "none")}${attr("stroke", "#ffffff")}${attr("stroke-opacity", 0.85)}${attr("stroke-width", 1.5)}${attr("stroke-dasharray", "3 3")}/>`);
    if (c.cheese) parts.push(cheese(resolver, c.cheese));
    parts.push(glyphLabel(String(c.number), { y: -Math.max(30, radius + 8), anchor: "middle", height: 9 }));
    if (size !== 1) parts.push(glyphLabel(`×${format(size)}`, { x: 9, y: 14, height: 7 }));
    // In a mirrored room the outer transform flips the picture; the local flip keeps the checkpoint (and its labels) readable.
    const transform = `translate(${c.x} ${c.y})${mirrored ? " scale(-1 1)" : ""}`;
    out.push(`<g${attr("transform", transform)}${attr("data-role", "parkour-checkpoint")}${attr("data-number", c.number)}>${parts.join("")}</g>`);
  }
  if (!out.length) return "";
  return `<g${attr("data-module", "parkour")}>${stops ? `<defs>${STOP_FILTER}</defs>` : ""}${out.join("")}</g>`;
}
