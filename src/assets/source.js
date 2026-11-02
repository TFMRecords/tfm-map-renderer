// Where an asset bundle comes from. The location is configuration, never hard-coded: a local directory
// or archive, a direct URL to an archive, or a GitHub release asset. A failed or missing source is a normal
// condition (offline use), reported through `loadAssetBundleOrNull` so a renderer can fall back to its
// built-in placeholders (src/render/default-assets.js).
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { AssetBundle } from "./bundle.js";
import { readZip } from "../util/zip.js";

export class AssetSourceError extends Error {
  constructor(message, options) { super(message, options); this.name = "AssetSourceError"; }
}

/**
 * @typedef {string | {type:"directory"|"file", path:string}
 *   | {type:"url", url:string, sha256?:string}
 *   | {type:"github-release", repo:string, asset:string, tag?:string, sha256?:string}} AssetLocation
 *
 * A bare string is a URL when it starts with http(s)://, otherwise a local path (a directory is read as an
 * extracted bundle, a file as a `.tar.gz` or `.zip` archive). `tag` defaults to the latest release.
 */

/** Normalize any accepted location into `{type, ...}`; throws AssetSourceError for an unusable one. */
export function normalizeAssetLocation(location) {
  if (typeof location === "string") {
    return /^https?:\/\//i.test(location) ? { type: "url", url: location } : { type: "path", path: location };
  }
  if (!location || typeof location !== "object") throw new AssetSourceError("asset location must be a string or an object");
  switch (location.type) {
    case "directory": case "file": return { type: "path", path: String(location.path ?? "") };
    case "url":
      if (!/^https?:\/\//i.test(location.url ?? "")) throw new AssetSourceError("url location needs an http(s) url");
      return { type: "url", url: location.url, sha256: location.sha256 };
    case "github-release": {
      if (!/^[\w.-]+\/[\w.-]+$/.test(location.repo ?? "")) throw new AssetSourceError('github-release needs repo "owner/name"');
      if (!location.asset) throw new AssetSourceError("github-release needs an asset file name");
      return { type: "url", url: githubReleaseUrl(location), sha256: location.sha256 };
    }
    default: throw new AssetSourceError(`unknown asset location type: ${location.type}`);
  }
}

/** Download URL of a GitHub release asset; `tag` omitted or "latest" means the latest release. */
export function githubReleaseUrl({ repo, asset, tag = "latest" }) {
  const base = `https://github.com/${repo}/releases`;
  return tag === "latest" ? `${base}/latest/download/${encodeURIComponent(asset)}` : `${base}/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
}

/** Build a bundle from archive bytes: gzip -> tar.gz, "PK" -> zip (a single top-level folder is stripped). */
export function bundleFromArchive(bytes) {
  const buf = Buffer.from(bytes);
  if (buf[0] === 0x1f && buf[1] === 0x8b) return AssetBundle.fromTarGz(buf);
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const files = new Map();
    for (const e of readZip(buf)) if (!e.isDirectory) files.set(e.name.replaceAll("\\", "/"), e.data());
    return new AssetBundle(stripCommonRoot(files));
  }
  throw new AssetSourceError("asset archive is neither tar.gz nor zip");
}

function stripCommonRoot(files) {
  if (files.has("manifest.json")) return files;
  const roots = new Set([...files.keys()].map((k) => k.split("/")[0]));
  if (roots.size !== 1) return files;
  const root = [...roots][0] + "/";
  if (![...files.keys()].every((k) => k.startsWith(root))) return files;
  return new Map([...files].map(([k, v]) => [k.slice(root.length), v]));
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Load an asset bundle from a configured location.
 * @param {AssetLocation} location
 * @param {{fetch?:typeof fetch, cacheDir?:string, refresh?:boolean}} [options]
 *   `cacheDir`: downloaded archives are kept there and reused when the network is unavailable
 *   (`refresh: true` skips the cache read when online but still falls back to it on failure).
 * @returns {Promise<AssetBundle>}
 */
export async function loadAssetBundle(location, options = {}) {
  const loc = normalizeAssetLocation(location);
  if (loc.type === "path") {
    let info;
    try { info = await stat(loc.path); } catch (cause) { throw new AssetSourceError(`asset path not found: ${loc.path}`, { cause }); }
    return info.isDirectory() ? AssetBundle.fromDirectory(loc.path) : bundleFromArchive(await readFile(loc.path));
  }
  const doFetch = options.fetch ?? globalThis.fetch;
  const cacheFile = options.cacheDir ? path.join(options.cacheDir, `${sha256(Buffer.from(loc.url)).slice(0, 16)}.archive`) : null;
  let bytes = null;
  let fetchError = null;
  if (cacheFile && !options.refresh) bytes = await readFile(cacheFile).catch(() => null);
  if (!bytes) {
    try {
      if (typeof doFetch !== "function") throw new AssetSourceError("no fetch implementation available");
      const res = await doFetch(loc.url, { redirect: "follow" });
      if (!res.ok) throw new AssetSourceError(`GET ${loc.url} -> ${res.status}`);
      bytes = Buffer.from(await res.arrayBuffer());
      if (loc.sha256 && sha256(bytes) !== loc.sha256.toLowerCase()) throw new AssetSourceError(`sha256 mismatch for ${loc.url}`);
      if (cacheFile) { await mkdir(options.cacheDir, { recursive: true }); await writeFile(cacheFile, bytes); }
    } catch (error) {
      fetchError = error;
      bytes = cacheFile ? await readFile(cacheFile).catch(() => null) : null;
      if (!bytes) throw error instanceof AssetSourceError ? error : new AssetSourceError(`could not download ${loc.url}: ${error.message}`, { cause: error });
    }
  }
  if (loc.sha256 && sha256(bytes) !== loc.sha256.toLowerCase()) throw new AssetSourceError(`sha256 mismatch for ${loc.url}`);
  void fetchError;
  return bundleFromArchive(bytes);
}

/** Like loadAssetBundle but resolves to `null` on any failure (offline, 404, bad archive); `onError` is told why. */
export async function loadAssetBundleOrNull(location, options = {}) {
  try { return await loadAssetBundle(location, options); } catch (error) { options.onError?.(error); return null; }
}
