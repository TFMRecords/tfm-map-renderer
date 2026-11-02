import { parseXml, elementChildren } from "../xml/parse.js";

// Normalizes FFDec SVG exports.
//
// Observed FFDec 26.3.0 output (verified against real exports): the root <svg> has width/height
// in px and NO viewBox. All content sits in a first-level <g transform="matrix(1,0,0,1,tx,ty)">
// where (tx,ty) = -(content bounds min), i.e. (tx,ty) is the Flash registration point expressed
// in image space. Sprite frames additionally carry a <defs> block with ids like "shape0".
//
// Normalized form: content keeps Flash coordinates (registration point at 0,0) so placing an
// asset at map point (x,y) is simply translate(x,y). `origin` is the registration point in the
// original image, `bounds` the content rectangle in Flash coordinates.

const XML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => XML_ESC[c]);

function px(value) {
  const n = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : null;
}

export function parseMatrix(value) {
  const m = /^\s*matrix\(\s*([^)]*)\)\s*$/.exec(value ?? "");
  if (!m) return null;
  const n = m[1].split(/[\s,]+/).filter(Boolean).map(Number);
  return n.length === 6 && n.every(Number.isFinite) ? { a: n[0], b: n[1], c: n[2], d: n[3], e: n[4], f: n[5] } : null;
}

const isIdentityLinear = (m) => m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1;

function rewriteIds(value, prefix) {
  return value
    .replace(/url\(\s*#([^)\s]+)\s*\)/g, (_, id) => `url(#${prefix}${id})`);
}

const WHITESPACE_SENSITIVE = new Set(["text", "tspan", "style", "textPath"]);

function emit(node, ctx, parentName = "") {
  if (node.kind === "text") {
    if (node.value.trim() === "" && !WHITESPACE_SENSITIVE.has(parentName)) return "";
    return esc(node.value);
  }
  if (node.kind === "cdata") return `<![CDATA[${node.value}]]>`;
  if (node.kind !== "element") return "";
  const attrs = [];
  for (const attr of node.attributes) {
    const name = attr.name;
    if (name.startsWith("ffdec:") || name === "xmlns:ffdec") continue;
    if (name === "xmlns" || name === "xmlns:xlink") continue; // re-declared on the wrapper
    let value = attr.value;
    if (name === "id") { value = ctx.prefix + value; ctx.ids.add(attr.value); }
    else if (name === "href" || name === "xlink:href") { if (value.startsWith("#")) value = `#${ctx.prefix}${value.slice(1)}`; }
    else value = rewriteIds(value, ctx.prefix);
    if (name === "xlink:href") ctx.usesXlink = true;
    attrs.push(` ${name}="${esc(value)}"`);
  }
  if (node.name === "image") ctx.hasImages = true;
  const inner = node.children.map((c) => emit(c, ctx, node.name)).join("");
  return inner ? `<${node.name}${attrs.join("")}>${inner}</${node.name}>` : `<${node.name}${attrs.join("")}/>`;
}

/**
 * @param {string} source FFDec SVG text
 * @param {{idPrefix:string}} options idPrefix namespaces every id/reference (e.g. "a123_")
 */
export function normalizeFfdecSvg(source, { idPrefix }) {
  const doc = parseXml(source);
  const root = doc.root;
  if (root.name !== "svg") throw new Error(`expected <svg> root, got <${root.name}>`);
  const width = px(root.attributes.find((a) => a.name === "width")?.value);
  const height = px(root.attributes.find((a) => a.name === "height")?.value);
  if (width === null || height === null) throw new Error("svg is missing width/height");

  const kids = elementChildren(root);
  const content = kids.find((k) => k.name === "g");
  const defs = kids.filter((k) => k.name === "defs");
  const matrix = parseMatrix(content?.attributes.find((a) => a.name === "transform")?.value);

  const diagnostics = [];
  let origin = { x: 0, y: 0 };
  let body;
  const ctx = { prefix: idPrefix, ids: new Set(), hasImages: false, usesXlink: false };
  if (content && matrix && isIdentityLinear(matrix)) {
    origin = { x: matrix.e, y: matrix.f };
    // Drop the bounds-shift wrapper: children already live in Flash coordinates.
    body = content.children.map((c) => emit(c, ctx, "g")).join("");
  } else if (content) {
    if (!matrix) diagnostics.push("root-group-without-matrix");
    else diagnostics.push("root-group-non-identity-linear-part");
    body = emit(content, ctx);
  } else {
    body = "";
    diagnostics.push("no-content-group");
  }
  const defsXml = defs.map((d) => d.children.map((c) => emit(c, ctx, "defs")).join("")).join("");

  return {
    width, height, origin,
    bounds: { x: -origin.x, y: -origin.y, width, height },
    hasImages: ctx.hasImages,
    diagnostics,
    defs: defsXml,
    body,
    usesXlink: ctx.usesXlink,
  };
}

/** Self-contained SVG for viewing one normalized asset, registration point at the user-space origin. */
export function standaloneSvg(n) {
  const { x, y, width, height } = n.bounds;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}">`
    + (n.defs ? `<defs>${n.defs}</defs>` : "") + n.body + "</svg>\n";
}

/** Parse a standalone SVG produced by standaloneSvg back into the fields the renderer needs. */
export function parseStandaloneSvg(source) {
  const doc = parseXml(source);
  const root = doc.root;
  const vb = (root.attributes.find((a) => a.name === "viewBox")?.value ?? "").split(/\s+/).map(Number);
  if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v))) throw new Error("standalone svg lacks a valid viewBox");
  const kids = elementChildren(root);
  const defs = kids.find((k) => k.name === "defs");
  const slice = (n) => source.slice(n.start, n.end);
  const defsInner = defs ? source.slice(defs.openEnd, defs.closeStart) : "";
  const bodyStart = defs ? defs.end : root.openEnd;
  const body = source.slice(bodyStart, root.closeStart);
  void slice;
  return { bounds: { x: vb[0], y: vb[1], width: vb[2], height: vb[3] }, origin: { x: -vb[0], y: -vb[1] }, defs: defsInner, body };
}
