// A "release" is what the asset workflow publishes and what a renderer loads: one bundle (tar.gz) per source SWF,
// because character ids repeat across SWFs, plus `release.json` indexing them. Building one needs network access to
// the game server and Java (FFDec); loading one needs neither.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { extractAssets } from "./extract.js";
import { packBundle } from "./bundle.js";
import { AssetBundle } from "./bundle.js";
import { MAP_SWFS, fetchSwf } from "./swf-sources.js";
import { embeddedSwfs, isLoaderSwf, unwrapLoaderSwf } from "../swf/unwrap.js";
import { createBundleResolver } from "./bundle-resolver.js";
import { compactPlacements } from "./clip-effects.js";
import { readSpriteTrees } from "../swf/display-list.js";
import { readSwf } from "../swf/reader.js";

export const RELEASE_FORMAT = "tfm-assets-release";
export const RELEASE_VERSION = 1;

/**
 * Bundles a release is made of. `embedded` selects a SWF stored inside the unwrapped client by (printable part of) its
 * symbol name. The client's other embedded SWFs (mouse, cat skeleton, ...) are not map assets.
 */
export const RELEASE_SOURCES = Object.freeze([
  { name: "game-resources", swf: "Transformice.swf", embedded: /Ressources_Class$/, purpose: "grounds ($T_n tiles, $Sol_*), backgrounds ($F_n), cheese, holes, joints" },
  { name: "game-fla", swf: "Transformice.swf", embedded: /TransformiceFLA$/, purpose: "ground variants (RessourcesTransformice_fla.Sol_*), $Trou, $Sol, level clips" },
  { name: "pictos", swf: "x_pictos_editeur.swf", reapplyGradients: false, purpose: "decorations ($P_n)" },
  { name: "shaman-items", swf: "x_items_chaman.swf", nameColours: true, purpose: "shaman objects ($Objet_n)" },
]);

/**
 * Which bundle answers first when two define the same symbol.
 *
 * What the game does (docs/rendering.md#pictures-from-the-game): it loads the embedded game-fla into a CHILD `ApplicationDomain`, the embedded game-resources
 * and then the libraries (`x_items_chaman`, `x_macarons`, `x_pictos_editeur`, in that order) into the parent domain. A child domain looks a name up through its
 * PARENT first, so a name that the parent has wins: the order is game-resources, the libraries in load order (shaman-items, pictos), and only then game-fla
 * (`CLIENT_BUNDLE_PRECEDENCE`).
 *
 * The default (`BUNDLE_PRECEDENCE`) is the other way round for the one pair that matters, game-fla before game-resources, because it gives the everyday look: the green,
 * steaming `$Fromage` of game-resources is an EVENT clip (seen only during the Halloween event, and the SWFs were fetched during it), the yellow one of game-fla is what a normal
 * day shows. Pass `precedence: "client"` to `loadRelease` for the game's order (the live event build).
 */
export const BUNDLE_PRECEDENCE = Object.freeze(["game-fla", "game-resources", "pictos", "shaman-items"]);
export const CLIENT_BUNDLE_PRECEDENCE = Object.freeze(["game-resources", "shaman-items", "pictos", "game-fla"]);

/** Bundle names sorted by a precedence list (unlisted names last, in their given order). */
export function orderBundles(names, precedence = BUNDLE_PRECEDENCE) {
  const rank = (name) => { const i = precedence.indexOf(name); return i < 0 ? precedence.length : i; };
  return [...names].sort((a, b) => rank(a) - rank(b));
}

const printable = (s) => String(s ?? "").replace(/[^\x20-\x7e]/g, "");

/** Pick the SWF bytes of one release source out of the fetched/unwrapped files. */
export function sourceSwf(source, files) {
  const swf = files.get(source.swf);
  if (!swf) throw new Error(`release source ${source.name}: ${source.swf} was not fetched`);
  if (!source.embedded) return swf;
  const found = embeddedSwfs(swf).find((e) => source.embedded.test(printable(e.name)));
  if (!found) throw new Error(`release source ${source.name}: no embedded SWF matching ${source.embedded} in ${source.swf}`);
  return found.data;
}

/**
 * Colour transforms and blend modes of the sprites a source SWF exports (`effects.json`, keyed by bundle name): FFDec's
 * SVG drops them, `applyClipEffects` puts them back at load time. Needs no Java.
 */
export function buildEffects(sources, files) {
  const out = {};
  for (const source of sources) {
    const swf = sourceSwf(source, files);
    const names = readSwf(swf).symbols.map((s) => s.name);
    out[source.name] = compactPlacements(readSpriteTrees(swf, names), { nameColours: source.nameColours === true });
  }
  return out;
}

