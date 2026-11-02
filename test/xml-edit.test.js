import test from "node:test";
import assert from "node:assert/strict";
import {
  parseXml,
  serializeXml,
  attributeEntries,
  attributeMap,
  getAttribute,
  getXmlNodeById,
  setXmlAttributeValue,
  appendXmlAttribute,
  removeXmlAttribute,
} from "../src/index.js";

test("preserve serialization surgically changes only an existing attribute value", () => {
  const source = `<C>\n  <P  L='800' note="a&amp;b" />\n</C>`;
  const document = parseXml(source);
  const settings = document.root.children.find((node) => node.kind === "element");
  const width = attributeEntries(settings).find((attribute) => attribute.name === "L");

  setXmlAttributeValue(document, width, `900&'`);

  assert.equal(serializeXml(document, { mode: "preserve" }), `<C>\n  <P  L='900&amp;&apos;' note="a&amp;b" />\n</C>`);
  assert.equal(serializeXml(document, { mode: "canonical" }), `<C>\n  <P L='900&amp;&apos;' note="a&amp;b"/>\n</C>`);
});

test("exact-entry editing is unambiguous with duplicate attributes", () => {
  const document = parseXml(`<C><P x="first" x='last'/></C>`);
  const settings = document.root.children[0];
  const duplicates = attributeEntries(settings).filter((attribute) => attribute.name === "x");

  setXmlAttributeValue(document, duplicates[0], "changed");

  assert.equal(serializeXml(document, { mode: "preserve" }), `<C><P x="changed" x='last'/></C>`);
});

test("attributeEntries can select all duplicate occurrences by name in source order", () => {
  const document = parseXml(`<C><P lua="first" x="1" lua='middle' lua="last"/></C>`);
  const settings = document.root.children[0];
  const luaEntries = attributeEntries(settings, "lua");

  assert.deepEqual(luaEntries.map((attribute) => attribute.value), ["first", "middle", "last"]);
  setXmlAttributeValue(document, luaEntries[1], "changed");
  assert.equal(serializeXml(document, { mode: "preserve" }), `<C><P lua="first" x="1" lua='changed' lua="last"/></C>`);
});

test("client-style name lookup remains last-wins while duplicate entries stay individually accessible", () => {
  const document = parseXml(`<C><P lua="first" lua="middle" lua="last"/></C>`);
  const settings = document.root.children[0];

  assert.equal(getAttribute(settings, "lua"), "last");
  assert.equal(attributeMap(settings).lua, "last");
  assert.deepEqual(attributeEntries(settings, "lua").map((attribute) => attribute.value), ["first", "middle", "last"]);
});

test("appending an attribute preserves existing start-tag formatting", () => {
  const document = parseXml(`<C><P  L='800'   /></C>`);
  const settings = document.root.children[0];
  const inserted = appendXmlAttribute(document, settings, "H", `400&1`, { quote: '"' });

  assert.equal(serializeXml(document, { mode: "preserve" }), `<C><P  L='800' H="400&amp;1"   /></C>`);
  setXmlAttributeValue(document, inserted, "450");
  assert.equal(serializeXml(document, { mode: "preserve" }), `<C><P  L='800' H="450"   /></C>`);
});

test("removing one exact attribute leaves duplicate siblings and unrelated bytes untouched", () => {
  const document = parseXml(`<C><P a="1"  x="first" x='last'  b="2"/></C>`);
  const settings = document.root.children[0];
  const duplicates = attributeEntries(settings).filter((attribute) => attribute.name === "x");

  removeXmlAttribute(document, duplicates[1]);

  assert.equal(serializeXml(document, { mode: "preserve" }), `<C><P a="1"  x="first"   b="2"/></C>`);
  assert.equal(serializeXml(document, { mode: "canonical" }), `<C><P a="1" x="first" b="2"/></C>`);
});

test("an inserted attribute can be removed without changing original source", () => {
  const source = `<C><P L="800"/></C>`;
  const document = parseXml(source);
  const settings = document.root.children[0];
  const inserted = appendXmlAttribute(document, settings, "H", "400");
  removeXmlAttribute(document, inserted);
  assert.equal(serializeXml(document, { mode: "preserve" }), source);
});

test("editing an originally unquoted attribute keeps preserve output parseable", () => {
  const document = parseXml(`<C><P note=hello/></C>`, { allowUnquotedAttributes: true });
  const settings = document.root.children[0];
  const note = attributeEntries(settings)[0];
  setXmlAttributeValue(document, note, `two words & more`);

  const preserved = serializeXml(document, { mode: "preserve" });
  assert.equal(preserved, `<C><P note=two&#32;words&#32;&amp;&#32;more/></C>`);
  const reparsed = parseXml(preserved, { allowUnquotedAttributes: true });
  assert.equal(attributeEntries(reparsed.root.children[0])[0].value, "two words & more");
});

test("source edits reject nodes and attributes from another document", () => {
  const first = parseXml(`<C><P a="1"/></C>`);
  const second = parseXml(`<C><P b="2"/></C>`);
  const foreignNode = second.root.children[0];
  const foreignAttribute = attributeEntries(foreignNode)[0];

  assert.throws(() => setXmlAttributeValue(first, foreignAttribute, "3"), /different XML document/);
  assert.throws(() => appendXmlAttribute(first, foreignNode, "c", "4"), /different XML document/);
  assert.throws(() => removeXmlAttribute(first, foreignAttribute), /different XML document/);
});

test("semantic source node IDs can resolve directly back to AST nodes", async () => {
  const { parseTfmDocument } = await import("../src/index.js");
  const { map, document } = parseTfmDocument(`<C><P L="800"/><Z><S/><D/><O/></Z></C>`);
  const settings = getXmlNodeById(document, map.settings.source.nodeId);
  assert.equal(settings.name, "P");
  assert.equal(attributeEntries(settings)[0].value, "800");
  assert.equal(getXmlNodeById(document, 999999), null);
});

test("appending rejects attribute names that this parser would split or reject", () => {
  const document = parseXml(`<C><P/></C>`);
  const settings = document.root.children[0];
  assert.throws(() => appendXmlAttribute(document, settings, "bad name", "1"), /not accepted/);
  assert.throws(() => appendXmlAttribute(document, settings, "bad=", "1"), /not accepted/);
});

test("no-op and reverted value edits preserve the original raw entity spelling", () => {
  const source = `<C><P note="A&#38;B"/></C>`;
  const document = parseXml(source);
  const note = attributeEntries(document.root.children[0])[0];

  setXmlAttributeValue(document, note, "A&B");
  assert.equal(serializeXml(document, { mode: "preserve" }), source);

  setXmlAttributeValue(document, note, "changed");
  assert.equal(serializeXml(document, { mode: "preserve" }), `<C><P note="changed"/></C>`);

  setXmlAttributeValue(document, note, "A&B");
  assert.equal(serializeXml(document, { mode: "preserve" }), source);
});
