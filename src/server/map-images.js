// Map images for the PNG server (docs/api/http.md#map-images): the pictures a map loads from the game's image hosts (`D`, `d`,
// ground `i`, `APS`, `ARPS`, `IP`, tiled `D`). The rasteriser fetches nothing, so the service renders once to learn which
// images the renderer asks for, fetches them from the official hosts (cached), and renders again with them embedded.
import { isOfficialHost, resolveClientImageUrl } from "../assets/image-urls.js";
import { sniffImage } from "../assets/manifest.js";

/** Renderer reference kinds of map images (src/render/svg.js) -> the image source the URL rules of the game need. */
function clientSource(reference) {
  if (reference.kind === "standard") return "D"; // D, d and IP share one rule
  if (reference.kind === "bare-name") return reference.ground ? "ground-i" : "APS"; // APS and ARPS share one rule
  if (reference.kind === "tiled") return "D-tiled";
  return null;
}

const keyOf = (reference) => `${reference.kind}\u0000${reference.source}`;

/**
 * @param {object} [config]
 * @param {Function} [config.fetchImpl] `fetch`
 * @param {"https"|"http"} [config.scheme] default https
 * @param {number} [config.maxBytes] largest image, default 4 MB
 * @param {number} [config.maxImages] most images fetched for one map, default 32
 * @param {number} [config.timeoutMs] per image, default 10000
 * @param {number} [config.cacheBytes] memory cache size, default 64 MB (failures are cached for `failureTtlMs`, default 10 min)
 * @param {boolean} [config.allowUnofficial] also load absolute URLs on other hosts, where the game can (ground `i`, tiled `D`); default false
 */
export function createMapImageFetcher({
  fetchImpl = fetch, scheme = "https", maxBytes = 4_000_000, maxImages = 32, timeoutMs = 10_000,
  cacheBytes = 64_000_000, failureTtlMs = 10 * 60_000, now = Date.now, allowUnofficial = false,
} = {}) {
  const official = (url) => allowUnofficial || isOfficialHost(new URL(url).hostname);
  const cache = new Map(); // url -> { asset | null, bytes, at } (LRU)
  const pending = new Map(); // url -> Promise, so concurrent requests share one download
  let cachedBytes = 0;

  const remember = (url, entry) => {
    cache.delete(url);
    cache.set(url, entry);
    cachedBytes += entry.bytes;
    for (const [key, old] of cache) {
      if (cachedBytes <= cacheBytes) break;
      cache.delete(key);
      cachedBytes -= old.bytes;
    }
  };

  async function download(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal, redirect: "follow" });
      if (!res.ok) return null;
      if (res.url && !official(res.url)) return null; // a redirect may not leave the official hosts
      const declared = Number(res.headers?.get?.("content-length"));
      if (declared > maxBytes) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > maxBytes) return null;
      const image = sniffImage(bytes);
      if (!image) return null;
      return { href: `data:${image.mime};base64,${bytes.toString("base64")}`, width: image.width, height: image.height, url, bytes: bytes.length };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The embedded image for one URL, from the cache or the network; `null` when it cannot be loaded. */
  async function load(url) {
    const hit = cache.get(url);
    if (hit && (hit.asset || now() - hit.at < failureTtlMs)) { cache.delete(url); cache.set(url, hit); return hit.asset; }
    if (!pending.has(url)) {
      pending.set(url, download(url).then((asset) => {
        remember(url, { asset, bytes: asset?.bytes ?? 0, at: now() });
        pending.delete(url);
        return asset;
      }));
    }
    return pending.get(url);
  }

  /**
   * Wraps `assets` (the release resolver, or null): renders through `recorder` list the map images asked for; `fetchAll`
   * loads them; `resolverWith(loaded)` answers them from the loaded images and everything else from `assets`.
   */
  function session(assets) {
    const wanted = new Map();
    const delegate = (reference) => (assets?.resolve ? assets.resolve(reference) : null);
    return {
      recorder: {
        resolve(reference) {
          if (clientSource(reference)) { wanted.set(keyOf(reference), reference); return null; }
          return delegate(reference);
        },
      },
      async fetchAll() {
        const loaded = new Map();
        const urls = new Map();
        for (const [key, reference] of wanted) {
          // Absolute URLs follow the game's rules (only ground `i` and tiled `D` can load them), then the host check.
          const resolved = resolveClientImageUrl(clientSource(reference), reference.source, { scheme, unofficialDomains: true });
          if (resolved.ok && official(resolved.url)) urls.set(key, resolved.url);
        }
        const unique = [...new Set(urls.values())].slice(0, maxImages);
        const assetsByUrl = new Map(await Promise.all(unique.map(async (url) => [url, await load(url)])));
        for (const [key, url] of urls) if (assetsByUrl.get(url)) loaded.set(key, assetsByUrl.get(url));
        return { loaded, requested: wanted.size, missing: urls.size - loaded.size };
      },
      resolverWith(loaded) {
        return {
          resolve(reference) {
            if (clientSource(reference)) return loaded.get(keyOf(reference)) ?? null;
            return delegate(reference);
          },
        };
      },
    };
  }

  return { session, load, get cacheSize() { return { entries: cache.size, bytes: cachedBytes }; } };
}
