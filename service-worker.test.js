// Keeps sw.js's offline precache list in step with what the site really loads.
// If this fails, either add the file to PRECACHE_URLS in sw.js (and bump
// CACHE_NAME) or remove the stale entry.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./helpers/load-libs");

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function listFromServer(name) {
  const m = read("server.js").match(new RegExp("const " + name + " = (\\[[\\s\\S]*?\\]);"));
  assert.ok(m, "could not find " + name + " in server.js");
  return new Function("return " + m[1])();
}

const served = new Set(["/"]);
listFromServer("TOP_LEVEL_FILES").forEach((f) => served.add("/" + f));
listFromServer("LIB_FILES").forEach((f) => served.add("/lib/" + f));
listFromServer("I18N_FILES").forEach((f) => served.add("/lib/i18n/" + f));
listFromServer("FONT_FILES").forEach((f) => served.add("/fonts/" + f));
listFromServer("IMG_FILES").forEach((f) => served.add("/img/" + f));
["ethers.umd.min.js", "walletconnect-sign-client.umd.js", "qrcode-generator.js"].forEach((f) =>
  served.add("/vendor/" + f)
);

const sw = read("sw.js");
const listMatch = sw.match(/const PRECACHE_URLS = (\[[\s\S]*?\n\]);/);
assert.ok(listMatch, "could not find PRECACHE_URLS in sw.js");
const PRECACHE = new Set(new Function("return " + listMatch[1].replace(/\/\/.*$/gm, ""))());

const toPath = (ref) => "/" + ref.replace(/^\.?\//, "");

function refs(text, re) {
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const v = (m[1] || "").trim().replace(/^['"]|['"]$/g, "");
    if (!v || /^(https?:|data:|mailto:|tel:|#|blob:|\/\/)/i.test(v)) continue;
    out.push(toPath(v.split("#")[0].split("?")[0]));
  }
  return out;
}

test("every precached URL is actually served", () => {
  const bad = [...PRECACHE].filter((u) => !served.has(u));
  assert.deepEqual(bad, [], "sw.js precaches URLs the server does not serve: " + bad.join(", "));
});

test("every script, stylesheet and image index.html loads is precached", () => {
  const html = read("index.html");
  const all = [
    ...refs(html, /<script[^>]*\ssrc\s*=\s*"([^"]+)"/gi),
    ...refs(html, /<link[^>]*\shref\s*=\s*"([^"]+)"/gi),
    ...refs(html, /<img[^>]*\ssrc\s*=\s*"([^"]+)"/gi),
    ...refs(html, /<source[^>]*\ssrcset\s*=\s*"([^"]+)"/gi),
  ];
  const missing = [...new Set(all)].filter((u) => served.has(u) && !PRECACHE.has(u));
  assert.deepEqual(missing, [], "index.html loads files missing from sw.js PRECACHE_URLS: " + missing.join(", "));
});

test("every font and image app.css uses is precached", () => {
  const css = read("app.css");
  const all = refs(css, /url\(\s*([^)]+?)\s*\)/g);
  const missing = [...new Set(all)].filter((u) => served.has(u) && !PRECACHE.has(u));
  assert.deepEqual(missing, [], "app.css uses files missing from sw.js PRECACHE_URLS: " + missing.join(", "));
});

test("language flags used by the picker are precached", () => {
  const codes = listFromServer("I18N_FILES").map((f) => f.replace(".js", ""));
  const missing = codes.map((c) => "/img/flag-" + c + ".svg").filter((u) => !PRECACHE.has(u));
  assert.deepEqual(missing, []);
});
