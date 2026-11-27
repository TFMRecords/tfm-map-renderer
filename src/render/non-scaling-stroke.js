// Flash keeps a line drawn without line scaling the same width however its clip is scaled. FFDec marks those lines
// `vector-effect="non-scaling-stroke"`, which resvg ignores, so a clip stretched to a small ground loses them: the outline of the
// `$Sol_Dur` plank, `$Glacon` and the other stretched ground clips (docs/rendering.md#grounds). `bakeNonScalingStrokes` rewrites
// the clip for one placement size: each such path gets its points in the placed picture's pixels and the inverse of its
// parent's transform, so its stroke width is counted in pixels again. A `use` whose shape holds such a path is inlined first,
// because a shape can be placed more than once with different transforms.
import { parseXml } from "../xml/parse.js";
import { multiplyMatrix } from "./scene-bounds.js";

const NON_SCALING = "non-scaling-stroke";
const IDENTITY = [1, 0, 0, 1, 0, 0];
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);
const num = (n) => String(Math.round(n * 1000) / 1000);
const matrixText = (m) => `matrix(${m.map(num).join(" ")})`;
const attr = (node, name) => node.attributes.find((a) => a.name === name)?.value;
const elements = (node) => node.children.filter((c) => c.kind === "element");

/** The matrix of an SVG `transform` attribute (identity when absent; null when it cannot be read). */
function parseTransform(value) {
  let m = IDENTITY;
  const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g;
  const rest = String(value ?? "").replace(re, "").replace(/[\s,]/g, "");
  if (rest) return null;
  for (const [, name, args] of String(value ?? "").matchAll(re)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    if (!a.every(Number.isFinite)) return null;
    let n;
    if (name === "matrix" && a.length === 6) n = a;
    else if (name === "translate" && (a.length === 1 || a.length === 2)) n = [1, 0, 0, 1, a[0], a[1] ?? 0];
    else if (name === "scale" && (a.length === 1 || a.length === 2)) n = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (name === "rotate" && a.length === 1) { const r = (a[0] * Math.PI) / 180; n = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]; }
    else return null;
    m = multiplyMatrix(m, n);
  }
  return m;
}

