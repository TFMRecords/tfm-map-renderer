import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { readSwf } from "../swf/reader.js";
import { runFfdec, buildExportArgs } from "./ffdec.js";
import { normalizeFfdecSvg, standaloneSvg } from "./svg-normalize.js";
import { buildManifest } from "./bundle-manifest.js";

export const EXTRACTOR_VERSION = "0.1.0";

export function pngSize(buf) {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString("latin1", 12, 16) === "IHDR") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  return null;
}

/** Rows for `tfm-assets inspect`: what the SWF contains, without needing Java. */
export function inspectSwf(swf, { match = null, kinds = null } = {}) {
  const rows = [];
  for (const c of swf.characters.values()) {
    if (kinds && !kinds.includes(c.kind)) continue;
    if (match && !(c.names ?? []).some((n) => match.test(n))) continue;
    rows.push({
      id: c.id, kind: c.kind, names: c.names ?? [], frames: c.frameCount ?? null,
      width: c.bounds?.width ?? c.width ?? null, height: c.bounds?.height ?? c.height ?? null,
    });
  }
  return rows.sort((a, b) => a.id - b.id);
}

/** Map an FFDec export path (relative to its output root) to what it contains. */
export function classifyExport(rel) {
  const parts = rel.split(/[\\/]/);
  let m;
  if (parts[0] === "shapes" && parts.length === 2 && (m = /^(\d+)(?:_.*)?\.svg$/.exec(parts[1]))) {
    return { kind: "shape", id: Number(m[1]) };
  }
  if (parts[0] === "sprites" && parts.length === 3) {
    const dir = /^DefineSprite_(\d+)(?:_.*)?$/.exec(parts[1]);
    const frame = /^(\d+)\.svg$/.exec(parts[2]);
    if (dir && frame) return { kind: "sprite", id: Number(dir[1]), frame: Number(frame[1]) };
  }
  if (parts[0] === "images" && parts.length === 2 && (m = /^(\d+)(?:_.*)?\.(png|jpe?g|gif)$/i.exec(parts[1]))) {
    return { kind: "image", id: Number(m[1]), ext: m[2].toLowerCase() };
  }
  return null;
}

async function listFiles(root) {
  const out = [];
  async function walk(rel) {
    for (const e of await readdir(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(r); else out.push(r);
    }
  }
  await walk("");
  return out;
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * Extract static vector/raster assets from a SWF into an in-memory bundle (path -> bytes).
 *
 * @param {object} options
 * @param {string} options.swfPath
 * @param {string} options.jar path to ffdec-cli.jar
 * @param {string} [options.java]
 * @param {"named"|"all"} [options.scope="named"] anonymous characters are usually sprite internals
 * @param {("shape"|"sprite"|"image")[]} [options.kinds]
 * @param {RegExp|null} [options.match] only characters with a symbol name matching this
 * @param {number[]|null} [options.ids]
 * @param {"all"|"first"} [options.frames="all"]
 * @param {number} [options.chunkSize=400]
 * @param {Function} [options.runner] injectable for tests
 */
export async function extractAssets({
  swfPath, jar, java = "java", scope = "named", kinds = ["shape", "sprite", "image"], match = null, ids = null,
  frames = "all", chunkSize = 400, runner = runFfdec, ffdecVersion = "custom", log = () => {},
}) {
  const swfBuf = await readFile(swfPath);
  const swf = readSwf(swfBuf);
  const warnings = [];

  const wanted = [...swf.characters.values()].filter((c) => {
    if (!kinds.includes(c.kind) || !["shape", "sprite", "image"].includes(c.kind)) return false;
    if (ids && !ids.includes(c.id)) return false;
    if (scope === "named" && !(c.names?.length)) return false;
    if (match && !(c.names ?? []).some((n) => match.test(n))) return false;
    return true;
  });
  if (wanted.length === 0) {
    throw new Error(`nothing to extract: ${swf.characters.size} characters, ${swf.symbols.length} symbols (scope=${scope}${match ? `, match=${match}` : ""})`);
  }
  const byId = new Map(wanted.map((c) => [c.id, c]));

  const raw = await mkdtemp(path.join(os.tmpdir(), "tfm-ffdec-"));
  const files = new Map();
  const assets = new Map();
  try {
    const sorted = [...byId.keys()].sort((a, b) => a - b);
    for (const [i, ch] of chunk(sorted, chunkSize).entries()) {
      log(`ffdec export chunk ${i + 1}/${Math.ceil(sorted.length / chunkSize)} (${ch.length} characters)`);
      // Always request all three types: with a single type FFDec drops the `shapes/`/`sprites/`/`images/` directory
      // and classifyExport would no longer recognise the files.
      const types = ["shape", "sprite", "image"];
      const firstFrameIds = frames === "first" ? ch.filter((id) => byId.get(id).kind === "sprite" && byId.get(id).frameCount > 1) : [];
      await runner({ java, jar, args: buildExportArgs({ swfPath, outDir: raw, types, selectIds: ch, firstFrameIds }) });
    }

    const exported = [];
    for (const rel of await listFiles(raw)) {
      const info = classifyExport(rel);
      if (info && byId.has(info.id) && byId.get(info.id).kind === info.kind) exported.push({ ...info, rel });
    }
    exported.sort((a, b) => a.id - b.id || (a.frame ?? 0) - (b.frame ?? 0));

    for (const e of exported) {
      const ch = byId.get(e.id);
      const names = [...(ch.names ?? [])];
      if (e.kind === "image") {
        const bytes = await readFile(path.join(raw, e.rel));
        const file = `images/${e.id}.${e.ext === "jpeg" ? "jpg" : e.ext}`;
        files.set(file, bytes);
        const size = pngSize(bytes);
        assets.set(e.id, { id: e.id, kind: "image", names, file, width: size?.width ?? ch.width ?? null, height: size?.height ?? ch.height ?? null });
        continue;
      }
      const source = await readFile(path.join(raw, e.rel), "utf8");
      const frame = e.frame ?? 1;
      let n;
      try { n = normalizeFfdecSvg(source, { idPrefix: `a${e.id}${e.kind === "sprite" ? `f${frame}` : ""}_` }); }
      catch (err) { warnings.push(`svg-normalize-failed:${e.id}:${frame}:${err.message}`); continue; }
      for (const d of n.diagnostics) warnings.push(`svg:${e.id}:${frame}:${d}`);
      const file = e.kind === "shape" ? `svg/shapes/${e.id}.svg` : `svg/sprites/${e.id}${frame === 1 ? "" : `_f${frame}`}.svg`;
      files.set(file, Buffer.from(standaloneSvg(n)));
      let asset = assets.get(e.id);
      if (!asset) { asset = { id: e.id, kind: e.kind, names, frames: [] }; assets.set(e.id, asset); }
      asset.frames.push({ file, width: n.width, height: n.height, origin: n.origin, ...(n.hasImages ? { hasImages: true } : {}) });
    }

    for (const id of byId.keys()) if (!assets.has(id)) warnings.push(`not-exported:${id}`);
  } finally {
    await rm(raw, { recursive: true, force: true });
  }

  const manifest = buildManifest({
    swf: {
      name: path.basename(swfPath), sha256: createHash("sha256").update(swfBuf).digest("hex"), size: swfBuf.length,
      swfVersion: swf.version, stage: swf.frameSize, compression: swf.compression,
    },
    ffdecVersion, extractorVersion: EXTRACTOR_VERSION, assets: [...assets.values()], warnings,
  });
  files.set("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
  return { manifest, files };
}
