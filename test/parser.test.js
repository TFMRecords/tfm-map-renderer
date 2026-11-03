import test from "node:test";
import assert from "node:assert/strict";
import { parseXml, serializeXml, parseTfmMap, parseTfmDocument, XmlSyntaxError } from "../src/index.js";

test("accepts arbitrary root name and comments without shifting semantic element slots", () => {
  const xml = `<GPT><!--a--><Whatever L="900" H="500"/><!--b--><Zone><Grounds><S T="0" X="10" Y="20" L="30" H="40"/></Grounds><Decor><T X="2" Y="3"/></Decor><Objects><O C="1" X="4" Y="5"/></Objects></Zone></GPT>`;
  const { map, document } = parseTfmDocument(xml);
  assert.equal(map.source.rootName, "GPT");
  assert.equal(map.settings.width, 900);
  assert.equal(map.settings.height, 500);
  assert.equal(map.grounds.length, 1);
  assert.equal(map.grounds[0].x, 10);
  assert.equal(map.decorations[0].kind, "T");
  assert.equal(map.objects[0].type, 1);
  assert.equal(serializeXml(document), xml);
});

test("preserves unknown root and zone children", () => {
  const xml = `<C><P/><Z><S/><D/><O/><L/><custom a="1"/></Z><after foo="bar"/></C>`;
  const map = parseTfmMap(xml);
  assert.equal(map.extensions.unknown.rootChildren[0].source.rawName, "after");
  assert.equal(map.extensions.unknown.zoneChildren[0].source.rawName, "custom");
});

test("decodes D image tuples without applying runtime feature gates", () => {
  const xml = `<C><P D="img.png,10,20,3,step"/><Z><S/><D/><O/></Z></C>`;
  const map = parseTfmMap(xml);
  assert.deepEqual(map.settings.images.background[0], {
    kind: "image",
    url: "img.png",
    x: 10,
    y: 20,
    repeatCount: 3,
    repeatArg: "step",
    raw: "img.png,10,20,3,step"
  });
});

test("D and d image tuple loops retain incomplete groups and the client's d-repeat quirk", () => {
  const xml = `<C><P D="bg.png,10;" d="fg.png,20;tail.png,30,40,2;"/><Z><S/><D/><O/></Z></C>`;
  const { images } = parseTfmMap(xml).settings;

  assert.deepEqual(images.background, [
    { kind: "image", url: "bg.png", x: 10, y: 0, repeatCount: 0, repeatArg: null, raw: "bg.png,10" },
    { kind: "image", url: "", x: 0, y: 0, repeatCount: 0, repeatArg: null, raw: "" },
  ]);
  assert.deepEqual(images.foreground, [
    { kind: "image", url: "fg.png", x: 20, y: 0, repeatCount: 0, repeatArg: null, raw: "fg.png,20" },
    { kind: "image", url: "tail.png", x: 30, y: 40, repeatCount: 2, repeatArg: null, raw: "tail.png,30,40,2" },
    { kind: "image", url: "", x: 0, y: 0, repeatCount: 0, repeatArg: null, raw: "" },
  ]);
});

test("parses single quotes, entities and duplicate attributes while preserving diagnostics", () => {
  const doc = parseXml(`<C a='x&amp;y' a="last"><P/><Z><S/><D/><O/></Z></C>`);
  assert.equal(doc.root.attributes[0].value, "x&y");
  assert.equal(doc.root.attributes[1].value, "last");
  assert.equal(doc.diagnostics[0].code, "duplicate-attribute");
});

test("rejects mismatched tags rather than inventing unverified recovery", () => {
  assert.throws(() => parseXml(`<C><P></C>`), XmlSyntaxError);
});

test("does not clamp width/height or mirror coordinates", () => {
  const xml = `<C><P L="99999" H="9999"/><Z><S><S T="0" X="10" Y="20" L="30" H="40"/></S><D/><O><O C="1" X="12" Y="13"/></O></Z></C>`;
  const map = parseTfmMap(xml);
  assert.equal(map.settings.width, 99999);
  assert.equal(map.settings.height, 9999);
  assert.equal(map.grounds[0].x, 10);
  assert.equal(map.objects[0].x, 12);
});

test("parser preserves source values beyond client runtime limits", () => {
  const xml = `<C><P L="99999" H="9999" D="img,1,2,999,arg"/><Z><S/><D/><O/></Z></C>`;
  const map = parseTfmMap(xml);
  assert.equal(map.settings.width, 99999);
  assert.equal(map.settings.height, 9999);
  assert.equal(map.settings.images.background[0].repeatCount, 999);
});

