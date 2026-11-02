// The specification (src/tfm/spec/) against the code: the parser knows exactly the catalogued attributes, every example
// parses to its value, and the data modules agree with the constants the parser and renderer use.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseTfmMap, KNOWN_ATTRIBUTES, as3Int, as3Number, as3NumberOrZero, as3ParseFloat, as3ParseInt } from "../src/index.js";
import * as spec from "../src/tfm/spec/index.js";
import { groundConstructorPhysics, AREA_DEFAULTS, OBJECT_FILTER, decodeObjectType, GROUND_SIZE_LIMITS, COLLISION_PRESETS } from "../src/tfm/client-constants.js";
import { GAME_OBJECT_TYPES, NAIL_TYPES, WORLD_NAIL_TYPES, GHOST_COLOR_TRANSFORM } from "../src/render/client-objects.js";
import { CLIENT_LIMIT_PRESETS } from "../src/render/client-limits.js";
import { EDITOR_ALLOWED } from "../src/tfm/editor-limits.js";

const { ATTRIBUTES, scopeOf, idOf } = spec;

test("the parser knows exactly the catalogued attributes, per scope", () => {
  for (const [scope, known] of Object.entries(KNOWN_ATTRIBUTES)) {
    const catalogued = new Set(ATTRIBUTES.filter((a) => scopeOf(a) === scope).map((a) => a.name));
    assert.deepEqual([...known].filter((n) => !catalogued.has(n)).sort(), [], `${scope}: the parser knows attributes the spec lacks`);
    assert.deepEqual([...catalogued].filter((n) => !known.has(n)).sort(), [], `${scope}: the spec lists attributes the parser does not know`);
  }
});

test("entries are unique and complete", () => {
  const seen = new Set();
  for (const a of ATTRIBUTES) {
    const id = idOf(a);
    assert.ok(!seen.has(id), `duplicate ${id}`);
    seen.add(id);
    assert.ok(scopeOf(a), `${id}: unknown node`);
    for (const f of ["field", "type", "default", "rule", "meaning", "status"]) assert.ok(a[f], `${id} lacks ${f}`);
    assert.ok(["verified", "unverified", "extension"].includes(a.status), `${id}: status ${a.status}`);
    assert.equal(Boolean(a.note), a.status === "unverified", `${id}: a note is required exactly when the status is unverified`);
    assert.ok(a.examples.length > 0, `${id} has no example`);
  }
});

test("rules only name coercions that exist, and every coercion is used", () => {
  const names = new Set(spec.COERCION_NAMES);
  const used = new Set();
  for (const a of ATTRIBUTES) for (const m of a.rule.matchAll(/`([a-z0-9]+)`/g)) if (names.has(m[1])) used.add(m[1]);
  assert.deepEqual(spec.COERCION_NAMES.filter((n) => !used.has(n)), []);
});

for (const a of ATTRIBUTES) {
  for (const ex of a.examples) {
    test(`example ${idOf(a)}: ${ex[0]} -> ${ex[1]}`, () => {
      assert.deepEqual(spec.getPath(parseTfmMap(spec.exampleXml(a, ex)), ex[1]), ex[2]);
    });
  }
}

test("coercion examples match the parser's conversions", () => {
  const fns = {
    int: as3Int, number: as3Number, number0: as3NumberOrZero, float: as3ParseFloat, hex: (v) => as3ParseInt(v, 16),
    hexcolor: (v) => as3Int(`0x${v}`), presence: (v) => v !== undefined, truthy: (v) => Boolean(v), one: (v) => v === "1",
  };
  for (const c of spec.COERCIONS) {
    assert.ok(fns[c.name], `no conversion for ${c.name}`);
    for (const [input, output] of c.examples) assert.deepEqual(fns[c.name](input), output, `${c.name}(${JSON.stringify(input)})`);
  }
});

test("every diagnostic the parsers emit is catalogued, and only those", async () => {
  const emitted = new Set();
  for (const file of ["src/xml/parse.js", "src/tfm/parse-map.js"]) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    for (const m of text.matchAll(/code: "([a-z-]+)"/g)) emitted.add(m[1]);
    for (const m of text.matchAll(/\berr\("([a-z-]+)"/g)) emitted.add(m[1]);
  }
  const catalogued = new Set(spec.DIAGNOSTICS.map((d) => d.code));
  assert.deepEqual([...emitted].filter((c) => !catalogued.has(c)).sort(), [], "emitted but not catalogued");
  assert.deepEqual([...catalogued].filter((c) => !emitted.has(c)).sort(), [], "catalogued but never emitted");
});

test("ground types agree with the parser's constants", () => {
  assert.equal(spec.GROUND_TYPES.length, 22);
  for (const g of spec.GROUND_TYPES) {
    const p = groundConstructorPhysics(g.type);
    assert.equal(g.friction, p.friction, `type ${g.type} friction`);
    assert.equal(g.restitution, p.restitution, `type ${g.type} restitution`);
  }
  assert.deepEqual(spec.AREA_DEFAULTS, AREA_DEFAULTS);
  assert.deepEqual(spec.GROUND_SIZE, GROUND_SIZE_LIMITS);
  for (const p of spec.COLLISION_PRESETS) {
    const own = COLLISION_PRESETS[p.preset];
    assert.equal(p.category, own.categoryBits, `preset ${p.preset} category`);
    assert.equal(p.mask, own.maskBits, `preset ${p.preset} mask`);
  }
});

test("object lists agree with the parser and the renderer", () => {
  assert.deepEqual(spec.FILTERED_TYPES, [...OBJECT_FILTER].sort((a, b) => a - b));
  assert.deepEqual(spec.CREATED_TYPES, [...GAME_OBJECT_TYPES]);
  assert.deepEqual(spec.NAIL_TYPES, [...NAIL_TYPES]);
  assert.deepEqual(spec.WORLD_NAIL_TYPES, [...WORLD_NAIL_TYPES]);
  assert.deepEqual([...spec.GHOST_TRANSFORM.multiply], GHOST_COLOR_TRANSFORM.mul);
  assert.deepEqual([...spec.GHOST_TRANSFORM.add], GHOST_COLOR_TRANSFORM.add);
  for (const c of [0, 28, 99, 100, 1002, 2803, 10305, 99999]) assert.deepEqual(spec.splitObjectType(c), decodeObjectType(c), `C=${c}`);
});

test("limits agree with the renderer's restricted preset and the editor check", () => {
  const r = CLIENT_LIMIT_PRESETS.restricted;
  const m = spec.MAP_SIZE;
  assert.deepEqual([m.maxWidth, m.maxWidthDefilante, m.maxHeight], [r.maxWidth, r.maxWidthDefilante, r.maxHeight]);
  const text = JSON.stringify(spec.RESTRICTED_LIMITS);
  for (const n of [r.maxGrounds, r.maxDecorations, r.maxObjects, r.maxObjectIndex]) assert.ok(text.includes(`${n}`), `restricted limit ${n} missing`);
  assert.equal(spec.EDITOR_CHARACTERS.pattern.source, EDITOR_ALLOWED.source);
});
