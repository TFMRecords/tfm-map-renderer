import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve as resolvePath } from "node:path";
import { classifyImageReference, resolveTfmImageUrl } from "./url-policy.js";

function normalizeKey(value) {
  return String(value ?? "").replace(/^\.\//, "").replaceAll("\\", "/");
}

function dataUri(mime, bytes) {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

export function createMemoryAssetResolver(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    resolve(reference) {
      const key = normalizeKey(reference.key ?? reference.source ?? "");
      const entry = map.get(key);
      if (!entry) return null;
      if (entry.href) return { ...entry, key };
      if (entry.bytes != null) {
        return { ...entry, key, href: dataUri(entry.mime ?? "application/octet-stream", entry.bytes) };
      }
      if (entry.data) {
        return { ...entry, key, href: `data:${entry.mime ?? "application/octet-stream"};base64,${entry.data}` };
      }
      return null;
    },
  };
}

export function createFilesystemAssetResolver(rootDir, manifest = null) {
  const absoluteRoot = resolvePath(rootDir);
  const byPath = new Map();
  for (const asset of manifest?.assets ?? []) {
    byPath.set(normalizeKey(asset.path), asset);
    for (const alias of asset.aliases ?? []) byPath.set(normalizeKey(alias), asset);
  }
  return {
    resolve(reference) {
      const key = normalizeKey(reference.key ?? reference.source ?? "");
      const asset = byPath.get(key) ?? { path: key };
      const filePath = resolvePath(absoluteRoot, asset.path);
      const rel = relative(absoluteRoot, filePath);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error(`Asset path escapes resolver root: ${key}`);
      }
      let bytes;
      try { bytes = readFileSync(filePath); } catch { return null; }
      return {
        ...asset,
        key,
        bytes: bytes.byteLength,
        href: dataUri(asset.mime ?? "application/octet-stream", bytes),
      };
    },
  };
}

export function createTfmImageResolver({ assets = null, external = false } = {}) {
  return {
    resolve(reference) {
      const source = String(reference.source ?? "");
      const policy = classifyImageReference(source, reference.kind ?? "standard");
      const url = resolveTfmImageUrl(source, reference.kind ?? "standard");
      const key = normalizeKey(source);

      if (assets) {
        const local = typeof assets.resolve === "function"
          ? assets.resolve({ ...reference, key, policy, url })
          : null;
        if (local) return { ...local, source, url, policy };
      }

      if (!external) return null;
      return { source, url, policy, href: url, external: true };
    },
  };
}