test("missing map dimensions stay absent for renderer defaults", () => {
  const map = parseTfmMap(`<C><P/><Z><S/><D/><O/></Z></C>`);
  assert.equal(map.settings.width, null);
  assert.equal(map.settings.height, null);
});

test("custom extension decoders can add data without replacing core parsing", () => {
  const xml = `<C><P custom="abc"/><Z><S/><D><EV X="1" Y="2" foo="bar"/></D><O/></Z></C>`;
  const map = parseTfmMap(xml, {
    extensions: [{
      name: "event-tags",
      scopes: ["decoration"],
      match: (node) => node.name === "EV",
      decode: (node) => ({ foo: Object.fromEntries(node.attributes.map((a) => [a.name, a.value])).foo })
    }]
  });
  assert.equal(map.decorations[0].kind, "EV");
  assert.deepEqual(map.extensions.decoded[0].value, { foo: "bar" });
});

test("parser keeps source image data even when runtime feature options request it be disabled", () => {
  const xml = `<C><P D="image.png,1,2"/><Z><S><S T="0" X="1" Y="2" L="3" H="4" i="ground.png"/></S><D/><O/></Z></C>`;
  const map = parseTfmMap(xml, { features: { images: false } });
  assert.equal(map.settings.images.background[0].url, "image.png");
  assert.equal(map.grounds[0].image, "ground.png");
});

test("client structure mode keeps positional container semantics", () => {
  const xml = `<C><P/><Z><custom/><S><S T="6" X="5" Y="6" L="7" H="8"/></S><D/><O/></Z></C>`;
  const map = parseTfmMap(xml);
  // custom is slot 0, so its empty child list is treated as grounds in client mode.
  assert.equal(map.grounds.length, 0);
});

test("hybrid structure mode can recover named containers around custom nodes", () => {
  const xml = `<C><P/><Z><custom/><S><S T="6" X="5" Y="6" L="7" H="8"/></S><D/><O/></Z></C>`;
  const map = parseTfmMap(xml, { structureMode: "hybrid" });
  assert.equal(map.grounds.length, 1);
  assert.equal(map.grounds[0].x, 5);
});

test("settings expose stable semantic names without runtime transformations", () => {
  const xml = `<C><P G="2,9.8" mgoc="7" DS="m;10,20,30,40" N="200,1" F="3" P="" C="" A="" Ca="" mc="" bh=""/><Z><S/><D/><O/></Z></C>`;
  const map = parseTfmMap(xml);
  assert.equal(map.settings.wind, 2);
  assert.equal(map.settings.gravity, 9.8);
  assert.equal(map.settings.shamanObjectsMass, 7);
  assert.deepEqual(map.settings.miceSpawn.positions, [{ x: 10, y: 20 }, { x: 30, y: 40 }]);
  assert.deepEqual(map.settings.night, { raw: "200,1", diameter: 200, type: 1 });
  assert.equal(map.settings.backgroundImageId, 3);
  assert.equal(map.settings.portals, true);
  assert.equal(map.settings.collisions, true);
  assert.equal(map.settings.soulmate, true);
  assert.equal(map.settings.hideOffscreen, true);
  assert.equal(map.settings.hideNails, true);
  assert.equal(map.settings.upwardsCannonballs, true);
});

test("decoration and shaman-object packed fields are semantic", () => {
  const xml = `<C><P/><Z><S/><D><P T="42" X="1" Y="2" P="1,2" C="ABCDEF,123456"/></D><O><O C="11" X="3" Y="4" Mv="2.5" Mp="3.5" P="45,1"/></O></Z></C>`;
  const map = parseTfmMap(xml);
  assert.equal(map.decorations[0].type, 42);
  assert.equal(map.decorations[0].foreground, true);
  assert.equal(map.decorations[0].inversionCode, 2);
  assert.equal(map.decorations[0].reverse, "random");
  assert.deepEqual(map.decorations[0].colors, ["ABCDEF", "123456"]);
  assert.equal(map.objects[0].speed, 2.5);
  assert.equal(map.objects[0].power, 3.5);
  assert.equal(map.objects[0].rotation, 45);
  assert.equal(map.objects[0].ghost, true, 'P="45,1": packed field 2 === "1" is a ghost object');
});

