// Tests for the small server-side modules: client-ip.js, cors.js, security-headers.js.
// They read environment variables when first loaded, so each case loads a fresh copy.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { ROOT } = require("./helpers/load-libs");

function fresh(file, env = {}) {
  const keys = ["TRUST_PROXY_HOPS", "ALLOWED_ORIGINS", "CSP_REPORT_ONLY"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  const full = path.join(ROOT, file);
  delete require.cache[require.resolve(full)];
  const mod = require(full);
  for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  return mod;
}

const req = (headers = {}, remote = "10.0.0.9") => ({ headers, socket: { remoteAddress: remote } });
const fakeRes = () => { const h = {}; return { h, setHeader: (k, v) => { h[k] = v; } }; };

// ---------------------------------------------------------------- client-ip
test("client-ip: a forged first X-Forwarded-For entry is ignored (Railway = 1 proxy)", () => {
  const { clientIp } = fresh("client-ip.js");
  // attacker sends "1.1.1.1"; the proxy appends the real address it saw
  assert.equal(clientIp(req({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" })), "203.0.113.7");
});

test("client-ip: rotating the forged value does not change the identity used for rate limiting", () => {
  const { clientIp } = fresh("client-ip.js");
  const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add(clientIp(req({ "x-forwarded-for": `9.9.9.${i}, 203.0.113.7` })));
  assert.deepEqual([...seen], ["203.0.113.7"]);
});

test("client-ip: no header falls back to the socket address", () => {
  const { clientIp } = fresh("client-ip.js");
  assert.equal(clientIp(req({}, "198.51.100.4")), "198.51.100.4");
});

test("client-ip: single entry with one trusted proxy is used as-is", () => {
  const { clientIp } = fresh("client-ip.js");
  assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
});

test("client-ip: TRUST_PROXY_HOPS=0 ignores the header entirely", () => {
  const { clientIp } = fresh("client-ip.js", { TRUST_PROXY_HOPS: "0" });
  assert.equal(clientIp(req({ "x-forwarded-for": "1.1.1.1" }, "198.51.100.4")), "198.51.100.4");
});

test("client-ip: TRUST_PROXY_HOPS=2 skips two proxies from the right", () => {
  const { clientIp } = fresh("client-ip.js", { TRUST_PROXY_HOPS: "2" });
  assert.equal(clientIp(req({ "x-forwarded-for": "evil, 203.0.113.7, 10.1.1.1" })), "203.0.113.7");
});

test("client-ip: fewer entries than trusted hops falls back to the socket", () => {
  const { clientIp } = fresh("client-ip.js", { TRUST_PROXY_HOPS: "2" });
  assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.7" }, "198.51.100.4")), "198.51.100.4");
});

test("client-ip: junk or empty TRUST_PROXY_HOPS uses the default of 1", () => {
  assert.equal(fresh("client-ip.js", { TRUST_PROXY_HOPS: "abc" }).TRUST_PROXY_HOPS, 1);
  assert.equal(fresh("client-ip.js", { TRUST_PROXY_HOPS: "" }).TRUST_PROXY_HOPS, 1);
});

test("client-ip: no socket and no header gives \"unknown\" rather than throwing", () => {
  const { clientIp } = fresh("client-ip.js");
  assert.equal(clientIp({ headers: {} }), "unknown");
});

// ---------------------------------------------------------------- cors
test("cors: the website and the published extension are allowed", () => {
  const { applyCors } = fresh("cors.js");
  for (const origin of ["https://www.tokenswaphub.org", "https://tokenswaphub.org", "chrome-extension://adiihfpfinmhikjiopobbeigcfaoepko"]) {
    const res = fakeRes();
    applyCors(req({ origin }), res);
    assert.equal(res.h["Access-Control-Allow-Origin"], origin);
  }
});

test("cors: other sites, look-alikes and http:// downgrades get no CORS header", () => {
  const { applyCors } = fresh("cors.js");
  for (const origin of ["https://evil.example", "https://tokenswaphub.org.evil.example", "http://www.tokenswaphub.org", "chrome-extension://someotherextensionid", "null"]) {
    const res = fakeRes();
    applyCors(req({ origin }), res);
    assert.equal(res.h["Access-Control-Allow-Origin"], undefined, origin);
  }
});

test("cors: never answers with a wildcard, and always sets Vary: Origin", () => {
  const { applyCors } = fresh("cors.js");
  const noOrigin = fakeRes();
  applyCors(req({}), noOrigin);
  assert.equal(noOrigin.h["Access-Control-Allow-Origin"], undefined);
  assert.equal(noOrigin.h["Vary"], "Origin");
  const good = fakeRes();
  applyCors(req({ origin: "https://tokenswaphub.org" }), good);
  assert.notEqual(good.h["Access-Control-Allow-Origin"], "*");
});

test("cors: ALLOWED_ORIGINS adds extras without code changes", () => {
  const { applyCors } = fresh("cors.js", { ALLOWED_ORIGINS: "http://localhost:3000, chrome-extension://devid " });
  for (const origin of ["http://localhost:3000", "chrome-extension://devid"]) {
    const res = fakeRes();
    applyCors(req({ origin }), res);
    assert.equal(res.h["Access-Control-Allow-Origin"], origin);
  }
});

// ---------------------------------------------------------------- security headers
test("security headers: framing is forbidden and scripts are limited to our own files", () => {
  const { applySecurityHeaders, CSP_DIRECTIVES } = fresh("security-headers.js");
  const res = fakeRes();
  applySecurityHeaders(req(), res);
  assert.equal(res.h["Content-Security-Policy"], CSP_DIRECTIVES);
  assert.match(CSP_DIRECTIVES, /frame-ancestors \x27none\x27/);
  assert.equal(res.h["X-Frame-Options"], "DENY");
  assert.equal(res.h["X-Content-Type-Options"], "nosniff");
  const scriptSrc = CSP_DIRECTIVES.split("; ").find((d) => d.startsWith("script-src"));
  assert.equal(scriptSrc, "script-src \x27self\x27"); // no inline, no eval, no other hosts
  assert.match(CSP_DIRECTIVES, /object-src \x27none\x27/);
});

test("security headers: HSTS only when the request came in over https", () => {
  const { applySecurityHeaders } = fresh("security-headers.js");
  const plain = fakeRes();
  applySecurityHeaders(req(), plain);
  assert.equal(plain.h["Strict-Transport-Security"], undefined);
  const viaProxy = fakeRes();
  applySecurityHeaders(req({ "x-forwarded-proto": "https" }), viaProxy);
  assert.match(viaProxy.h["Strict-Transport-Security"], /max-age=\d+/);
  assert.ok(!/includeSubDomains|preload/.test(viaProxy.h["Strict-Transport-Security"]));
});

test("security headers: CSP_REPORT_ONLY=1 switches to report-only mode", () => {
  const { applySecurityHeaders } = fresh("security-headers.js", { CSP_REPORT_ONLY: "1" });
  const res = fakeRes();
  applySecurityHeaders(req(), res);
  assert.ok(res.h["Content-Security-Policy-Report-Only"]);
  assert.equal(res.h["Content-Security-Policy"], undefined);
});
