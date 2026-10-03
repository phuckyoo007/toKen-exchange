// Tests for read-body.js, the shared request-body reader used by every API module.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { ROOT } = require("./helpers/load-libs");
const { readBody, readJson } = require(path.join(ROOT, "read-body.js"));

// Starts a throwaway server that runs `fn(req)` and reports the outcome as JSON.
async function withServer(fn, send) {
  const server = http.createServer(async (req, res) => {
    let out;
    try { out = { ok: await fn(req) }; } catch (e) { out = { status: e.status, message: e.message }; }
    res.writeHead(out.status || 200, { "Content-Type": "application/json", Connection: "close" });
    res.end(JSON.stringify(out));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try { return await send(server.address().port); } finally { server.close(); }
}

function post(port, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, host: "127.0.0.1", method: "POST", headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("readBody returns the text, including multi-byte characters", async () => {
  const r = await withServer((req) => readBody(req, 1024), (p) => post(p, "héllo ✓"));
  assert.equal(r.body.ok, "héllo ✓");
});

test("readBody rejects an oversized body with 413 (counted in bytes, not characters)", async () => {
  // 600 characters of a 3-byte glyph = 1800 bytes, over a 1000-byte cap.
  const r = await withServer((req) => readBody(req, 1000), (p) => post(p, "✓".repeat(600)));
  assert.equal(r.status, 413);
});

test("readJson parses an object and treats an empty body as {}", async () => {
  const a = await withServer((req) => readJson(req), (p) => post(p, '{"a":1}'));
  assert.deepEqual(a.body.ok, { a: 1 });
  const b = await withServer((req) => readJson(req), (p) => post(p, ""));
  assert.deepEqual(b.body.ok, {});
});

test("readJson rejects bad JSON, arrays and null with 400", async () => {
  for (const bad of ["{nope", "[1,2]", "null", '"str"']) {
    const r = await withServer((req) => readJson(req), (p) => post(p, bad));
    assert.equal(r.status, 400, bad);
  }
});

test("readJson can require a JSON Content-Type (415 otherwise)", async () => {
  const opts = { requireJsonContentType: true };
  const bad = await withServer((req) => readJson(req, opts), (p) => post(p, "{}", { "Content-Type": "text/plain" }));
  assert.equal(bad.status, 415);
  const good = await withServer((req) => readJson(req, opts), (p) => post(p, "{}", { "Content-Type": "application/json; charset=utf-8" }));
  assert.deepEqual(good.body.ok, {});
});
