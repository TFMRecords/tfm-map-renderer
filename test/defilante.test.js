// Defilante markers (docs/xml/settings.md#defilante): objects 6, 32, 15 and 16 of a defilante map drawn as the game's pictures.
import test from "node:test";
import assert from "node:assert/strict";
import { parseTfmMap, renderTfmSvg } from "../src/index.js";
import { resolveClientImageUrl } from "../src/assets/image-urls.js";

const xml = (settings, objects) => `<C><P ${settings}/><Z><S/><D/><O>${objects}</O><L/></Z></C>`;
// The four kinds, and a plain object (type 1) that stays an object.
const MIXED = '<O X="100" Y="50" C="6" P="0"/><O X="200" Y="60" C="32" P="0"/><O X="300" Y="70" C="15" P="0"/><O X="400" Y="80" C="16" P="0"/><O X="500" Y="90" C="1" P="0"/>';
const asked = [];
const resolver = {
  resolve(ref) {
    if (ref.kind !== "standard") return null;
    asked.push(ref.source);
    return { href: `data:image/png;base64,${ref.source}`, width: 30, height: 30 };
  },
};
const render = (settings, options = {}) => renderTfmSvg(parseTfmMap(xml(settings, MIXED)), { assetResolver: resolver, textures: false, ...options });

test("each marker kind is its picture, 30 x 30, centred on the point", () => {
  asked.length = 0;
  const svg = render('defilante="0,0,0,0"');
  assert.deepEqual(asked, ["defilante_plus.png", "defilante_vitesse.png", "defilante_mort.png", "defilante_saut.png"]);
  assert.match(svg, /<g transform="translate\(100 50\)"><image href="data:image\/png;base64,defilante_plus.png" x="-15" y="-15" width="30" height="30"/);
  assert.match(svg, /<g transform="translate\(400 80\)"><image href="data:image\/png;base64,defilante_saut.png"/);
});

test("markers only in defilante maps; the option turns them off; the bonus can be the heart", () => {
  asked.length = 0;
  render("");
  assert.deepEqual(asked, [], "without defilante these are shaman objects");
  asked.length = 0;
  render('defilante="0,0,0,0"', { defilanteMarkers: false });
  assert.deepEqual(asked, []);
  asked.length = 0;
  render('defilante="0,0,0,0"', { defilanteBonus: "heart" });
  assert.equal(asked[0], "defilante_coeur.png");
});

test("mirrored: the point moves with the map, the picture is flipped back", () => {
  const svg = render('defilante="0,0,0,0"', { mirrorX: true });
  assert.match(svg, /<g transform="translate\(100 50\) scale\(-1 1\)"><image href="data:image\/png;base64,defilante_plus.png"/);
});

test("without the pictures a ring stands in, unless defaultAssets is false", () => {
  const map = parseTfmMap(xml('defilante="0,0,0,0"', MIXED));
  assert.equal((renderTfmSvg(map, { textures: false }).match(/data-kind="defilante-\d"/g) ?? []).length, 4);
  assert.ok(!renderTfmSvg(map, { textures: false, defaultAssets: false }).includes("defilante-"));
});

test("the pictures resolve to the game's image host by the D rule", () => {
  const r = resolveClientImageUrl("D", "defilante_mort.png", { scheme: "http" });
  assert.equal(r.url, "http://www.transformice.com/images/defilante_mort.png");
});
