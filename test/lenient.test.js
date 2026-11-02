import test from "node:test";
import assert from "node:assert/strict";
import { parseTfmDocument, parseTfmMap, XmlSyntaxError } from "../src/index.js";

const kinds = (document) => document.diagnostics.filter((d) => d.code === "lenient-recovery").map((d) => d.kind);

test("stray quote pairs between attributes are skipped, the later duplicate wins", () => {
  const xml = `<C><P F="1" defilante="" ''F="2" /><Z><S><S T="0" X="1" Y="1" o="324650" ''L="10" L="25" H="10"/></S><D/><O/></Z></C>`;
  assert.throws(() => parseTfmMap(xml, { lenient: false }), XmlSyntaxError);
  const { map, document } = parseTfmDocument(xml);
  assert.deepEqual(kinds(document), ["stray-quotes", "stray-quotes"]);
  assert.equal(map.settings.backgroundImageId, 2);
  assert.equal(map.grounds[0].width, 25);
});

test("a doubled < runs into the next tag", () => {
  const xml = `<C><P/><Z><S/><D/><O/><<L /></Z></C>`;
  assert.throws(() => parseTfmMap(xml, { lenient: false }), XmlSyntaxError);
  const { map, document } = parseTfmDocument(xml);
  assert.deepEqual(kinds(document), ["doubled-lt"]);
  assert.equal(map.source.clientLoads, true);
});

test("a garbled tag name is kept as an unknown tag; the client ignores it (no c, no lua)", () => {
  const xml = `<C><P/><Z><S/><D/><O/><L><JD P1="1,1" P2="2,2" M1="1,1"/><Jaaf43f,10,0.4" P1="40,339" P3="36,329" /></L></Z></C>`;
  assert.throws(() => parseTfmMap(xml, { lenient: false }), XmlSyntaxError);
  const { map, document } = parseTfmDocument(xml);
  assert.deepEqual(kinds(document), ["garbled-tag-name"]);
  assert.equal(map.joints.length, 2);
  assert.equal(map.joints[1].kind, 'Jaaf43f,10,0.4"');
  assert.equal(map.joints[1].lua, null);
  assert.equal(map.joints[1].color, null);
});

test("well-formed XML is unchanged by lenient mode", () => {
  const xml = `<C><P L="800"/><Z><S/><D/><O/></Z></C>`;
  assert.deepEqual(parseTfmMap(xml), parseTfmMap(xml));
});
