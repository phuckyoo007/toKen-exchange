// read-body.js
// One request-body reader for every server-side API module (server only; it is
// not shipped to the browser or the extension).
//
// Before: five copies of "collect chunks until 'end'", with different size
// caps, some counting characters instead of bytes, and some that destroyed the
// socket on overflow without ever answering (the client just saw a dropped
// connection). Now they all share this:
//
//   readBody(req, maxBytes)  -> Promise<string>   raw UTF-8 text
//   readJson(req, opts)      -> Promise<object>   parsed JSON object
//
// Failures reject with an Error that carries `.status` (413 too large,
// 415 wrong Content-Type, 400 bad JSON), so a caller can answer with it.
// On overflow the helper stops buffering and rejects so the caller can send a
// 413; if the client keeps sending, the connection is cut after a short grace
// period so a slow sender cannot hold it open.

const DEFAULT_MAX_BODY_BYTES = 16 * 1024;
const OVERFLOW_GRACE_MS = 1000;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function readBody(req, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        chunks.length = 0;
        fail(httpError(413, "Request body too large."));
        const timer = setTimeout(() => { if (!req.complete) req.destroy(); }, OVERFLOW_GRACE_MS);
        if (timer.unref) timer.unref();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", () => fail(httpError(400, "Could not read the request.")));
    req.on("aborted", () => fail(httpError(400, "Request aborted.")));
  });
}

// opts: { maxBytes, requireJsonContentType (default false) }
// An empty body parses as {}. Anything that is not a plain JSON object
// (an array, a string, null) is rejected.
async function readJson(req, opts = {}) {
  const { maxBytes = DEFAULT_MAX_BODY_BYTES, requireJsonContentType = false } = opts;
  if (requireJsonContentType) {
    const ct = String(req.headers["content-type"] || "");
    if (!/^application\/json\b/i.test(ct)) throw httpError(415, "Content-Type must be application/json.");
  }
  const text = await readBody(req, maxBytes);
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (e) {
    throw httpError(400, "Invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw httpError(400, "Invalid JSON.");
  return parsed;
}

module.exports = { readBody, readJson, DEFAULT_MAX_BODY_BYTES };
