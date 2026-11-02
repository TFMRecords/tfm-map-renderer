import test from "node:test";
import assert from "node:assert/strict";
import { parseTfmMap } from "../src/index.js";
import { renderTfmSvg } from "../src/render/svg.js";

const known = new Set(["$Trou_Souris", "$Fromage", "$FromageDodue", "$FromageDoduehalloween"]);
const seen = [];
const resolver = {
  resolve: ({ key, source }) => {
    const k = key ?? source;
    seen.push(k);
    return known.has(k) ? { href: `data:image/svg+xml;utf8,${encodeURIComponent(k)}`, width: 40, height: 30, origin: { x: 20, y: 25 } } : null;
  },
};
const map = (settings) => parseTfmMap(`<C><P L="800" H="400"${settings}/><Z><S/><D><T X="10" Y="20"/><F X="30" Y="40"/><DS X="5" Y="5"/></D><O/></Z></C>`);

test("holes and cheese use the client clips at their registration point; spawns stay placeholders", () => {
  seen.length = 0;
  const svg = renderTfmSvg(map(""), { assetResolver: resolver, textures: false });
  assert.match(svg, /<g transform="translate\(10 20\)" data-role="hole"><image[^>]*x="-20" y="-25"/);
  assert.match(svg, /data-role="cheese"/);
  assert.match(svg, /data-role="mouse-spawn"/);
  assert.ok(seen.includes("$Trou_Souris") && seen.includes("$Fromage"));
});

test("dodue picks $FromageDodue, the halloween theme looks the themed clip up first", () => {
  seen.length = 0;
  renderTfmSvg(map(' dodue="" theme="halloween"'), { assetResolver: resolver, textures: false });
  assert.ok(seen.indexOf("$FromageDoduehalloween") !== -1);
  seen.length = 0;
  const svg = renderTfmSvg(map(' theme="halloween"'), { assetResolver: resolver, textures: false });
  assert.ok(seen.indexOf("$Fromagehalloween") < seen.indexOf("$Fromage")); // themed first; the base clip is only looked up to tell "no such themed clip" from "no assets"
  assert.match(svg, /<!-- empty clip: \$Fromagehalloween is not defined -->/); // the client draws an empty clip (verified in the game)
});

test("without the clips the placeholders are drawn", () => {
  const svg = renderTfmSvg(map(""), { assetResolver: { resolve: () => null }, textures: false });
  assert.match(svg, /<ellipse[^>]*data-role="hole"/);
  assert.match(svg, /<circle[^>]*data-role="cheese"/);
});

test("a hole with the D attribute is drawn in the foreground layer", () => {
  const fg = parseTfmMap('<C><P L="800" H="400"/><Z><S/><D><T X="10" Y="20" D=""/></D><O/></Z></C>');
  const svg = renderTfmSvg(fg, { assetResolver: resolver, textures: false });
  assert.equal((svg.match(/data-role="hole"/g) ?? []).length, 1);
});

test("a hole is never hidden by an attribute: `i` and unknown attributes do nothing (real game and editor draw it)", () => {
  for (const attribute of ['i=""', 'hidden=""']) {
    const map = parseTfmMap(`<C><P L="800" H="400"/><Z><S/><D><T X="10" Y="20" ${attribute}/></D><O/></Z></C>`);
    assert.match(renderTfmSvg(map, { assetResolver: resolver, textures: false }), /data-role="hole"/);
    assert.match(renderTfmSvg(map, { assetResolver: resolver, textures: false, restricted: true }), /data-role="hole"/);
  }
});

test("holes with CT 1 or 2 get the client's glow filter, defined once", async () => {
  const { parseTfmMap } = await import("../src/index.js");
  const { renderTfmSvg } = await import("../src/render/svg.js");
  const href = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>').toString("base64")}`;
  const resolver = { resolve: (ref) => ((ref.key ?? ref.source) === "$Trou_Souris" ? { href, width: 10, height: 10, origin: { x: 5, y: 5 } } : null) };
  const map = parseTfmMap('<C><P/><Z><S/><D><T X="1" Y="2" CT="1"/><T X="3" Y="4" CT="1" D=""/><T X="5" Y="6" CT="2"/><T X="7" Y="8"/></D><O/></Z></C>');
  const svg = renderTfmSvg(map, { assetResolver: resolver });
  assert.equal((svg.match(/<filter id="hole-glow-1"/g) ?? []).length, 1);
  assert.equal((svg.match(/<filter id="hole-glow-2"/g) ?? []).length, 1);
  assert.match(svg, /<filter id="hole-glow-1"[^>]*>.*flood-color="#98e2eb"/);
  assert.match(svg, /flood-color="#feb1fc"/);
  assert.equal((svg.match(/filter="url\(#hole-glow-1\)"/g) ?? []).length, 2);
  assert.equal((svg.match(/filter="url\(#hole-glow-2\)"/g) ?? []).length, 1);
});

