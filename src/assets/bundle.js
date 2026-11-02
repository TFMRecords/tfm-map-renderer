import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateManifest } from "./bundle-manifest.js";
import { parseStandaloneSvg } from "./svg-normalize.js";
import { writeTar, readTar, gzipDeterministic, gunzip } from "../util/tar.js";

/** Read-only view of an extracted asset bundle (directory or tar.gz share one code path). */
export class AssetBundle {
  /** @param {Map<string,Buffer>} files */
  constructor(files) {
    const raw = files.get("manifest.json");
    if (!raw) throw new Error("asset bundle has no manifest.json");
    this.files = files;
    this.manifest = validateManifest(JSON.parse(raw.toString("utf8")));
    this._vector = new Map();
  }

  static async fromDirectory(dir) {
    return new AssetBundle(await readBundleDirectory(dir));
  }

  static fromTarGz(buf) {
    return new AssetBundle(readTar(gunzip(buf)));
  }

  /** Find an asset by numeric id, numeric string, or exported symbol/class name. */
  find(key) {
    const m = this.manifest;
    if (typeof key === "number" || /^\d+$/.test(String(key))) return m.assets[String(key)] ?? null;
    const id = m.symbols[String(key)];
    return id === undefined ? null : m.assets[String(id)];
  }

  has(key) { return this.find(key) !== null; }

  /**
   * Vector frame ready for embedding: registration point at (0,0), `bounds` in Flash coordinates.
   * @returns {{asset:object,frame:object,bounds:object,origin:object,defs:string,body:string}|null}
   */
  vector(key, frameNumber = 1) {
    const asset = this.find(key);
    if (!asset || asset.kind === "image") return null;
    const frame = asset.frames[Math.min(Math.max(frameNumber, 1), asset.frames.length) - 1];
    const cacheKey = frame.file;
    let parsed = this._vector.get(cacheKey);
    if (!parsed) {
      const file = this.files.get(frame.file);
      if (!file) throw new Error(`bundle is missing ${frame.file}`);
      parsed = parseStandaloneSvg(file.toString("utf8"));
      this._vector.set(cacheKey, parsed);
    }
    return { asset, frame, ...parsed };
  }

  image(key) {
    const asset = this.find(key);
    if (!asset || asset.kind !== "image") return null;
    const bytes = this.files.get(asset.file);
    if (!bytes) throw new Error(`bundle is missing ${asset.file}`);
    return { asset, bytes, width: asset.width, height: asset.height };
  }
}

export async function readBundleDirectory(dir) {
  const files = new Map();
  async function walk(rel) {
    for (const entry of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) await walk(r);
      else files.set(r, await readFile(path.join(dir, r)));
    }
  }
  await walk("");
  return files;
}

export async function writeBundleDirectory(dir, files) {
  for (const [name, data] of files) {
    const target = path.join(dir, ...name.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }
}

/** Pack a bundle (Map of relative path -> bytes) into a deterministic tar.gz. */
export function packBundle(files) {
  if (!files.has("manifest.json")) throw new Error("cannot pack a bundle without manifest.json");
  validateManifest(JSON.parse(files.get("manifest.json").toString("utf8")));
  const tar = writeTar([...files].map(([name, data]) => ({ name, data })));
  const gz = gzipDeterministic(tar);
  return { data: gz, sha256: createHash("sha256").update(gz).digest("hex") };
}

export function bundleFileName(manifest) {
  return `tfm-assets-v${manifest.version}-${manifest.source.swf.sha256.slice(0, 12)}.tar.gz`;
}