test("decoration inversion codes match confirmed client render policy", () => {
  const xml = `<C><P/><Z><S/><D>
    <P T="1" P="0,0"/><P T="2" P="0,1"/><P T="3" P="0,2"/><P T="4" P="0,3"/>
  </D><O/></Z></C>`;
  const { decorations } = parseTfmMap(xml);
  assert.deepEqual(decorations.map((entry) => entry.inversionCode), [0, 1, 2, 3]);
  assert.deepEqual(decorations.map((entry) => entry.reverse), [false, true, "random", false]);
});

test("preserveUnknown false removes unknown attrs and unknown structural nodes from semantic output", () => {
  const xml = `<C><P mystery="x"/><Z><S><S T="0" X="1" Y="2" L="3" H="4" odd="yes"/></S><D/><O/><custom foo="bar"/></Z><tail nope="1"/></C>`;
  const map = parseTfmMap(xml, { preserveUnknown: false });
  assert.equal(map.settings.attributes.mystery, undefined);
  assert.equal(map.grounds[0].attributes.odd, undefined);
  assert.equal(map.settings.unknownAttributes, undefined);
  assert.equal(map.grounds[0].unknownAttributes, undefined);
  assert.equal(map.extensions.unknown, undefined);
});

test("complex fixture decodes source-backed special markers and ghost semantics", async () => {
  const { readFile } = await import("node:fs/promises");
  const xml = await readFile(new URL("./fixtures/complex-features.xml", import.meta.url), "utf8");
  const map = parseTfmMap(xml.trim());

  assert.deepEqual(map.settings.shamanTools, [6, 2]);
  assert.equal(map.decorations[0].role, "hole");
  assert.equal(map.decorations[0].holeType, 1);
  assert.equal(map.decorations[1].holeType, 2);
  assert.equal(map.decorations[2].role, "cheese");
  assert.equal(map.decorations[3].role, "mouse-spawn");
  assert.equal(map.decorations[4].role, "shaman-spawn");
  assert.equal(map.decorations[5].role, "dual-shaman-spawn");
  assert.equal(map.decorations[6].role, "decoration");
  assert.equal(map.objects[0].ghost, true);
  assert.equal(map.objects[1].ghost, false);
});

test("complex fixture decodes joint style and motor fields without guessing point helpers", async () => {
  const { readFile } = await import("node:fs/promises");
  const xml = await readFile(new URL("./fixtures/complex-features.xml", import.meta.url), "utf8");
  const map = parseTfmMap(xml.trim());

  assert.deepEqual(map.joints[0].style, {
    raw: "000000,2,.5,0",
    color: 0,
    thickness: 2,
    alphaRaw: ".5",
    alpha: 0.5,
    foreground: false,
  });
  assert.deepEqual(map.joints[1].motor, {
    raw: "Infinity,10",
    power: Infinity,
    speed: 10,
  });
  assert.equal(map.joints[1].style.color, 0xff0000);
  assert.equal(map.joints[1].style.foreground, true);
  assert.deepEqual(map.joints[1].axis, { raw: "1,0", x: 1, y: 0, extra: [] });
  assert.equal(map.joints[2].ratio, 1);
  assert.deepEqual(map.joints[3].motor, { raw: "5,-2", power: 5, speed: -2 });
  assert.deepEqual(map.joints[0].p1, { raw: "1,2", x: 1, y: 2, extra: [] });
});

test("defilante is presence-based even when the attribute value is empty", () => {
  const map = parseTfmMap(`<C><P defilante=""/><Z><S/><D/><O/></Z></C>`);
  assert.notEqual(map.settings.defilante, null);
  assert.equal(map.settings.defilante.raw, "");
  assert.equal(map.settings.defilante.startSpeed, 0);
});

test("image repeat decoding keeps source counts but converts empty or invalid counts to zero", async () => {
  const { readFile } = await import("node:fs/promises");
  const xml = await readFile(new URL("./fixtures/complex-features.xml", import.meta.url), "utf8");
  const map = parseTfmMap(xml.trim());

  assert.equal(map.settings.images.background[0].repeatCount, 3);
  assert.equal(map.settings.images.background[1].repeatCount, 0);
  assert.equal(map.settings.images.foreground[0].kind, "image");
  assert.equal(map.settings.images.foreground[0].repeatCount, 2);
  assert.equal(map.settings.images.foreground[1].repeatCount, 0);
  assert.deepEqual(map.settings.images.ip[0], {
    kind: "image",
    url: "overlay.png",
    x: 12,
    y: 34,
    raw: "overlay.png,12,34",
  });
});

