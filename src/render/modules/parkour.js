// Parkour checkpoints (docs/xml/modules.md#parkour), drawn the way Miceditor shows them: a mouse at every checkpoint nail with
// the nail drawn again over it, its number, a dotted circle when its size is not 1, plus what the module does there (size, cheese, stop).
import { DEFAULT_MARKER_STYLES } from "../default-assets.js";
import { glyphLabel } from "../glyphs.js";
import { finiteOr, resolveImage } from "../svg-util.js";
import { defs, group, imageNode } from "../scene.js";

// The default blue of a `stop` checkpoint's mouse; `parkourStyle.stopColor` replaces it with a mix towards one colour.
const STOP_MATRIX = Object.freeze([0.35, 0, 0, 0, 0, 0, 0.45, 0, 0, 0.05, 0, 0, 0.6, 0, 0.42, 0, 0, 0, 1, 0]);
const format = (n) => Math.round(n * 100) / 100;

/** The defaults of `parkourStyle`: the checkpoint number above each checkpoint and the size label at its corner. */
export const DEFAULT_PARKOUR_STYLE = Object.freeze({
  stopColor: null,
  stopAmount: 0.6,
  number: Object.freeze({ height: 9, color: "#ffffff", outline: "#1b1f2b" }),
  size: Object.freeze({ height: 7, color: "#ffffff", outline: "#1b1f2b" }),
});
const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * `parkourStyle` merged over `DEFAULT_PARKOUR_STYLE`, checked: `stopColor` ("#rgb" or "#rrggbb"; null = the default blue),
 * `stopAmount` (0 to 1, how far the mouse is mixed towards `stopColor`), and `number` / `size` label settings `{ height, color,
 * outline }` (height 1 to 100 map pixels, colours as above). Throws a TypeError on anything else.
 */
export function resolveParkourStyle(value) {
  if (value == null) return DEFAULT_PARKOUR_STYLE;
  const fail = (what) => { throw new TypeError(`options.parkourStyle${what}`); };
  if (typeof value !== "object" || Array.isArray(value)) fail(" must be an object");
  const color = (v, name) => (v === undefined ? undefined : typeof v === "string" && COLOR.test(v) ? v : fail(`.${name} must be a colour like "#3366ff"`));
  const label = (v, name) => {
    if (v === undefined) return DEFAULT_PARKOUR_STYLE[name];
    if (!v || typeof v !== "object" || Array.isArray(v)) fail(`.${name} must be an object`);
    for (const key of Object.keys(v)) if (!["height", "color", "outline"].includes(key)) fail(`.${name}: unknown setting "${key}"`);
    if (v.height !== undefined && !(Number.isFinite(v.height) && v.height >= 1 && v.height <= 100)) fail(`.${name}.height must be a number from 1 to 100`);
    const base = DEFAULT_PARKOUR_STYLE[name];
    return { height: v.height ?? base.height, color: color(v.color, `${name}.color`) ?? base.color, outline: color(v.outline, `${name}.outline`) ?? base.outline };
  };
  for (const key of Object.keys(value)) if (!(key in DEFAULT_PARKOUR_STYLE)) fail(`: unknown setting "${key}"`);
  if (value.stopAmount !== undefined && !(Number.isFinite(value.stopAmount) && value.stopAmount >= 0 && value.stopAmount <= 1)) fail(".stopAmount must be a number from 0 to 1");
  return {
    stopColor: value.stopColor === null ? null : color(value.stopColor, "stopColor") ?? null,
    stopAmount: value.stopAmount ?? DEFAULT_PARKOUR_STYLE.stopAmount,
    number: label(value.number, "number"),
    size: label(value.size, "size"),
  };
}

function stopFilter(style) {
  let matrix = STOP_MATRIX;
  if (style.stopColor) {
    const hex = style.stopColor.length === 4 ? style.stopColor.replace(/[0-9a-f]/gi, (c) => c + c) : style.stopColor;
    const a = style.stopAmount;
    const [r, g, b] = [1, 3, 5].map((i) => format(a * parseInt(hex.slice(i, i + 2), 16) / 255));
    const k = format(1 - a);
    matrix = [k, 0, 0, 0, r, 0, k, 0, 0, g, 0, 0, k, 0, b, 0, 0, 0, 1, 0];
  }
  return { type: "filter", id: "parkour-stop", effect: { kind: "colorMatrix", matrix } };
}

function clip(resolver, key, x, y) {
  const asset = resolveImage(resolver, key, "sprite", { key });
  return asset?.href ? imageNode(asset, x - (asset.origin?.x ?? 0), y - (asset.origin?.y ?? 0)) : null;
}

