// admin-api.js is exercised end-to-end here against a real (temp-dir) auth-api
// user store, by calling handleAdminApi() with fake req/res objects -- no
// actual HTTP server needed. Each test gets a clean ADMIN_TOKEN and DATA_DIR.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { ROOT } = require("./helpers/load-libs");

function freshAdmin(token) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-admin-test-"));
  const keys = ["ADMIN_TOKEN", "DATA_DIR", "NODE_ENV"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.ADMIN_TOKEN = token;
  process.env.DATA_DIR = dataDir;
  delete process.env.NODE_ENV; // auth-api only refuses to boot without DATA_DIR in production
  for (const f of ["./admin-api", "./auth-api", "./client-ip"]) {
    delete require.cache[require.resolve(path.join(ROOT, f))];
  }
  const { handleAdminApi } = require(path.join(ROOT, "admin-api"));
  const authApi = require(path.join(ROOT, "auth-api"));
  for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  return { handleAdminApi, authApi, dataDir };
}

function fakeReq(method, url, { auth, body, ip = "203.0.113.5" } = {}) {
  const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
  return {
    method,
    url,
    headers: Object.assign({}, auth ? { authorization: "Bearer " + auth } : {}),
    socket: { remoteAddress: ip },
    on(event, cb) {
      if (event === "data") chunks.forEach((c) => cb(c));
      if (event === "end") cb();
      return this;
    },
  };
}

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: "", headersSent: false };
  res.writeHead = (status, headers) => { res.statusCode = status; Object.assign(res.headers, headers || {}); res.headersSent = true; };
  res.end = (body) => { res.body = body || ""; };
  res.json = () => JSON.parse(res.body || "null");
  return res;
}

test("with no ADMIN_TOKEN set, every /api/admin/* route answers 503", () => {
  const { handleAdminApi } = freshAdmin("");
  const res = fakeRes();
  assert.equal(handleAdminApi(fakeReq("GET", "/api/admin/stats"), res), true);
  assert.equal(res.statusCode, 503);
});

test("a request with no token is refused with 401", () => {
  const { handleAdminApi } = freshAdmin("s3cret-token");
  const res = fakeRes();
  handleAdminApi(fakeReq("GET", "/api/admin/stats"), res);
  assert.equal(res.statusCode, 401);
});

test("a wrong token is refused with 401", () => {
  const { handleAdminApi } = freshAdmin("s3cret-token");
  const res = fakeRes();
  handleAdminApi(fakeReq("GET", "/api/admin/stats", { auth: "wrong" }), res);
  assert.equal(res.statusCode, 401);
});

test("the correct token lists users (starts empty) with no vault/bundle data", async () => {
  const { handleAdminApi } = freshAdmin("s3cret-token");
  const res = fakeRes();
  handleAdminApi(fakeReq("GET", "/api/admin/stats", { auth: "s3cret-token" }), res);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(res.statusCode, 200);
  const data = res.json();
  assert.deepEqual(data.users, []);
  assert.equal(data.totalUsers, 0);
});

test("20 wrong-token attempts from one IP trip the 429 throttle; a different IP is unaffected", () => {
  const { handleAdminApi } = freshAdmin("s3cret-token");
  for (let i = 0; i < 20; i++) {
    handleAdminApi(fakeReq("GET", "/api/admin/stats", { auth: "wrong", ip: "198.51.100.1" }), fakeRes());
  }
  const blocked = fakeRes();
  handleAdminApi(fakeReq("GET", "/api/admin/stats", { auth: "wrong", ip: "198.51.100.1" }), blocked);
  assert.equal(blocked.statusCode, 429);

  const otherIp = fakeRes();
  handleAdminApi(fakeReq("GET", "/api/admin/stats", { auth: "s3cret-token", ip: "198.51.100.99" }), otherIp);
  assert.equal(otherIp.statusCode, 200);
});

test("the throttle keys on the real client IP, not Railway's proxy address (client-ip.js)", () => {
  const { handleAdminApi } = freshAdmin("s3cret-token");
  const req1 = fakeReq("GET", "/api/admin/stats", { auth: "wrong", ip: "proxy-addr" });
  req1.headers["x-forwarded-for"] = "1.1.1.1, 198.51.100.50";
  for (let i = 0; i < 20; i++) handleAdminApi(req1, fakeRes());

  // Same proxy address, but a different real client behind it -- must NOT be blocked.
  const req2 = fakeReq("GET", "/api/admin/stats", { auth: "s3cret-token", ip: "proxy-addr" });
  req2.headers["x-forwarded-for"] = "1.1.1.1, 198.51.100.77";
  const res2 = fakeRes();
  handleAdminApi(req2, res2);
  assert.equal(res2.statusCode, 200);
});

test("routes are wired into server.js and admin.html/admin.js are served", () => {
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert.match(server, /handleAdminApi/);
  assert.match(server, /"admin\.html"/);
  assert.match(server, /"admin\.js"/);
});

test("admin.html loads its script from an external file, not inline (CSP has no unsafe-inline)", () => {
  const html = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
  assert.doesNotMatch(html, /<script>\s*\S/, "admin.html must not have inline script content under this site's CSP");
  assert.match(html, /<script src="admin\.js"><\/script>/);
});