test("complex fixture preserves advanced ground fields and decodes particle source data", async () => {
  const { readFile } = await import("node:fs/promises");
  const xml = await readFile(new URL("./fixtures/complex-features.xml", import.meta.url), "utf8");
  const map = parseTfmMap(xml.trim());
  const ground = map.grounds[0];

  assert.equal(ground.inputSpeedBonus, 0);
  assert.equal(ground.outputSpeedBonus, 3.5);
  assert.deepEqual(ground.friction, { x: 1.5, y: 2.5 });
  assert.equal(ground.tint, 0xff00aa);
  assert.equal(ground.color, 0x112233);
  assert.equal(ground.image, "ground-image.png");
  assert.equal(ground.foreground, true);
  assert.equal(map.particles.length, 1);
  assert.equal(map.particles[0].rawName, "particle");
  assert.equal(map.particles[0].rawName, "particle");
  assert.equal(map.particles[0].id, null);
  assert.equal(map.particles[0].duration, 0);
  assert.equal(map.particles[0].interval, 0);
  assert.equal(map.particles[0].attributes.foo, "bar");
});

test("tiled D records expose the target dimensions of the tiled area", () => {
  const map = parseTfmMap(`<C><P D="#tile,800,600"/><Z><S/><D/><O/></Z></C>`);
  assert.deepEqual(map.settings.images.background[0], {
    kind: "special",
    specialType: "tiled-bitmap",
    value: "tile",
    width: 800,
    height: 600,
    raw: "#tile,800,600",
  });
});

test("particle fields follow the documented conversions; the 10000 duration cap is reported as derived", () => {
  const map = parseTfmMap(`<C><P/><Z><S/><D/><O/><particles>
    <particle id="#ff" img="spark.png" dur="20001" int="17.9" loop="1" ori="12.9,-3.2" sp="1.5,2.5;4,5" acc="0.5;1.25,2.5"/>
  </particles></Z></C>`);
  const particle = map.particles[0];
  assert.equal(particle.idValue, 255);
  assert.equal(particle.idIsHex, true);
  assert.equal(particle.image, "spark.png");
  assert.equal(particle.duration, 20001);
  assert.equal(particle.derived.duration, 10000);
  assert.equal(particle.interval, 17);
  assert.equal(particle.loop, true);
  assert.deepEqual(particle.position, { x: 12, y: -3, raw: "12.9,-3.2" });
  assert.equal(particle.orientation, particle.position, "orientation is the earlier name of position");
  assert.deepEqual(particle.speed, { x: { from: 1.5, to: 2.5 }, y: { from: 4, to: 5 }, raw: "1.5,2.5;4,5", secondGroupMissing: false });
  assert.deepEqual(particle.acceleration, { x: { from: 0.5, to: 0.5 }, y: { from: 1.25, to: 2.5 }, raw: "0.5;1.25,2.5", secondGroupMissing: false });
  assert.deepEqual(particle.derived, {
    duration: 10000,
    position: { x: 12, y: -3 },
    speed: { x: { from: 1.5, to: 2.5 }, y: { from: 4, to: 5 } },
    acceleration: { x: { from: 0.5, to: 0.5 }, y: { from: 1.25, to: 2.5 } },
  });
});

test("an emitter without ori, sp or acc starts at (0, 0) without speed", () => {
  const particle = parseTfmMap(`<C><P/><Z><S/><D/><O/><particles><p id="1" ori=""/></particles></Z></C>`).particles[0];
  assert.equal(particle.position, null);
  assert.deepEqual(particle.derived.position, { x: 0, y: 0 });
  assert.deepEqual(particle.derived.speed, { x: { from: 0, to: 0 }, y: { from: 0, to: 0 } });
  assert.deepEqual(particle.derived.acceleration, particle.derived.speed);
});

test("client-style truthiness keeps empty dimensions absent but preserves empty G conversion", () => {
  const map = parseTfmMap(`<C><P L="" H="" G=""/><Z><S/><D/><O/></Z></C>`);
  assert.equal(map.settings.width, null);
  assert.equal(map.settings.height, null);
  assert.equal(map.settings.wind, 0);
  assert.equal(Number.isNaN(map.settings.gravity), true);
  assert.equal(map.settings.attributes.L, "");
  assert.equal(map.settings.attributes.G, "");
});