// The mouse of a checkpoint nail: the editor's spawn picture, or the spawn placeholder.
function mouse(resolver) {
  const picture = clip(resolver, "AnimStatique", 0, 0);
  if (picture) return picture;
  const s = DEFAULT_MARKER_STYLES["mouse-spawn"];
  return { type: "circle", r: s.r, fill: s.fill, stroke: s.stroke };
}

// The yellow nail itself, turned as in the map, so it stays visible over the mouse. In a mirrored room the checkpoint group is
// already flipped back, so the rotation is negated the way the map's own objects are.
function nail(resolver, rotation, mirrored) {
  const picture = clip(resolver, "$Objet_22", 0, 0);
  if (!picture) return null;
  const angle = mirrored ? -rotation : rotation;
  return group({ transform: angle ? [["rotate", angle]] : null, dataParkour: "nail" }, picture);
}

// A small cheese above the mouse's right ear; crossed out in red when the checkpoint takes the cheese away.
function cheese(resolver, mode) {
  const picture = clip(resolver, "$Fromage", 0, 0);
  const s = DEFAULT_MARKER_STYLES.cheese;
  const inner = picture || { type: "circle", r: s.r * 2, fill: s.fill, stroke: s.stroke };
  const cross = mode === "remove"
    ? { type: "path", d: "M-5 -5L5 5M5 -5L-5 5", stroke: "#e02424", strokeWidth: 2.4, strokeLinecap: "round" }
    : null;
  return group({ transform: [["translate", 12, -16]], dataParkour: mode === "remove" ? "uncheese" : "cheese" }, [group({ transform: [["scale", 0.5]] }, inner), cross]);
}

/**
 * The overlay of a map's parkour checkpoints (`map.modules.parkour`). The spawn (checkpoint 1) gets the annotations only, since
 * the spawn marker already draws a mouse there; the chair (the last checkpoint) is drawn by the map itself.
 * With `nails` (the default) the nail of each checkpoint is drawn again over its mouse, as Miceditor does.
 * @param {object} data `map.modules.parkour`
 * @param {{resolver?: object, mirrored?: boolean, map?: object, nails?: boolean, visible?: Function, parkourStyle?: object}} context `map` gives the nails' rotation;
 *   `visible` leaves out the checkpoints outside the viewport (src/render/cull.js); `parkourStyle` see `resolveParkourStyle`
 */
export function renderParkour(data, { resolver = null, mirrored = false, map = null, nails = true, visible = () => true, parkourStyle = null } = {}) {
  const style = resolveParkourStyle(parkourStyle);
  const out = [];
  let stops = false;
  for (const c of data?.checkpoints ?? []) {
    if (c.kind === "chair" || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    const size = finiteOr(c.size, 1);
    const radius = Math.max(2, Math.abs(size) * 16 - 1);
    // The mouse, nail, cheese and labels all fit in this box (src/render/cull.js).
    const reach = radius + 50 + 2 * Math.max(style.number.height, style.size.height);
    if (!visible({ x: -reach, y: -reach, width: 2 * reach, height: 2 * reach }, { x: c.x, y: c.y })) continue;
    const parts = [];
    if (c.kind === "nail") {
      if (c.stop) stops = true;
      parts.push(c.stop ? group({ filter: "parkour-stop", dataParkour: "stop" }, mouse(resolver)) : mouse(resolver));
      if (nails) parts.push(nail(resolver, finiteOr(map?.objects?.[c.objectIndex]?.rotation, 0), mirrored));
    }
    // The size circle only where the size differs from the default.
    if (size !== 1) parts.push({ type: "circle", r: format(radius), fill: "none", stroke: "#ffffff", strokeOpacity: 0.85, strokeWidth: 1.5, strokeDasharray: "3 3" });
    if (c.cheese) parts.push(cheese(resolver, c.cheese));
    // The number keeps its bottom edge and the size label its top edge whatever their height, so they grow away from the mouse.
    const { number: n, size: z } = style;
    parts.push(glyphLabel(String(c.number), { y: -Math.max(30, radius + 8) - (n.height - 9) / 2, anchor: "middle", height: n.height, color: n.color, outline: n.outline }));
    if (size !== 1) parts.push(glyphLabel(`×${format(size)}`, { x: 9, y: 14 + (z.height - 7) / 2, height: z.height, color: z.color, outline: z.outline }));
    // In a mirrored room the outer transform flips the picture; the local flip keeps the checkpoint (and its labels) readable.
    const transform = [["translate", c.x, c.y], mirrored ? ["scale", -1, 1] : null].filter(Boolean);
    out.push(group({ transform, dataRole: "parkour-checkpoint", dataNumber: c.number }, parts));
  }
  if (!out.length) return null;
  return group({ dataModule: "parkour" }, [stops ? defs([stopFilter(style)]) : null, ...out]);
}
