import test from "node:test";
import assert from "node:assert/strict";
import { parseTfmMap } from "../src/index.js";
import { renderTfmSvg } from "../src/render/svg.js";

const href = (n) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><!--${n}--></svg>`).toString("base64")}`;
function resolver(known) {
  const calls = [];
  return {
    calls,
    resolve(ref) {
      calls.push(ref);
      const key = ref.key ?? ref.source;
      return known.has(key) ? { href: href(key), width: 10, height: 10, origin: { x: 5, y: 5 } } : null;
    },
  };
}
const map = (objects) => parseTfmMap(`<C><P/><Z><S/><D/><O>${objects}</O></Z></C>`);
const render = (objects, known, options = {}) => {
  const r = resolver(new Set(known));
  return { svg: renderTfmSvg(map(objects), { assetResolver: r, ...options }), r };
};

test("an object is drawn from $Objet_<type> at its registration point, rotated by P", () => {
  const { svg } = render('<O C="1" X="40" Y="50" P="30"/>', ["$Objet_1"]);
  assert.match(svg, /<g transform="translate\(40 50\) rotate\(30\)"><image href="[^"]+" x="-5" y="-5" width="10" height="10"\/><\/g>/);
});

test("a skinned object uses its own clip and falls back to the base clip", () => {
  assert.ok(render('<O C="1002" X="1" Y="1"/>', ["$Objet_1002", "$Objet_10"]).r.calls.some((c) => c.key === "$Objet_1002"));
  const fallback = render('<O C="1002" X="1" Y="1"/>', ["$Objet_10"]);
  assert.deepEqual(fallback.r.calls.map((c) => c.key), ["$Objet_1002", "$Objet_10"]);
  assert.equal((fallback.svg.match(/<image/g) ?? []).length, 1);
});