/**
 * Build a release directory. `fetchImpl`/`extract` are injectable for tests.
 * @returns {Promise<object>} the release index that was written to `release.json`
 */
export async function buildRelease({
  outDir, workDir, jar, java = "java", ffdecVersion = "custom", only = null, log = () => {},
  fetchImpl = fetch, extract = extractAssets,
}) {
  const sources = RELEASE_SOURCES.filter((s) => !only || only.includes(s.name));
  const needed = new Set(sources.map((s) => s.swf));
  const files = new Map();
  for (const entry of MAP_SWFS.filter((e) => needed.has(e.name))) {
    let data = await fetchSwf(entry, { fetchImpl });
    if (entry.loader && isLoaderSwf(data)) data = unwrapLoaderSwf(data).swf;
    files.set(entry.name, data);
    log(`fetched ${entry.name} (${data.length} bytes)`);
  }
  await mkdir(outDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  const bundles = [];
  for (const source of sources) {
    const swfPath = path.join(workDir, `${source.name}.swf`);
    await writeFile(swfPath, sourceSwf(source, files));
    log(`extracting ${source.name}`);
    const { manifest, files: bundleFiles } = await extract({ swfPath, jar, java, ffdecVersion, log });
    const packed = packBundle(bundleFiles);
    const file = `${source.name}.tar.gz`;
    await writeFile(path.join(outDir, file), packed.data);
    bundles.push({
      name: source.name, file, sha256: packed.sha256, bytes: packed.data.length, purpose: source.purpose,
      assets: Object.keys(manifest.assets).length, symbols: Object.keys(manifest.symbols).length, warnings: manifest.warnings.length,
    });
  }
  await writeFile(path.join(outDir, "effects.json"), `${JSON.stringify(buildEffects(sources, files))}\n`);
  const index = { format: RELEASE_FORMAT, version: RELEASE_VERSION, ffdec: ffdecVersion, bundles };
  await writeFile(path.join(outDir, "release.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

/**
 * Load a release directory written by `buildRelease` (or downloaded from a GitHub release into a folder). `flashBlur: false` keeps FFDec's Gaussian
 * blur chains instead of Flash's exact box blurs (`src/util/flash-blur.js`). `precedence`: `"normal"` (default, the everyday look), `"client"` (the game's
 * order: game-resources before game-fla) or an explicit list of bundle names, for symbols that two bundles define.
 * @returns {Promise<{index:object, bundles:Map<string,AssetBundle>, resolver:{resolve:Function}}>}
 */
export async function loadRelease(dir, { flashBlur = true, precedence = "normal" } = {}) {
  const index = JSON.parse(await readFile(path.join(dir, "release.json"), "utf8"));
  if (index.format !== RELEASE_FORMAT) throw new Error(`${dir}/release.json is not a ${RELEASE_FORMAT} index`);
  // docs/asset-bundle-format.md#versions
  if (index.version !== RELEASE_VERSION) throw new Error(`${dir}/release.json has format version ${index.version}; this version of tfm-map-renderer reads version ${RELEASE_VERSION} (update the package or use a matching release)`);
  const effects = await readFile(path.join(dir, "effects.json"), "utf8").then(JSON.parse, () => ({}));
  const bundles = new Map();
  for (const b of index.bundles) {
    const bytes = await readFile(path.join(dir, b.file));
    if (createHash("sha256").update(bytes).digest("hex") !== b.sha256) throw new Error(`sha256 mismatch for ${b.file}`);
    bundles.set(b.name, AssetBundle.fromTarGz(bytes));
  }
  const list = precedence === "client" ? CLIENT_BUNDLE_PRECEDENCE : Array.isArray(precedence) ? precedence : BUNDLE_PRECEDENCE;
  const byName = new Map(index.bundles.map((b) => [b.name, b]));
  const order = orderBundles(index.bundles.map((b) => b.name), list).map((n) => byName.get(n));
  return { index, bundles, effects, resolver: createLayeredResolver(order.map((b) => bundles.get(b.name)), order.map((b) => effects[b.name]), order.map((b) => ({ gradients: RELEASE_SOURCES.find((x) => x.name === b.name)?.reapplyGradients !== false, flashBlur }))) };
}

/** Resolver that asks each bundle in turn (symbol names are unique across a release; numeric ids are not, so use names). */
export function createLayeredResolver(bundles, effects = [], options = []) {
  const resolvers = bundles.map((b, i) => createBundleResolver(b, effects[i], options[i]));
  return {
    resolve(reference) {
      for (const r of resolvers) {
        const hit = r.resolve(reference);
        if (hit) return hit;
      }
      return null;
    },
  };
}
