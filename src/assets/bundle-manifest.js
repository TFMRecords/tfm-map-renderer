// Asset bundle manifest, schema v1. Deterministic by design: no timestamps, no absolute paths,
// sorted keys, so the same SWF + FFDec + extractor version always yields the same bytes.

export const MANIFEST_FORMAT = "tfm-assets";
export const MANIFEST_VERSION = 1;

/**
 * @typedef {{file:string,width:number,height:number,origin:{x:number,y:number},hasImages?:boolean}} Frame
 * @typedef {{id:number,kind:"shape"|"sprite",names:string[],frames:Frame[]}} VectorAsset
 * @typedef {{id:number,kind:"image",names:string[],file:string,width:number|null,height:number|null}} ImageAsset
 */

export function sortedObject(entries) {
  return Object.fromEntries([...entries].sort(([a], [b]) => (Number(a) - Number(b)) || (a < b ? -1 : a > b ? 1 : 0)));
}

export function buildManifest({ swf, ffdecVersion, extractorVersion, assets, warnings = [] }) {
  const symbols = new Map();
  const dupes = [];
  for (const a of assets) {
    for (const name of a.names) {
      if (symbols.has(name) && symbols.get(name) !== a.id) dupes.push(name);
      symbols.set(name, a.id);
    }
  }
  return {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    source: {
      swf: {
        name: swf.name, sha256: swf.sha256, size: swf.size, swfVersion: swf.swfVersion,
        stage: swf.stage, compression: swf.compression,
      },
      ffdec: { version: ffdecVersion },
      extractor: { version: extractorVersion },
    },
    assets: sortedObject(assets.map((a) => [String(a.id), a])),
    symbols: sortedObject([...symbols].sort(([a], [b]) => (a < b ? -1 : 1))),
    // Feature -> symbol bindings (ground type, decoration id, object type, ...). Filled by a
    // hand-reviewed bindings file, never guessed by the extractor.
    bindings: {},
    warnings: [...warnings, ...[...new Set(dupes)].map((n) => `duplicate-symbol-name:${n}`)].sort(),
  };
}

export function validateManifest(m) {
  const fail = (msg) => { throw new Error(`invalid asset manifest: ${msg}`); };
  if (!m || typeof m !== "object") fail("not an object");
  if (m.format !== MANIFEST_FORMAT) fail(`format must be "${MANIFEST_FORMAT}"`);
  if (m.version !== MANIFEST_VERSION) fail(`unsupported version ${m.version}`);
  if (!m.assets || typeof m.assets !== "object") fail("missing assets");
  for (const [key, a] of Object.entries(m.assets)) {
    if (String(a.id) !== key) fail(`asset key ${key} does not match id ${a.id}`);
    if (a.kind === "image") {
      if (typeof a.file !== "string") fail(`image ${key} lacks file`);
    } else if (a.kind === "shape" || a.kind === "sprite") {
      if (!Array.isArray(a.frames) || a.frames.length === 0) fail(`${a.kind} ${key} has no frames`);
      for (const f of a.frames) if (typeof f.file !== "string" || !f.origin) fail(`${a.kind} ${key} has an invalid frame`);
    } else fail(`asset ${key} has unknown kind ${a.kind}`);
  }
  for (const [name, id] of Object.entries(m.symbols ?? {})) if (!m.assets[String(id)]) fail(`symbol ${name} points at missing asset ${id}`);
  return m;
}