test("defilante keeps XML-facing units while preserving raw fields used by client conversion", () => {
  const value = parseTfmMap(`<C><P defilante="72.9,1.5,9,1"/><Z><S/><D/><O/></Z></C>`).settings.defilante;
  assert.equal(value.startSpeedRaw, "72.9");
  assert.equal(value.startSpeed, 72);
  assert.equal(value.accelerationRaw, "1.5");
  assert.equal(value.acceleration, 1.5);
  assert.equal(value.maxSpeedRaw, "9");
  assert.equal(value.maxSpeed, 9);
  assert.equal(value.freeScroll, true);
});

test("DS selector decoding requires exactly two semicolon fields like the supplied client routine", () => {
  const map = parseTfmMap(`<C><P DS="m;10,20;extra"/><Z><S/><D/><O/></Z></C>`);
  assert.deepEqual(map.settings.miceSpawn, {
    type: "unknown",
    selector: "m",
    payload: "10,20",
    extra: ["extra"],
    raw: "m;10,20;extra",
  });
});

test("ground type 9 preserves packed P but does not misdecode it as ordinary physics", () => {
  const map = parseTfmMap(`<C><P/><Z><S><S T="9" X="0" Y="0" L="10" H="20" P="1,2,3,4,5,1,6,7"/></S><D/><O/></Z></C>`);
  assert.equal(map.grounds[0].physicsRaw, "1,2,3,4,5,1,6,7");
  assert.equal(map.grounds[0].physics, null);
});

test("parkour attributes on a yellow nail are decoded under map.modules.parkour", () => {
  const map = parseTfmMap(`<C><P/><Z><S/><D/><O><O C="22" X="0" Y="0" stop="" size="24.5"/></O></Z></C>`);
  assert.equal(map.modules.parkour.checkpoints[0].stop, true);
  assert.equal(map.modules.parkour.checkpoints[0].size, 24.5);
  assert.equal("stop" in map.objects[0], false, "module data stays out of the core fields");
});

test("object movement fields are activated by non-empty Mv, matching source truthiness", () => {
  const withoutMotion = parseTfmMap(`<C><P/><Z><S/><D/><O><O C="1" X="0" Y="0" Mv="" Mp="7"/></O></Z></C>`).objects[0];
  assert.equal(withoutMotion.speed, null);
  assert.equal(withoutMotion.power, null);

  const withMotion = parseTfmMap(`<C><P/><Z><S/><D/><O><O C="1" X="0" Y="0" Mv="2.5" Mp="7"/></O></Z></C>`).objects[0];
  assert.equal(withMotion.speed, 2.5);
  assert.equal(withMotion.power, 7);
});


test("number0 normalizes NaN to zero while preserving valid and infinite numbers", () => {
  const map = parseTfmMap(`<C><P defilante="-7.9,bad,Infinity,0"/><Z><S/><D/><O/><L>
    <JD M1="0" M2="1" HZ="bad" AMP="2.5" c="ff00ff,3,bad,1"/>
    <JP M1="1" M2="2" P1="1.9,-2.9" AXIS="3.8,bad" A="bad"/>
  </L></Z></C>`);

  assert.equal(map.settings.defilante.startSpeed, 0);
  assert.equal(map.settings.defilante.acceleration, 0);
  assert.equal(map.settings.defilante.maxSpeed, Infinity);
  assert.equal(map.joints[0].hz, 0);
  assert.equal(map.joints[0].amplitude, 2.5);
  assert.equal(map.joints[0].style.alpha, 0);
  assert.equal(map.joints[1].angle, 0);
});

test("joint points and axis use int conversion before runtime scaling or mirroring", () => {
  const map = parseTfmMap(`<C><P/><Z><S/><D/><O/><L>
    <JP M1="0" M2="1" P1="1.9,-2.9" AXIS="3.8,bad"/>
  </L></Z></C>`);
  assert.deepEqual(map.joints[0].p1, { raw: "1.9,-2.9", x: 1, y: -2, extra: [] });
  assert.deepEqual(map.joints[0].axis, { raw: "3.8,bad", x: 3, y: 0, extra: [] });
});

