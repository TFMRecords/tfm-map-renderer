// The SWFs a map renderer needs, and where the game serves them. Everything the Dressroom (mice outfits, fur,
// costumes, flags, badges) uses is deliberately absent. Ground textures and most D/d images are not in a SWF at all.

export const SWF_BASE_URL = "https://www.transformice.com";

/**
 * @type {ReadonlyArray<{name:string, path:string, loader?:boolean, purpose:string}>}
 */
export const MAP_SWFS = Object.freeze([
  { name: "Transformice.swf", path: "/Transformice.swf", loader: true, purpose: "the game client: embedded ground, hole, cheese and joint graphics (needs unwrapping)" },
  { name: "x_pictos_editeur.swf", path: "/images/x_bibliotheques/x_pictos_editeur.swf", purpose: "the editor's decoration pictures (sprites named $P_n)" },
  { name: "x_items_chaman.swf", path: "/images/x_bibliotheques/x_items_chaman.swf", purpose: "shaman objects (sprites named $Objet_n)" },
]);

/** Fetch one SWF; `fetchImpl` is injectable for tests. */
export async function fetchSwf(entry, { baseUrl = SWF_BASE_URL, fetchImpl = fetch } = {}) {
  const url = `${baseUrl}${entry.path}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Per-item shaman-object skin SWFs, `x_bibliotheques/chamanes/o<type>,<id>.swf` (format and start ids from
 * fewfre/TransformiceShamanItems `resources/update/update.php`). Ids count up from `start`; the update script stops
 * after five 404s in a row. Never scan more than a handful of ids (project rule).
 */
export const CHAMANES_TYPES = Object.freeze([
  { type: 1, start: 43, name: "box (small)" }, { type: 2, start: 47, name: "box (large)" },
  { type: 3, start: 41, name: "plank (small)" }, { type: 4, start: 44, name: "plank (large)" },
  { type: 6, start: 37, name: "ball" }, { type: 7, start: 10, name: "trampoline" },
  { type: 10, start: 22, name: "anvil" }, { type: 17, start: 36, name: "cannonball" },
  { type: 28, start: 45, name: "balloon" },
]);

export function chamanesPath(type, id) {
  return `/images/x_bibliotheques/chamanes/o${type},${id}.swf`;
}
