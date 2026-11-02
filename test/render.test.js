// Every map in test/maps renders without errors, and its SVG (placeholder assets, no release needed) matches a stored
// hash, so any change to the picture is noticed. After an intended change: UPDATE_RENDER_HASHES=1 npm test, then review
// the diff of test/maps/render-hashes.json.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseTfmMap, renderTfmSvg } from "../src/index.js";

const DIR = new URL("./maps/", import.meta.url);
const HASHES = new URL("./maps/render-hashes.json", import.meta.url);
const OPTION_SETS = {
  default: {},
  game: { objectMode: "game", spawnMarkers: "none" },
  mirrored: { mirrorX: true },
  minimalist: { minimalist: true },
  restricted: { clientLimits: "restricted" },
};
const update = process.env.UPDATE_RENDER_HASHES === "1";
const stored = update ? {} : JSON.parse(readFileSync(HASHES, "utf8"));
const maps = readdirSync(DIR).filter((f) => f.endsWith(".xml")).sort();

test("test/maps is not empty", () => assert.ok(maps.length > 0));

for (const file of maps) {
  test(`renders ${file}`, () => {
    const map = parseTfmMap(readFileSync(new URL(file, DIR), "utf8"));
    assert.equal(map.source.clientLoads, true, "the map loads in the game");
    const hashes = {};
    for (const [name, options] of Object.entries(OPTION_SETS)) {
      const svg = renderTfmSvg(map, options);
      assert.match(svg, /^<svg [^>]*>[\s\S]*<\/svg>$/, name);
      hashes[name] = createHash("sha256").update(svg).digest("hex").slice(0, 16);
    }
    if (update) stored[file] = hashes;
    else assert.deepEqual(hashes, stored[file], `SVG of ${file} changed (UPDATE_RENDER_HASHES=1 after an intended change)`);
  });
}

test("no stored hash without its map", { skip: update }, () => {
  assert.deepEqual(Object.keys(stored).filter((f) => !maps.includes(f)), []);
});

if (update) test.after(() => writeFileSync(HASHES, `${JSON.stringify(stored, null, 2)}\n`));
