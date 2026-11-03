// The URLs the game requests for the images a map refers to (docs/xml/images.md#image-urls):
//  - D, d, IP: the transformice.com base, plus a "?c=<cache id>" suffix. An absolute URL is prefixed too, so it
//    cannot load.
//  - APS, ARPS: a bare "name.ext" uses "http://images.atelier801.com/"; anything else the transformice.com base.
//    No "?c=" suffix.
//  - Ground `i` ("x,y,url", the URL is field 3): a bare name.ext uses images.atelier801.com. Otherwise: in
//    "#Module" maps the transformice.com base is prefixed; in other maps a value without "://" gets the same base,
//    and a value WITH "://" is loaded as written. So, unlike D/d/IP/APS/ARPS, ground `i` can load absolute URLs.
//  - Particle `img`: the transformice.com base, no "?c=".
//  - Tiled background `D="#url,w,h"`: a URL containing "://" is loaded as written, anything else gets the
//    transformice.com base; no atelier801 rule, no "?c=".

import { IMAGE_BASES, ATELIER801_BARE_IMAGE_RE } from "./url-policy.js";

// Single source of truth lives in url-policy.js; these names are kept for the validating resolver.
export const OFFICIAL_BASES = IMAGE_BASES;

/**
 * Hosts accepted without the `unofficialDomains` flag.
 */
export const OFFICIAL_HOSTS = Object.freeze(["www.transformice.com", "images.atelier801.com"]);

// A bare file name. No `g` flag, so there is no lastIndex state to leak between calls.
const BARE_FILENAME = ATELIER801_BARE_IMAGE_RE;

const ABSOLUTE = /:\/\//;
const MAX_URL_LENGTH = 2048;

function withScheme(base, scheme) {
  return scheme === "https" ? base.replace(/^http:/, "https:") : base;
}

function unsafePath(raw) {
  if (raw.length > MAX_URL_LENGTH) return "too-long";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return "invalid-character";
  return null;
}

/**
 * Resolve the URL the game would request for a map image reference.
 *
 * @param {"D"|"d"|"IP"|"APS"|"ARPS"|"ground-i"|"particle"|"D-tiled"} source which map attribute the string came from
 *   (for "ground-i" pass the URL field of `ground.imageParts`, not the whole `i` value)
 * @param {string} raw the URL string exactly as it appears in the map
 * @param {object} [options]
 * @param {"http"|"https"} [options.scheme="http"] client-exact is http; browsers usually need https
 * @param {boolean} [options.unofficialDomains=false] allow absolute http(s) URLs. The game only supports
 *   them for ground `i` outside #Module maps; this tool additionally requires the explicit opt-in everywhere
 * @param {boolean} [options.moduleMode=false] the map was loaded in "#Module" mode
 * @param {string|number} [options.cacheId] the game's cache-buster, appended to D, d and IP as ?c=<cacheId>
 * @returns {{ok:true,url:string,cacheKey:string,host:string,rule:string,provenance:string,source:string,clientUrl:string}
 *          |{ok:false,reason:string,source:string}}
 */
export function resolveClientImageUrl(source, raw, options = {}) {
  const scheme = options.scheme ?? "http";
  const value = raw == null ? "" : String(raw);
  const fail = (reason) => ({ ok: false, reason, source });
  if (value === "") return fail("empty");

  if (ABSOLUTE.test(value)) {
    // Only ground `i` (outside #Module maps) and the tiled D background load an absolute URL as written.
    const clientSupports = (source === "ground-i" && !options.moduleMode) || source === "D-tiled";
    if (!clientSupports) return fail("absolute-url-unsupported-by-client");
    if (!options.unofficialDomains) return fail("absolute-url-blocked-by-policy");
    let parsed;
    try { parsed = new URL(value); } catch { return fail("invalid-url"); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail("unsupported-scheme");
    return {
      ok: true, url: parsed.href, cacheKey: parsed.href, clientUrl: parsed.href, host: parsed.host,
      rule: source === "D-tiled" ? "tiled-absolute" : "ground-image-absolute", provenance: "game", source,
    };
  }

  const bad = unsafePath(value);
  if (bad) return fail(bad);

  let base;
  let rule;
  let provenance = "game";
  let query = "";
  switch (source) {
    case "D":
    case "d":
    case "IP":
      base = OFFICIAL_BASES.transformice;
      rule = "default-base";
      if (options.cacheId !== undefined) query = `?c=${options.cacheId}`;
      break;
    case "APS":
    case "ARPS":
    case "ground-i":
      if (BARE_FILENAME.test(value)) { base = OFFICIAL_BASES.atelier801; rule = "bare-name"; }
      else { base = OFFICIAL_BASES.transformice; rule = source === "ground-i" ? "ground-image-default-base" : "default-base"; }
      break;
    case "particle":
      base = OFFICIAL_BASES.transformice;
      rule = "particle-default-base";
      break;
    case "D-tiled":
      base = OFFICIAL_BASES.transformice;
      rule = "tiled-default-base";
      break;
    default:
      return fail("unknown-source");
  }
  // The game appends the value to the base as text; the request then resolves `.` and `..` segments, which can move up
  // from /images/ but never off the base host (`../wp-content/x.gif` is www.transformice.com/wp-content/x.gif).
  const prefix = withScheme(base, scheme);
  let full;
  try { full = new URL(prefix + value).href; } catch { return fail("invalid-url"); }
  if (new URL(full).host !== new URL(prefix).host) return fail("invalid-url");
  return {
    ok: true, url: full, cacheKey: full, clientUrl: full + query,
    host: new URL(full).host, rule, provenance, source,
  };
}

/**
 * Whether `host` is in `OFFICIAL_HOSTS`.
 */
export function isOfficialHost(host) {
  return OFFICIAL_HOSTS.includes(String(host).toLowerCase());
}