function invert([a, b, c, d, e, f]) {
  const det = a * d - b * c;
  if (!det || !Number.isFinite(det)) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/**
 * A path's data with every point mapped through `m`, written with absolute commands (H and V become L). Lines and
 * quadratic and cubic curves map exactly; null for arcs or anything unreadable.
 */
export function transformPathData(d, m) {
  const tokens = String(d ?? "").match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const apply = (x, y) => `${num(m[0] * x + m[2] * y + m[4])} ${num(m[1] * x + m[3] * y + m[5])}`;
  const out = [];
  let i = 0, command = null, x = 0, y = 0, startX = 0, startY = 0;
  const number = () => {
    const n = Number(tokens[i++]);
    if (!Number.isFinite(n)) throw new SyntaxError("bad number in path");
    return n;
  };
  const point = (relative) => {
    const px = number() + (relative ? x : 0), py = number() + (relative ? y : 0);
    return [px, py];
  };
  try {
    while (i < tokens.length) {
      if (/^[a-zA-Z]$/.test(tokens[i])) command = tokens[i++];
      else if (command === null) return null;
      const relative = command === command.toLowerCase();
      switch (command.toUpperCase()) {
        case "M": {
          [x, y] = point(relative);
          [startX, startY] = [x, y];
          out.push(`M${apply(x, y)}`);
          command = relative ? "l" : "L";
          break;
        }
        case "L": [x, y] = point(relative); out.push(`L${apply(x, y)}`); break;
        case "H": x = number() + (relative ? x : 0); out.push(`L${apply(x, y)}`); break;
        case "V": y = number() + (relative ? y : 0); out.push(`L${apply(x, y)}`); break;
        case "Q": case "S": {
          const c = point(relative), p = point(relative);
          out.push(`${command.toUpperCase()}${apply(...c)} ${apply(...p)}`);
          [x, y] = p;
          break;
        }
        case "T": [x, y] = point(relative); out.push(`T${apply(x, y)}`); break;
        case "C": {
          const c1 = point(relative), c2 = point(relative), p = point(relative);
          out.push(`C${apply(...c1)} ${apply(...c2)} ${apply(...p)}`);
          [x, y] = p;
          break;
        }
        case "Z": [x, y] = [startX, startY]; out.push("Z"); command = null; break;
        default: return null;
      }
    }
  } catch {
    return null;
  }
  return out.join("");
}

function startTag(node, skip = new Set(), extra = "") {
  const attrs = node.attributes.filter((a) => !skip.has(a.name)).map((a) => ` ${a.name}="${esc(a.value)}"`).join("");
  return `<${node.name}${attrs}${extra}`;
}

function emit(node) {
  if (node.kind === "text") return esc(node.value);
  if (node.kind !== "element") return "";
  const inner = node.children.map(emit).join("");
  return inner ? `${startTag(node)}>${inner}</${node.name}>` : `${startTag(node)}/>`;
}

/**
 * The clip's SVG drawn at `width` x `height` pixels (its view box stretched to that size, as `preserveAspectRatio="none"`
 * does) with its non-scaling strokes as wide as Flash draws them; null when the SVG has none or cannot be read.
 * @param {string} svg a standalone SVG with a view box (src/assets/svg-normalize.js `standaloneSvg`)
 */
export function bakeNonScalingStrokes(svg, width, height) {
  if (!String(svg).includes(NON_SCALING) || !(width > 0 && height > 0)) return null;
  let root;
  try { root = parseXml(svg).root; } catch { return null; }
  if (root?.name !== "svg") return null;
  const vb = String(attr(root, "viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || !vb.every(Number.isFinite) || !(vb[2] > 0 && vb[3] > 0)) return null;

  const ids = new Map();
  const index = (node) => { for (const c of elements(node)) { const id = attr(c, "id"); if (id != null) ids.set(id, c); index(c); } };
  index(root);
  const target = (use) => ids.get(String(attr(use, "xlink:href") ?? attr(use, "href") ?? "").replace(/^#/, ""));
  const isNonScaling = (node) => node.name === "path" && attr(node, "vector-effect") === NON_SCALING
    // A fill or a paint server in user space would move with the new coordinates; FFDec's outlines have neither.
    && attr(node, "fill") === "none" && !/url\(/.test(String(attr(node, "stroke") ?? ""));
  const holds = new Map();
  const holdsNonScaling = (node, depth = 0) => {
    if (depth > 32) return false;
    if (holds.has(node)) return holds.get(node);
    const t = node.name === "use" ? target(node) : null;
    const result = isNonScaling(node) || (t ? holdsNonScaling(t, depth + 1) : elements(node).some((c) => holdsNonScaling(c, depth + 1)));
    holds.set(node, result);
    return result;
  };

  // `ctm`: the matrix from the node's parent to the placed picture's pixels.
  const walk = (node, ctm, depth = 0) => {
    if (node.kind !== "element") return emit(node);
    if (depth > 32 || !holdsNonScaling(node)) return emit(node);
    const own = parseTransform(attr(node, "transform"));
    if (!own) return emit(node);
    if (isNonScaling(node)) {
      const inverse = invert(ctm);
      const d = inverse && transformPathData(attr(node, "d"), multiplyMatrix(ctm, own));
      if (!d) return emit(node);
      return `${startTag(node, new Set(["d", "transform", "vector-effect"]), ` d="${d}" transform="${matrixText(inverse)}"`)}/>`;
    }
    if (node.name === "use") {
      const t = target(node);
      const place = multiplyMatrix(own, [1, 0, 0, 1, Number(attr(node, "x")) || 0, Number(attr(node, "y")) || 0]);
      if (!t || t.name !== "g") return emit(node);
      const skip = new Set(["href", "xlink:href", "x", "y", "width", "height", "transform"]);
      return `${startTag(node, skip, ` transform="${matrixText(place)}"`).replace(/^<use/, "<g")}>${walk({ ...t, attributes: t.attributes.filter((a) => a.name !== "id") }, multiplyMatrix(ctm, place), depth + 1)}</g>`;
    }
    const inner = node.children.map((c) => walk(c, multiplyMatrix(ctm, own), depth + 1)).join("");
    return `${startTag(node)}>${inner}</${node.name}>`;
  };

  const sx = width / vb[2], sy = height / vb[3];
  const outer = [sx, 0, 0, sy, -vb[0] * sx, -vb[1] * sy];
  const body = root.children.map((c) => (c.kind === "element" && c.name === "defs" ? emit(c) : walk(c, outer))).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">`
    + `<g transform="${matrixText(outer)}">${body}</g></svg>`;
}
