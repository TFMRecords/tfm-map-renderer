// `jointAngles`: grounds turned by a prismatic joint (JP A) are drawn at that angle (docs/xml/joints.md#joint-angles).
import test from "node:test";
import assert from "node:assert/strict";
import { parseTfmMap, renderTfmSvg } from "../src/index.js";

const STATIC = '<S T="0" X="400" Y="380" L="800" H="40" P="0,0,0.3,0.2,0,0,0,0"/>';
// P: dynamic, mass, friction, restitution, rotation, fixed rotation, damping x2.
const ground = (rotation, { dynamic = 1, fixed = 0 } = {}) => `<S T="1" X="200" Y="200" L="100" H="20" P="${dynamic},10,0.3,0.2,${rotation},${fixed},0,0"/>`;
const map = (grounds, joints) => parseTfmMap(`<C><P/><Z><S>${grounds.join("")}</S><D/><O/><L>${joints}</L></Z></C>`);
const A = Math.PI / 3; // 60 degrees
const booster = (m1, m2, extra = "") => `<JP M1="${m1}" M2="${m2}" AXIS="-1,0" A="${A}" MV="Infinity,5"${extra}/><JP M1="${m1}" M2="${m2}" AXIS="0,1" A="${A}"${extra}/>`;

/** The rotation the ground at (200, 200) is drawn with, in degrees. */
function drawnRotation(m, options = {}) {
  const match = /translate\(200 200\)(?: rotate\(([-\d.e]+)\))?/.exec(renderTfmSvg(m, options));
  assert.ok(match, "the ground is drawn");
  return Number(match[1] ?? 0);
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);

test("a Miceditor booster is drawn at its final angle, -A from a static ground; jointAngles: false keeps the XML rotation", () => {
  const m = map([STATIC, ground(30)], booster(1, 0));
  close(drawnRotation(m), -60);
  close(drawnRotation(m, { jointAngles: false }), 30);
});

test("without A the angle is 0: the turning ground is lined up with the other (the client reads a missing A as 0)", () => {
  close(drawnRotation(map([STATIC, ground(30)], `<JP M1="1" M2="0" AXIS="0,1"/>`)), 0);
});

test("the turning ground follows the other's rotation: M1 to M2 minus A, M2 to M1 plus A", () => {
  const tilted = STATIC.replace('P="0,0,0.3,0.2,0,', 'P="0,0,0.3,0.2,10,');
  close(drawnRotation(map([tilted, ground(30)], booster(1, 0))), 10 - 60);
  close(drawnRotation(map([tilted, ground(30)], booster(0, 1))), 10 + 60);
});

test("grounds that cannot turn, or that both can, and Lua joints stay as in the XML", () => {
  close(drawnRotation(map([STATIC, ground(30, { fixed: 1 })], booster(1, 0))), 30);
  close(drawnRotation(map([STATIC, ground(30, { dynamic: 0 })], booster(1, 0))), 30);
  const dynamicFloor = STATIC.replace('P="0,', 'P="1,');
  close(drawnRotation(map([dynamicFloor, ground(30)], booster(1, 0))), 30);
  close(drawnRotation(map([STATIC, ground(30)], booster(1, 0, ' lua="3"'))), 30);
});

test("mirrored, the turned ground is mirrored like the rest", () => {
  const m = map([STATIC, ground(30)], booster(1, 0));
  const svg = renderTfmSvg(m, { mirrorX: true });
  assert.match(svg, /translate\(200 200\) rotate\(-59\.9+\d*\) scale\(-1 1\)|translate\(200 200\) rotate\(-60\) scale\(-1 1\)/);
});
