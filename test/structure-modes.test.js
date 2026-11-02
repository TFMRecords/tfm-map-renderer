import test from "node:test";
import assert from "node:assert/strict";
import { parseTfmMap, legacyChildNodes, parseXml } from "../src/index.js";

const compact = `<C><P L="900"/><Z><S><S T="6" X="5" Y="6" L="7" H="8"/></S><D><P X="1" Y="2" T="3" P="0,0"/></D><O><O C="1" X="4" Y="5"/></O></Z></C>`;
const pretty = `<C>\n  <P L="900"/>\n  <Z>\n    <S>\n      <S T="6" X="5" Y="6" L="7" H="8"/>\n    </S>\n    <D/>\n    <O/>\n  </Z>\n</C>`;

test("compact input is identical in client and client-raw structure modes with no slot diagnostics", () => {
  const a = parseTfmMap(compact);
  const b = parseTfmMap(compact, { structureMode: "client-raw" });
  assert.equal(b.grounds.length, 1);
  assert.equal(b.decorations.length, 1);
  assert.equal(b.objects.length, 1);
  assert.deepEqual(b.grounds, a.grounds);
  assert.deepEqual(a.source.diagnostics, []);
  assert.deepEqual(b.source.diagnostics, []);
});

test("client-raw: whitespace text nodes occupy positional slots like legacy XMLDocument(ignoreWhite=false)", () => {
  // childNodes[0] is the whitespace text node, so settings/zone slots are not the elements.
  const raw = parseTfmMap(pretty, { structureMode: "client-raw" });
  assert.equal(raw.settings.width, null);
  assert.equal(raw.grounds.length, 0);
  // The portable default still reads the same document as the server-normalized form.
  const portable = parseTfmMap(pretty);
  assert.equal(portable.settings.width, 900);
  assert.equal(portable.grounds.length, 1);
});

test("pretty-printed input reports which positional slots legacy text nodes would shift", () => {
  const map = parseTfmMap(pretty);
  const codes = map.source.diagnostics.map((d) => d.code);
  assert.ok(codes.includes("legacy-text-node-shifts-root-slot"));
  assert.ok(codes.includes("legacy-text-node-shifts-zone-slot"));
  assert.ok(codes.includes("legacy-text-node-phantom-entries"));
  const phantom = map.source.diagnostics.find((d) => d.code === "legacy-text-node-phantom-entries" && d.container === "grounds");
  assert.equal(phantom.count, 2);
});

test("comments and PIs are not legacy childNodes but CDATA and text are", () => {
  const doc = parseXml("<C><!--c--><?pi x?>text<![CDATA[y]]><P/></C>");
  assert.deepEqual(legacyChildNodes(doc.root).map((n) => n.kind), ["text", "cdata", "element"]);
});

test("comments between slots do not shift client-raw slots", () => {
  const map = parseTfmMap(`<C><!--a--><P L="700"/><!--b--><Z><S/><D/><O/></Z></C>`, { structureMode: "client-raw" });
  assert.equal(map.settings.width, 700);
});

test("object stop/size are Lua-module (Parkour) attributes decoded as core optional fields, never client semantics", () => {
  const map = parseTfmMap(`<C><P/><Z><S/><D/><O><O C="1" X="1" Y="2" stop="1" size="2.5"/><O C="2" X="3" Y="4"/></O></Z></C>`);
  assert.equal(map.objects[0].stop, true);
  assert.equal(map.objects[0].size, 2.5);
  assert.equal(map.objects[1].stop, false);
  assert.equal(map.objects[1].size, null);
  assert.equal(map.objects[0].unknownAttributes, undefined, "known to the project, so not reported as unknown");
});
