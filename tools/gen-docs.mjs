#!/usr/bin/env node
// Writes the generated regions of docs/xml/*.md and docs/rendering.md (between `<!-- BEGIN:name -->` and
// `<!-- END:name -->`) from src/tfm/spec/, and docs/xml/spec.json with the same data for other tools.
//   node tools/gen-docs.mjs          rewrite the files
//   node tools/gen-docs.mjs --check  exit 1 when a file is stale
// Prose outside the markers is hand-written and never touched. Every region must appear in exactly one file.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as spec from "../src/tfm/spec/index.js";
import { GROUND_TEXTURE_RECIPES } from "../src/render/ground-textures.js";

const root = new URL("../", import.meta.url);
const XML_DIR = new URL("docs/xml/", root);
const SPEC_JSON = new URL("docs/xml/spec.json", root);
const EXTRA_FILES = [new URL("docs/rendering.md", root)];

const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const code = (s) => `\`${s}\``;
const list = (values) => values.map((v) => code(v)).join(", ");
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
const hex = (n) => n.toString(16).toUpperCase().padStart(6, "0");

const STATUS = { verified: "verified", unverified: "**unverified**", extension: "extension" };

function attributeTable(scope) {
  const rows = spec.ATTRIBUTES.filter((a) => spec.scopeOf(a) === scope);
  const tagged = rows.some((a) => a.tags);
  const head = ["Attribute", ...(tagged ? ["Tags"] : []), "Read as", "Meaning", "Status"];
  return table(head, rows.map((a) => [
    `<a id="${spec.anchorOf(a)}"></a>${code(a.name)}`,
    ...(tagged ? [a.tags.map((t) => (t === "any" ? "any" : code(t))).join(", ")] : []),
    `${a.rule} Absent: ${a.default}.`,
    a.meaning,
    a.note ? `${STATUS[a.status]}: ${a.note}` : STATUS[a.status],
  ]));
}

function fieldsTable(scope) {
  const rows = spec.ATTRIBUTES.filter((a) => spec.scopeOf(a) === scope);
  return table(["Spec id", "Type", "Parser field", "Examples (checked by the tests)"], rows.map((a) => [
    code(spec.idOf(a)),
    code(a.type),
    a.field.split(", ").map((f) => code(f.replace(/ \(.*\)$/, "")) + (f.match(/ \(.*\)$/)?.[0] ?? "")).join(", "),
    a.examples.map(([xml, path, value]) => `${code(xml)} -> ${code(`${path} = ${JSON.stringify(value)}`)}`).join("; "),
  ]));
}

function statusSummary() {
  const counts = { verified: 0, unverified: 0, extension: 0 };
  for (const a of spec.ATTRIBUTES) counts[a.status]++;
  return table(["Status", "Attributes"], [...Object.entries(counts).map(([k, n]) => [k, String(n)]), ["**total**", `**${spec.ATTRIBUTES.length}**`]]);
}

function unverifiedList() {
  return spec.ATTRIBUTES.filter((a) => a.status === "unverified")
    .map((a) => `- [${code(spec.idOf(a))}](${spec.docOf(a).replace(/^([^#]+)/, "$1.md")}): ${a.note}`).join("\n");
}

function coercionTable() {
  const show = (v) => (v === undefined ? "absent" : code(`"${v}"`));
  const out = (v) => (Number.isNaN(v) ? code("NaN") : code(JSON.stringify(v)));
  return table(["Name", "Effect", "Examples"], spec.COERCIONS.map((c) => [code(c.name), c.effect, c.examples.map(([i, o]) => `${show(i)} -> ${out(o)}`).join(", ")]));
}

function diagnosticsTable() {
  return table(["Code", "Severity", "Layer", "Meaning", "In the game"], spec.DIAGNOSTICS.map((d) => [code(d.code), d.severity, d.layer, d.meaning, d.game]));
}

function groundTypesTable() {
  return table(["`T`", "Name", "Friction", "Restitution", "Minimalist colour", "Notes"], spec.GROUND_TYPES.map((g) => {
    const flat = GROUND_TEXTURE_RECIPES[g.type]?.flat;
    const colour = flat?.color != null ? `${code(`#${hex(flat.color)}`)}${flat.alpha != null && flat.alpha !== 1 ? `, alpha ${flat.alpha}` : ""}` : "textured";
    const notes = [g.foreground ? "always in front" : "", g.bitmapCached ? "cached as a bitmap when static" : "", g.note].filter(Boolean).join("; ");
    return [String(g.type), g.name, String(g.friction), String(g.restitution), colour, notes];
  }));
}

