import test from "node:test";
import assert from "node:assert/strict";
import { resolveClientImageUrl, OFFICIAL_BASES, isOfficialHost } from "../src/assets/image-urls.js";
import { ATELIER801_BARE_IMAGE_RE as BARE_FILENAME } from "../src/assets/url-policy.js";

test("the bare-name pattern matches only bare alphanumeric name.ext, case-insensitively, statelessly", () => {
  for (const ok of ["a.png", "ABC123.JPG", "x9.gif"]) assert.ok(BARE_FILENAME.test(ok), ok);
  for (const bad of ["a_b.png", "dir/a.png", "a.png ", "a.p1", ".png", "a", "a.b.c", "a-b.png", "a.png\n"]) {
    assert.equal(BARE_FILENAME.test(bad), false, JSON.stringify(bad));
  }
  // `g`-less regex: repeated calls must not alternate (no lastIndex leak)
  assert.equal(BARE_FILENAME.test("a.png"), true);
  assert.equal(BARE_FILENAME.test("a.png"), true);
});

test("D, d and IP use the default base on transformice.com", () => {
  for (const source of ["D", "d", "IP"]) {
    const r = resolveClientImageUrl(source, "bg/sky.png");
    assert.equal(r.ok, true);
    assert.equal(r.url, "http://www.transformice.com/images/bg/sky.png");
    assert.equal(r.host, "www.transformice.com");
    assert.equal(r.provenance, "game");
  }
});

test("D, d and IP append the ?c= cache suffix only to the client request, not the canonical key", () => {
  const r = resolveClientImageUrl("D", "a.png", { cacheId: 1234 });
  assert.equal(r.clientUrl, "http://www.transformice.com/images/a.png?c=1234");
  assert.equal(r.cacheKey, "http://www.transformice.com/images/a.png");
});

test("APS/ARPS: bare filename -> atelier801, otherwise transformice default base, no cache suffix", () => {
  const bare = resolveClientImageUrl("APS", "hero1.png", { cacheId: 9 });
  assert.equal(bare.url, "http://images.atelier801.com/hero1.png");
  assert.equal(bare.clientUrl, bare.url);
  assert.equal(bare.rule, "bare-name");
  const nested = resolveClientImageUrl("ARPS", "x/hero1.png");
  assert.equal(nested.url, "http://www.transformice.com/images/x/hero1.png");
  assert.equal(nested.rule, "default-base");
  const underscore = resolveClientImageUrl("ARPS", "hero_1.png");
  assert.equal(underscore.host, "www.transformice.com");
});

test("ground i uses the bare-name rule and the default base otherwise", () => {
  const bare = resolveClientImageUrl("ground-i", "tex.png");
  assert.equal(bare.url, "http://images.atelier801.com/tex.png");
  assert.equal(bare.provenance, "game");
  assert.equal(resolveClientImageUrl("ground-i", "a/tex.png").host, "www.transformice.com");
  assert.equal(resolveClientImageUrl("ground-i", "a/tex.png").rule, "ground-image-default-base");
});

test("particle img uses the default base with no cache suffix", () => {
  const r = resolveClientImageUrl("particle", "spark.png", { cacheId: 5 });
  assert.equal(r.url, "http://www.transformice.com/images/spark.png");
  assert.equal(r.clientUrl, r.url);
  assert.equal(resolveClientImageUrl("particle", "http://x.test/a.png", { unofficialDomains: true }).reason, "absolute-url-unsupported-by-client");
});

test("tiled D loads absolute URLs and uses the default base otherwise", () => {
  assert.equal(resolveClientImageUrl("D-tiled", "bg.png", { cacheId: 7 }).url, "http://www.transformice.com/images/bg.png");
  assert.equal(resolveClientImageUrl("D-tiled", "bg.png", { cacheId: 7 }).clientUrl, "http://www.transformice.com/images/bg.png");
  assert.equal(resolveClientImageUrl("D-tiled", "https://cdn.example/t.png").reason, "absolute-url-blocked-by-policy");
  const ok = resolveClientImageUrl("D-tiled", "https://cdn.example/t.png", { unofficialDomains: true, moduleMode: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.rule, "tiled-absolute");
});

test("ground i loads absolute URLs only outside #Module maps (tiled D is the other source that can)", () => {
  const url = "https://cdn.example/x.png";
  assert.equal(resolveClientImageUrl("ground-i", url).reason, "absolute-url-blocked-by-policy");
  const ok = resolveClientImageUrl("ground-i", url, { unofficialDomains: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.rule, "ground-image-absolute");
  assert.equal(ok.provenance, "game");
  assert.equal(resolveClientImageUrl("ground-i", url, { unofficialDomains: true, moduleMode: true }).reason, "absolute-url-unsupported-by-client");
});

test("absolute URLs cannot load in the client (dead :// branch) and are rejected by default", () => {
  for (const source of ["D", "d", "IP", "APS", "ARPS", "particle"]) {
    const r = resolveClientImageUrl(source, "http://evil.example/x.png");
    assert.deepEqual(r, { ok: false, reason: "absolute-url-unsupported-by-client", source });
  }
});

test("unofficial domains need the explicit flag even where the client allows them; other schemes are refused", () => {
  const r = resolveClientImageUrl("ground-i", "https://cdn.example/x.png", { unofficialDomains: true });
  assert.equal(r.ok, true);
  assert.equal(r.host, "cdn.example");
  assert.equal(isOfficialHost(r.host), false);
  assert.equal(resolveClientImageUrl("ground-i", "ftp://x/y", { unofficialDomains: true }).reason, "unsupported-scheme");
  assert.equal(resolveClientImageUrl("ground-i", "javascript://x", { unofficialDomains: true }).reason, "unsupported-scheme");
  assert.equal(resolveClientImageUrl("D", "https://cdn.example/x.png", { unofficialDomains: true }).reason, "absolute-url-unsupported-by-client");
});

test("path traversal, control characters, empties and unknown sources are rejected", () => {
  assert.equal(resolveClientImageUrl("D", "../secret.png").reason, "path-traversal");
  assert.equal(resolveClientImageUrl("D", "a/../b.png").reason, "path-traversal");
  assert.equal(resolveClientImageUrl("D", "a\\b.png").reason, "invalid-character");
  assert.equal(resolveClientImageUrl("D", "a\u0000.png").reason, "invalid-character");
  assert.equal(resolveClientImageUrl("D", "").reason, "empty");
  assert.equal(resolveClientImageUrl("D", undefined).reason, "empty");
  assert.equal(resolveClientImageUrl("X", "a.png").reason, "unknown-source");
  assert.equal(resolveClientImageUrl("D", "a".repeat(3000)).reason, "too-long");
});

test("scheme option upgrades official bases without changing hosts", () => {
  const r = resolveClientImageUrl("APS", "a.png", { scheme: "https" });
  assert.equal(r.url, "https://images.atelier801.com/a.png");
  assert.equal(OFFICIAL_BASES.atelier801.startsWith("http://"), true);
});
