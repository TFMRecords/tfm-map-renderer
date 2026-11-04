// The scene: what `renderTfmScene` draws, as a tree of plain objects, before it becomes SVG (`sceneToSvg`) or pixels. The node
// types are a small, fixed subset of SVG with semantic values (transforms as operations, filters as effects), so a backend
// can draw them without parsing SVG; docs/rendering.md#scene lists them.
//
// A node is `{ type, ...properties, children? }`. Properties are written in their insertion order (`fillOpacity` becomes
// `fill-opacity`, `dataRole` `data-role`); null and undefined ones are left out. `children` may nest arrays and hold null or
// false entries, which draw nothing.
import { escapeXml } from "./svg-util.js";
import { flashBlurPrimitives } from "../util/flash-blur.js";

/** Types whose element always has a closing tag, even with no children. */
const CONTAINERS = new Set(["svg", "g", "defs", "clipPath", "symbol", "text"]);
/** Properties written under another name, or not as attributes. */
const SKIP = new Set(["type", "children", "text", "effect", "region"]);
const SVG_NAMES = { viewBox: "viewBox", preserveAspectRatio: "preserveAspectRatio", clipPath: "clip-path" };

const attrName = (key) => SVG_NAMES[key] ?? key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** `[["translate", x, y], ["rotate", a], ...]` as an SVG transform list. */
export function transformText(ops) {
  return ops.map(([name, ...args]) => `${name}(${args.join(" ")})`).join(" ");
}

function attrValue(key, value) {
  if (key === "transform") return transformText(value);
  if (key === "clipPath" || key === "filter") return `url(#${value})`;
  if (key === "blend") return `mix-blend-mode:${value}`;
  return value;
}

function attributes(node) {
  let out = "";
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (SKIP.has(key) || value == null) continue;
    out += ` ${key === "blend" ? "style" : attrName(key)}="${escapeXml(attrValue(key, value))}"`;
  }
  return out;
}

const matrixText = (m) => [0, 5, 10, 15].map((i) => m.slice(i, i + 5).join(" ")).join("  ");

/** The primitives of a filter effect. */
function effectSvg(effect) {
  if (effect.kind === "colorMatrix") return `<feColorMatrix type="matrix" values="${matrixText(effect.matrix)}"/>`;
  if (effect.kind === "glow") {
    // Flash's GlowFilter: the alpha blurred (Flash's box blurs, or a Gaussian with `flash: false`), times `strength`, in `color`, under the picture.
    const blur = effect.flash
      ? flashBlurPrimitives(effect.blurX, effect.blurY, effect.passes, "SourceAlpha", "b", "hb")
      : `<feGaussianBlur in="SourceAlpha" stdDeviation="${effect.blurX / 2}" result="b"/>`;
    return `${blur}<feComponentTransfer in="b" result="s"><feFuncA type="linear" slope="${effect.strength}"/></feComponentTransfer>`
      + `<feFlood flood-color="${effect.color}" result="c"/><feComposite in="c" in2="s" operator="in" result="g"/>`
      + `<feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>`;
  }
  throw new TypeError(`unknown filter effect "${effect.kind}"`);
}

function write(node, out) {
  if (node == null || node === false) return;
  if (Array.isArray(node)) {
    for (const child of node) write(child, out);
    return;
  }
  switch (node.type) {
    case "comment":
      out.push(`<!-- ${node.text} -->`);
      return;
    case "filter": {
      const r = node.region;
      out.push(`<filter id="${node.id}" color-interpolation-filters="sRGB"${r ? ` x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"` : ""}>${effectSvg(node.effect)}</filter>`);
      return;
    }
    default: {
      const open = `<${node.type}${node.type === "svg" ? ' xmlns="http://www.w3.org/2000/svg"' : ""}${attributes(node)}`;
      if (!CONTAINERS.has(node.type)) {
        out.push(`${open}/>`);
        return;
      }
      out.push(`${open}>`);
      if (node.text != null) out.push(escapeXml(node.text));
      write(node.children, out);
      out.push(`</${node.type}>`);
    }
  }
}

/** The SVG text of a scene (or of a node, or an array of nodes). */
export function sceneToSvg(node) {
  const out = [];
  write(node, out);
  return out.join("");
}

/** An `<image>` of a resolved asset at (x, y), sized by the asset (or `options`); null when the asset has no href. */
export function imageNode(asset, x, y, options = {}) {
  if (!asset?.href) return null;
  return {
    type: "image",
    href: asset.href,
    x,
    y,
    width: asset.width ?? options.width,
    height: asset.height ?? options.height,
    preserveAspectRatio: options.preserveAspectRatio,
    blend: options.blend,
  };
}

/** A group: `props` (transform, clipPath, filter, data*) then its children. */
export function group(props, children) {
  return { type: "g", ...props, children };
}

/** A `<defs>` holding the given definitions (clip paths, filters, symbols); null when there are none. */
export function defs(children) {
  return children.length ? { type: "defs", children } : null;
}

/** True when a fragment (a node, an array of nodes, or nothing) draws nothing at all. */
export function isEmpty(fragment) {
  if (fragment == null || fragment === false) return true;
  return Array.isArray(fragment) ? fragment.every(isEmpty) : false;
}