function collisionTable() {
  const bits = (mask) => [1, 2, 4, 8, 16, 32].filter((b) => mask & b).join(", ") || "none";
  return table(["Preset", "Category bit", "Mask", "Collides with", "Used for"], spec.COLLISION_PRESETS.map((p) => [String(p.preset), String(p.category), String(p.mask), bits(p.mask), p.usedFor]));
}

function areaDefaultsTable() {
  const names = Object.keys(spec.AREA_DEFAULTS[9]);
  return table(["`T`", ...names.map(code)], Object.entries(spec.AREA_DEFAULTS).map(([t, v]) => [t, ...names.map((n) => String(v[n]))]));
}

function decorationTagsTable() {
  return table(["Tag", "Role (`role`)", "Attributes read", "Picture"], [
    ...spec.DECORATION_TAGS.map((d) => [code(d.tag), code(d.role), list(d.reads), d.picture]),
    ["any other", "none", list(["X", "Y"]), "none"],
  ]);
}

function objectLists() {
  return table(["List", "Types"], [
    ["Created by the game", list(spec.CREATED_TYPES)],
    ["Never created (filtered)", list(spec.FILTERED_TYPES)],
    ["Nails", list(spec.NAIL_TYPES)],
    ["Nails that attach to the world", list(spec.WORLD_NAIL_TYPES)],
    ["Nails with a motor", list(spec.ROTATING_NAIL_TYPES)],
    ["No picture in the game", list(spec.NO_PICTURE_TYPES)],
    ["Defilante markers (raw `C` -> marker kind)", Object.entries(spec.DEFILANTE_MARKERS).map(([c, k]) => `${code(c)} -> ${k}`).join(", ")],
    ...Object.entries(spec.SPECIAL_PICTURES).map(([c, p]) => [`Picture of ${code(c)}`, p]),
  ]);
}

function decorationLists() {
  return table(["List", "Decoration ids"], [
    ["Still drawn in minimalist mode", list(spec.MINIMALIST_DECORATIONS)],
    ["Interactive (live clips)", list(spec.INTERACTIVE_DECORATIONS)],
    ["Always behind everything in the editor (not in the game)", list(spec.EDITOR_BACKDROP_DECORATIONS)],
  ]);
}

const renderRegions = () => ({
  "status-summary": statusSummary(),
  unverified: unverifiedList(),
  coercions: coercionTable(),
  diagnostics: diagnosticsTable(),
  ...Object.fromEntries(Object.keys(spec.PAGE_OF_SCOPE).flatMap((s) => [[`attrs-${s}`, attributeTable(s)], [`fields-${s}`, fieldsTable(s)]])),
  "ground-types": groundTypesTable(),
  "collision-presets": collisionTable(),
  "area-defaults": areaDefaultsTable(),
  "decoration-tags": decorationTagsTable(),
  "decoration-lists": decorationLists(),
  "hole-glows": table(["`CT`", "Glow colour"], Object.entries(spec.HOLE_GLOWS).map(([ct, c]) => [ct, code(`#${hex(c)}`)])),
  "cheese-suffixes": list(spec.EVENT_CHEESE_SUFFIXES),
  "object-lists": objectLists(),
  "editor-characters": spec.EDITOR_CHARACTERS.description,
  "limits-restricted": table(["What", "Restricted map", "Official map", "`#Module` map"], spec.RESTRICTED_LIMITS.map((l) => [l.what, l.restricted, l.official, l.module])),
  "limits-always": table(["What", "Limit"], spec.ALWAYS_LIMITS.map((l) => [l.what, l.limit])),
  "draw-order": table(["Layer (bottom first)", "Contents", "Checked in the game"], spec.DRAW_ORDER.map((l, i) => [`${i + 1}. ${l.layer}`, l.contents, l.verified ? "yes" : "no"])),
});