test("the event cheese suffix goes between $Fromage and the theme, and not onto $FromageDodue", async () => {
  const { parseTfmMap } = await import("../src/index.js");
  const { renderTfmSvg } = await import("../src/render/svg.js");
  const calls = [];
  const resolver = { resolve: (ref) => { calls.push(ref.key ?? ref.source); return null; } };
  const run = (settings, options) => { calls.length = 0; renderTfmSvg(parseTfmMap(`<C><P ${settings}/><Z><S/><D><F X="1" Y="2"/></D><O/></Z></C>`), { assetResolver: resolver, ...options }); return calls.filter((c) => c.startsWith("$Fromage")); };
  assert.deepEqual(run("", {}), ["$Fromage"]);
  assert.deepEqual(run("", { cheeseSuffix: "Citrouille" }), ["$FromageCitrouille"]);
  assert.deepEqual(run('theme="halloween"', { cheeseSuffix: "Citrouille" }), ["$FromageCitrouillehalloween", "$FromageCitrouille"]);
  assert.deepEqual(run('dodue=""', { cheeseSuffix: "Citrouille" }), ["$FromageDodue"]);
});

test("bottom-layer holes and cheese sit under the grounds, foreground holes over them, foreground cheese over the objects", async () => {
  const { parseTfmMap } = await import("../src/index.js");
  const { renderTfmSvg } = await import("../src/render/svg.js");
  const href = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>').toString("base64")}`;
  const resolver = { resolve: (ref) => ({ href, width: 10, height: 10, origin: { x: 0, y: 0 }, key: ref.key ?? ref.source }) };
  const xml = '<C><P/><Z><S><S T="12" X="50" Y="50" L="40" H="40" o="ff0000" P="0,0,0.3,0.2,0,0,0,0"/></S><D><T X="1" Y="1"/><T X="2" Y="2" D=""/><F X="3" Y="3"/><F X="4" Y="4" D=""/></D><O><O C="1" X="9" Y="9"/></O></Z></C>';
  const svg = renderTfmSvg(parseTfmMap(xml), { assetResolver: resolver });
  const at = (needle) => svg.indexOf(needle);
  const ground = at('fill="#ff0000"') >= 0 ? at('fill="#ff0000"') : at("<rect");
  const roles = [...svg.matchAll(/translate\((\d+) (\d+)\)" data-role="(hole|cheese)"/g)].map((m) => [Number(m[1]), m[3], m.index]);
  const pos = (x) => roles.find((r) => r[0] === x)[2];
  assert.equal(pos(1) < ground, true, "plain hole under the ground");
  assert.equal(pos(3) < ground, true, "plain cheese under the ground");
  assert.equal(pos(2) > ground, true, "foreground hole over the ground");
  const object = svg.indexOf('translate(9 9)');
  assert.equal(pos(4) > object, true, "foreground cheese over the objects");
});

test("a theme without a matching clip draws an empty cheese (the game's lookup returns an empty clip), a themed clip is drawn, no assets draw a placeholder", async () => {
  const { parseTfmMap } = await import("../src/index.js");
  const { renderTfmSvg } = await import("../src/render/svg.js");
  const href = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>').toString("base64")}`;
  const known = (names) => ({ resolve: (ref) => (names.includes(ref.key ?? ref.source) ? { href, width: 10, height: 10, origin: { x: 0, y: 0 } } : null) });
  const map = (settings) => parseTfmMap(`<C><P ${settings}/><Z><S/><D><F X="1" Y="2"/></D><O/></Z></C>`);
  const draw = (settings, names) => renderTfmSvg(map(settings), { assetResolver: known(names) });
  assert.match(draw('theme="halloween"', ["$Fromage"]), /<!-- empty clip: \$Fromagehalloween is not defined -->/);
  assert.doesNotMatch(draw('theme="halloween"', ["$Fromage"]), /data-role="cheese"/);
  assert.match(draw('dodue="" theme="halloween"', ["$FromageDodue", "$FromageDoduehalloween"]), /data-role="cheese"/);
  assert.match(draw('theme="halloween"', []), /data-role="cheese"/, "no assets at all: the placeholder");
  assert.match(draw("", ["$Fromage"]), /data-role="cheese"/);
});
