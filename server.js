const http = require("http");
const path = require("path");
const fs = require("fs");
const extract = require("extract-zip");
const handler = require("serve-handler");

const ZIP_PATH = path.join(__dirname, "token-exchange-web-wallet.zip");
const SITE_DIR = path.join(__dirname, "site");
const PORT = process.env.PORT || 3000;

async function main() {
if (!fs.existsSync(SITE_DIR)) {
console.log("Unzipping site bundle...");
await extract(ZIP_PATH, { dir: SITE_DIR });
console.log("Done.");
}
const server = http.createServer((req, res) => handler(req, res, { public: SITE_DIR }));
server.listen(PORT, () => console.log("Serving on port " + PORT));
}

main().catch((e) => {
console.error(e);
process.exit(1);
});