test("APS/ARPS records expose the rectangle and image position values", () => {
  const map = parseTfmMap(`<C><P APS="img.png,0,10,20,30,40,5,6;skip,1,2" ARPS="other.png,2,-1,-2,3,4,0,0"/><Z><S/><D/><O/></Z></C>`);
  assert.deepEqual(map.settings.images.disappearing, [{
    url: "img.png",
    mode: 0,
    modeIsZero: true,
    rect: { x: 10, y: 20, width: 30, height: 40, right: 40, bottom: 60 },
    imagePosition: { x: 5, y: 6 },
    fields: ["img.png", "0", "10", "20", "30", "40", "5", "6"],
    raw: "img.png,0,10,20,30,40,5,6",
  }]);
  assert.equal(map.settings.images.appearing[0].mode, 2);
  assert.equal(map.settings.images.appearing[0].modeIsZero, false);
  assert.deepEqual(map.settings.images.appearing[0].rect, { x: -1, y: -2, width: 3, height: 4, right: 2, bottom: 2 });
  assert.deepEqual(map.settings.images.appearing[0].imagePosition, { x: 0, y: 0 });
});

test("APS/ARPS rectangle edges retain AS3 int overflow semantics", () => {
  const map = parseTfmMap(`<C><P APS="img.png,0,2147483647,2147483647,1,2,0,0"/><Z><S/><D/><O/></Z></C>`);
  assert.equal(map.settings.images.disappearing[0].rect.right, -2147483648);
  assert.equal(map.settings.images.disappearing[0].rect.bottom, -2147483647);
});


test("the joint Lua id is int of lua, and the raw lua value is kept", () => {
  const map = parseTfmMap(`<C><P/><Z><S/><D/><O/><L>
    <JD M1="0" M2="1" lua="12.9"/>
    <JR M1="0" M2="1"/>
    <JP M1="1" M2="2" lua="bad"/>
    <CUSTOM lua="7.8"/>
  </L></Z></C>`);
  assert.equal(map.joints[0].lua, "12.9");
  assert.equal(map.joints[0].clientLuaId, 12);
  assert.equal(map.joints[1].lua, null);
  assert.equal(map.joints[1].clientLuaId, 0);
  assert.equal(map.joints[2].lua, "bad");
  assert.equal(map.joints[2].clientLuaId, 0);
  assert.equal(map.joints[3].lua, "7.8");
  assert.equal(Object.hasOwn(map.joints[3], "clientLuaId"), false);
});

test("shaman-object packed P field 2 decodes to the editor-facing ghost flag", () => {
  const map = parseTfmMap(`<C><P/><Z><S/><D/><O>
    <O C="1" X="0" Y="0"/>
    <O C="1" X="0" Y="0" P="45"/>
    <O C="1" X="0" Y="0" P="45,1"/>
    <O C="1" X="0" Y="0" P="45,0"/>
  </O></Z></C>`);
  assert.deepEqual(map.objects.map((o) => o.ghost), [false, false, true, false]);
  assert.equal(Object.hasOwn(map.objects[0], "clientVudiq"), false);
  assert.equal(Object.hasOwn(map.objects[0], "mouseCollision"), false);
});

test("ground N is foreground and the ground fields use the documented conversions", () => {
  const map = parseTfmMap(`<C><P/><Z><S><S T="12" contact="12.9" lua="12.9" P="1,5,0.3,0.2,15,1,0.1,0.2" N=""/></S><D/><O/></Z></C>`);
  const ground = map.grounds[0];
  assert.equal(ground.foreground, true);
  assert.equal(ground.contact, 12);
  assert.equal(ground.lua, 12.9);
  assert.equal(ground.luaRaw, "12.9");
  assert.equal(ground.physics.mass, 5);
  assert.equal(ground.physics.friction, 0.3, "packed P field 3 (friction, default 0.3)");
  assert.equal(ground.physics.restitution, 0.2, "packed P field 4 (restitution, default 0.2)");
});

test("night payload decoding follows the client's exact one/two-field branches", () => {
  const one = parseTfmMap(`<C><P N="250"/><Z><S/><D/><O/></Z></C>`).settings.night;
  assert.deepEqual(one, { raw: "250", diameter: 250, type: null });

  const two = parseTfmMap(`<C><P N="250,1.5"/><Z><S/><D/><O/></Z></C>`).settings.night;
  assert.deepEqual(two, { raw: "250,1.5", diameter: 250, type: 1.5 });

  const extra = parseTfmMap(`<C><P N="250,1,ignored"/><Z><S/><D/><O/></Z></C>`).settings.night;
  assert.deepEqual(extra, { raw: "250,1,ignored", diameter: null, type: null });

  const empty = parseTfmMap(`<C><P N=""/><Z><S/><D/><O/></Z></C>`).settings.night;
  assert.deepEqual(empty, { raw: "", diameter: null, type: null });
});
