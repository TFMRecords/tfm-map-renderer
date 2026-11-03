// Small SVG helpers shared by the renderer modules.

export function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function attr(name, value) {
  return ` ${name}="${escapeXml(value)}"`;
}

export function imageElement(asset, x, y, options = {}) {
  if (!asset?.href) return "";
  const width = asset.width ?? options.width;
  const height = asset.height ?? options.height;
  let out = `<image${attr("href", asset.href)}${attr("x", x)}${attr("y", y)}`;
  if (width != null) out += attr("width", width);
  if (height != null) out += attr("height", height);
  if (options.preserveAspectRatio) out += attr("preserveAspectRatio", options.preserveAspectRatio);
  out += "/>";
  return out;
}

export function resolveImage(resolver, source, kind, extra = {}) {
  if (!resolver?.resolve || source == null || source === "") return null;
  return resolver.resolve({ source, kind, ...extra });
}
