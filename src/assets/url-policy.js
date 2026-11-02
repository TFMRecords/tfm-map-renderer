// How the game builds the URL of a map image: docs/xml/images.md#image-urls.
const TRANSFORMICE_IMAGE_BASE = "http://www.transformice.com/images/";
const ATELIER801_IMAGE_BASE = "http://images.atelier801.com/";

// A bare `name.ext` (letters and digits, one dot), which selects the Atelier801 base for ground `i`, APS and ARPS.
export const ATELIER801_BARE_IMAGE_RE = /^[a-z0-9]+\.[a-z]+$/i;

/**
 * The two official image bases the game uses: `transformice` (`http://www.transformice.com/images/`, the default) and `atelier801` (`http://images.atelier801.com/`, for a bare file name in ground `i`, `APS` and `ARPS`).
 */
export const IMAGE_BASES = Object.freeze({
  transformice: TRANSFORMICE_IMAGE_BASE,
  atelier801: ATELIER801_IMAGE_BASE,
});

/**
 * Whether `value` is a bare file name (`^[a-z0-9]+\.[a-z]+$`, case-insensitive), which selects the Atelier801 base.
 */
export function isAtelier801BareImageName(value) {
  return ATELIER801_BARE_IMAGE_RE.test(String(value ?? ""));
}

/**
 * The URL the game builds for an image reference of `kind`:
 *
 * - `"standard"` (`D`, `d`, `IP`, particle `img`, tiled `D`): always the transformice.com base.
 * - `"bare-name"` (ground `i`, `APS`, `ARPS`): the Atelier801 base for a bare file name, the transformice.com base otherwise.
 *
 * This function only constructs an official URL. It never performs I/O.
 */
export function resolveTfmImageUrl(source, kind = "standard") {
  const value = String(source ?? "");
  if (kind === "bare-name" && isAtelier801BareImageName(value)) {
    return ATELIER801_IMAGE_BASE + value;
  }
  return TRANSFORMICE_IMAGE_BASE + value;
}

/**
 * Describe how the game would build the URL for `source`: `{ kind, source, host, base, rule, ... }`. `kind` as in `resolveTfmImageUrl`. Performs no I/O.
 */
export function classifyImageReference(source, kind = "standard") {
  const value = String(source ?? "");
  if (kind === "bare-name" && isAtelier801BareImageName(value)) {
    return {
      kind,
      source: value,
      host: "images.atelier801.com",
      base: ATELIER801_IMAGE_BASE,
      rule: "bare-name",
      official: true,
      external: true,
    };
  }
  return {
    kind,
    source: value,
    host: "www.transformice.com",
    base: TRANSFORMICE_IMAGE_BASE,
    rule: "default-base",
    official: true,
    external: true,
  };
}