test("ghost objects get the client's ghost colour transform; for type 32 it is the solid one", () => {
  const ghost = render('<O C="1" X="1" Y="1" P="0,1"/>', ["$Objet_1"]).svg;
  assert.match(ghost, /<g transform="translate\(1 1\)" filter="url\(#object-ghost\)">/);
  assert.match(ghost, /<feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0\.15686  0 0 1 0 0\.15686  0 0 0 0\.5 0"\/>/);
  assert.equal(render('<O C="1" X="1" Y="1"/>', ["$Objet_1"]).svg.includes("object-ghost"), false);
  assert.equal(render('<O C="32" X="1" Y="1"/>', ["$Objet_32"]).svg.includes('filter="url(#object-ghost)"'), true);
  assert.equal(render('<O C="32" X="1" Y="1" P="0,1"/>', ["$Objet_32"]).svg.includes('filter="url(#object-ghost)"'), false);
});

test("the arrow is drawn from a frame where it is visible", () => {
  const { r } = render('<O C="0" X="1" Y="1"/>', ["$Objet_0"]);
  assert.equal(r.calls[0].frame, 12);
});

test("editor mode draws every object that has art, objects without a clip get a placeholder", () => {
  assert.equal(render('<O C="26" X="1" Y="1"/>', ["$Objet_26"]).svg.includes("<image"), true);
  const missing = render('<O C="5" X="9" Y="8"/>', []);
  assert.match(missing.svg, /<rect[^>]*stroke-dasharray="3 2"[^>]*data-type="5"[^>]*\/><text[^>]*>5<\/text>/);
  assert.equal(render('<O C="5" X="9" Y="8"/>', [], { objectPlaceholders: false }).svg.includes("data-type"), false);
});

test("game mode draws only what the game creates", () => {
  const known = ["$Objet_1", "$Objet_12", "$Objet_36", "$Objet_44", "$Objet_85", "$Objet_17", "$Objet_0"];
  const drawn = (c, extra = {}) => render(`<O C="${c}" X="1" Y="1"/>`, known, { objectMode: "game", ...extra }).svg.includes("<image");
  assert.equal(drawn(1), true);
  assert.equal(drawn(17), true);
  assert.equal(drawn(12), true, "nails are always drawn by default (their creation is physics)");
  assert.equal(drawn(12, { nailVisibility: "client" }), false, "client rules: a nail with no body under it is not drawn");
  assert.equal(drawn(36), false, "refused by the game");
  assert.equal(drawn(44), false);
  assert.equal(drawn(85), false);
  assert.equal(drawn(5), false);
  assert.equal(render('<O C="5" X="1" Y="1"/>', [], { objectMode: "game" }).svg.includes("data-type"), false, "no placeholders in game mode");
});

test("game mode shows the arrow at its first frame and C=28 as one of the four balloons", () => {
  assert.equal(render('<O C="0" X="1" Y="1"/>', ["$Objet_0"], { objectMode: "game" }).r.calls[0].frame, 1);
  const keys = new Set();
  for (let seed = 1; seed < 40; seed++) {
    const { r } = render('<O C="28" X="1" Y="1"/>', ["$Objet_28", "$Objet_29", "$Objet_30", "$Objet_31"], { objectMode: "game", textureSeed: seed });
    keys.add(r.calls[0].key);
  }
  assert.deepEqual([...keys].sort(), ["$Objet_28", "$Objet_29", "$Objet_30", "$Objet_31"]);
});

test("an explicit resolveObjectAsset callback still replaces the lookup", () => {
  const { svg } = render('<O C="5" X="9" Y="8"/>', ["custom"], { resolveObjectAsset: () => "custom" });
  assert.match(svg, /<image href="[^"]+" x="9" y="8"/);
});

test("game mode draws a nail only when it joins enough bodies: one for the world nails, two for the others, grounds do not count", () => {
  const known = ["$Objet_1", "$Objet_12", "$Objet_14"];
  const count = (objects) => (render(objects, known, { objectMode: "game", nailVisibility: "client" }).svg.match(/<image/g) ?? []).length;
  const box = (x) => `<O C="1" X="${x}" Y="10"/>`;
  assert.equal(count(`${box(10)}<O C="12" X="10" Y="10"/>`), 2, "world nail on one box");
  assert.equal(count(`${box(10)}<O C="14" X="10" Y="10"/>`), 1, "nail 14 on one box is invisible");
  assert.equal(count(`${box(10)}${box(14)}<O C="14" X="12" Y="10"/>`), 3, "nail 14 on two boxes is drawn");
  assert.equal(count(`${box(10)}<O C="12" X="100" Y="10"/>`), 1, "a nail away from every box is invisible");
  assert.equal(count(`${box(10)}<O C="14" X="10" Y="10"/>`.replace("<O", '<O Mv="5" Mp="1"')), 1);
});

test("the nails 112 and 113 are drawn with the plain red nail clip, not their own skin art", () => {
  const { r } = render('<O C="112" X="1" Y="1"/><O C="113" X="2" Y="1"/>', ["$Objet_11", "$Objet_112", "$Objet_113"]);
  assert.deepEqual(r.calls.map((c) => c.key), ["$Objet_11", "$Objet_11"]);
});

test("the room colour is painted behind everything by default and can be changed or turned off", () => {
  const m = map("");
  assert.match(renderTfmSvg(m), /^<svg[^>]*><rect x="0" y="0" width="800" height="400" fill="#6a7495"\/>/);
  assert.match(renderTfmSvg(m, { backgroundColor: "#102030" }), /fill="#102030"/);
  assert.equal(renderTfmSvg(m, { backgroundColor: null }).includes("<rect"), false);
  assert.equal(renderTfmSvg(m, { backgroundColor: "none" }).includes("<rect"), false);
  assert.equal(renderTfmSvg(m, { defaultAssets: false }).includes("<rect"), false);
});

test("in a mirrored map every object keeps its picture unflipped (counter-flip inside), whatever its type", () => {
  const known = ["$Objet_6", "$Objet_1", "$Objet_17"];
  const svg = renderTfmSvg(map('<O C="6" X="100" Y="10"/><O C="1" X="200" Y="10" P="30"/><O C="17" X="300" Y="10"/>'), { assetResolver: resolver(new Set(known)), mirrorX: true });
  assert.match(svg, /<g transform="translate\(100 10\) scale\(-1 1\)">/);
  assert.match(svg, /<g transform="translate\(200 10\) rotate\(30\) scale\(-1 1\)">/);
  assert.match(svg, /<g transform="translate\(300 10\) scale\(-1 1\)">/);
  assert.equal(renderTfmSvg(map('<O C="6" X="100" Y="10"/>'), { assetResolver: resolver(new Set(known)) }).includes("scale(-1 1)"), false);
});

test("game-mode nails follow the game: the limit on rotating nails, hide-anchors (mc) and one world-nail picture per body", () => {
  const known = ["$Objet_1", "$Objet_11", "$Objet_12", "$Objet_13", "$Objet_14"];
  const count = (settings, objects) => {
    const m = parseTfmMap(`<C><P L="800" H="400"${settings}/><Z><S/><D/><O>${objects}</O></Z></C>`);
    return (renderTfmSvg(m, { assetResolver: resolver(new Set(known)), objectMode: "game", nailVisibility: "client", textures: false }).match(/<image/g) ?? []).length;
  };
  const box = '<O C="1" X="100" Y="100"/>';
  // 13 boxes in a row, each with its own rotating world nail (12): joints beyond the 11th are refused (`mene > 10`)
  const many = Array.from({ length: 13 }, (_, i) => `<O C="1" X="${50 + i * 50}" Y="100"/>`).join("") + Array.from({ length: 13 }, (_, i) => `<O C="12" X="${50 + i * 50}" Y="100"/>`).join("");
  assert.equal(count("", many), 13 + 11);
  // non-rotating world nails (11) are not limited
  const calm = Array.from({ length: 13 }, (_, i) => `<O C="1" X="${50 + i * 50}" Y="100"/>`).join("") + Array.from({ length: 13 }, (_, i) => `<O C="11" X="${50 + i * 50}" Y="100"/>`).join("");
  assert.equal(count("", calm), 13 + 13);
  // mc: no nail pictures at all (the boxes stay)
  assert.equal(count(' mc=""', box + '<O C="12" X="100" Y="100"/>'), 1);
  // a body carries the picture of one world nail only: the second nail on the same box is not drawn
  assert.equal(count("", box + '<O C="11" X="100" Y="100"/><O C="12" X="105" Y="100"/>'), 2);
  // a two-body nail (14) is not blocked by a world nail on the other body, but one on its first body hides its picture
  assert.equal(count("", box + '<O C="1" X="110" Y="100"/><O C="14" X="105" Y="100"/>'), 3);
});

test("game mode draws every nail by default (when a nail is made is run-time physics); nailVisibility: client applies the client's rules", () => {
  const known = ["$Objet_1", "$Objet_14"];
  const m = parseTfmMap('<C><P L="800" H="400"/><Z><S/><D/><O><O C="1" X="10" Y="10"/><O C="14" X="10" Y="10"/><O C="14" X="500" Y="10"/></O></Z></C>');
  const n = (extra) => (renderTfmSvg(m, { assetResolver: resolver(new Set(known)), objectMode: "game", textures: false, ...extra }).match(/<image/g) ?? []).length;
  assert.equal(n({}), 3, "all nails, even the ones that join nothing");
  assert.equal(n({ nailVisibility: "client" }), 1, "client rules: both nails 14 need two bodies");
});
