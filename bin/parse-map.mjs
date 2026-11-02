#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseTfmMap } from "../src/index.js";

const args = process.argv.slice(2);
const modeArg = args.find((arg) => arg.startsWith("--structure="));
const structureMode = modeArg ? modeArg.slice("--structure=".length) : "client";
const file = args.find((arg) => !arg.startsWith("--"));

if (!file) {
  console.error("Usage: node bin/parse-map.mjs <map.xml> [--structure=client|named|hybrid]");
  process.exitCode = 2;
} else {
  const xml = await readFile(file, "utf8");
  const map = parseTfmMap(xml, { structureMode });
  const json = JSON.stringify(map, (_key, value) => {
    if (typeof value !== "number" || Number.isFinite(value)) return value;
    if (Number.isNaN(value)) return "NaN";
    return value > 0 ? "Infinity" : "-Infinity";
  }, 2);
  process.stdout.write(json + "\n");
}