/** spec.json: the data of src/tfm/spec/ as plain JSON (`NaN` written as the string "NaN", an absent value as null). */
export function specJson() {
  const data = {
    attributes: spec.ATTRIBUTES.map((a) => ({ id: spec.idOf(a), scope: spec.scopeOf(a), doc: spec.docOf(a), ...a })),
    coercions: spec.COERCIONS,
    groundTypes: spec.GROUND_TYPES, groundSize: spec.GROUND_SIZE, areaDefaults: spec.AREA_DEFAULTS, collisionPresets: spec.COLLISION_PRESETS,
    objects: {
      created: spec.CREATED_TYPES, filtered: spec.FILTERED_TYPES, nails: spec.NAIL_TYPES, worldNails: spec.WORLD_NAIL_TYPES,
      rotatingNails: spec.ROTATING_NAIL_TYPES, rotatingNailLimit: spec.ROTATING_NAIL_LIMIT, noPicture: spec.NO_PICTURE_TYPES,
      defilanteMarkers: spec.DEFILANTE_MARKERS, ghostTransform: spec.GHOST_TRANSFORM,
    },
    decorations: {
      tags: spec.DECORATION_TAGS, holeGlows: spec.HOLE_GLOWS, minimalist: spec.MINIMALIST_DECORATIONS,
      interactive: spec.INTERACTIVE_DECORATIONS, editorBackdrops: spec.EDITOR_BACKDROP_DECORATIONS, eventCheeseSuffixes: spec.EVENT_CHEESE_SUFFIXES,
    },
    limits: {
      editorCharacters: spec.EDITOR_CHARACTERS.pattern.source, mapSize: spec.MAP_SIZE, restricted: spec.RESTRICTED_LIMITS,
      always: spec.ALWAYS_LIMITS, editorObjectDrawLimit: spec.EDITOR_OBJECT_DRAW_LIMIT,
    },
    diagnostics: spec.DIAGNOSTICS,
    drawOrder: spec.DRAW_ORDER,
  };
  const replacer = (_, v) => (typeof v === "number" && Number.isNaN(v) ? "NaN" : v === undefined ? null : v);
  return JSON.stringify(data, (k, v) => (Array.isArray(v) ? v.map((x) => (x === undefined ? null : x)) : replacer(k, v)), 2) + "\n";
}

function fill(text, regions, used, file) {
  return text.replace(/<!-- BEGIN:([a-z0-9-]+) -->[\s\S]*?<!-- END:\1 -->/g, (_, name) => {
    if (!(name in regions)) throw new Error(`unknown region ${name} in ${file}`);
    if (used.has(name)) throw new Error(`region ${name} appears twice (${used.get(name)}, ${file})`);
    used.set(name, file);
    return `<!-- BEGIN:${name} -->\n${regions[name]}\n<!-- END:${name} -->`;
  });
}

/** @returns {Promise<{stale: string[]}>} files whose content differs from the generated one (written unless `check`) */
export async function generateDocs({ check = false } = {}) {
  const regions = renderRegions();
  const files = [...(await readdir(XML_DIR)).filter((f) => f.endsWith(".md")).sort().map((f) => new URL(f, XML_DIR)), ...EXTRA_FILES];
  const used = new Map();
  const outputs = [];
  for (const url of files) {
    const current = await readFile(url, "utf8");
    outputs.push({ url, current, next: fill(current, regions, used, fileURLToPath(url)) });
  }
  const missing = Object.keys(regions).filter((n) => !used.has(n));
  if (missing.length) throw new Error(`regions not placed in any document: ${missing.join(", ")}`);
  const json = specJson();
  outputs.push({ url: SPEC_JSON, current: await readFile(SPEC_JSON, "utf8").catch(() => ""), next: json });
  const stale = outputs.filter((o) => o.current !== o.next);
  if (!check) for (const o of stale) await writeFile(o.url, o.next);
  return { stale: stale.map((o) => fileURLToPath(o.url)) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes("--check");
  const { stale } = await generateDocs({ check });
  if (check && stale.length) {
    console.error(`stale generated docs (run npm run docs:xml):\n${stale.join("\n")}`);
    process.exit(1);
  }
  console.log(check ? "generated docs are up to date" : `generated docs written (${stale.length} file(s) changed)`);
}
