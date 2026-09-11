const http = require("http");
const path = require("path");
const fs = require("fs");
const handler = require("serve-handler");

const PUBLIC_DIR = path.join(__dirname, "public");
const VENDOR_DIR = path.join(PUBLIC_DIR, "vendor");
const PORT = process.env.PORT || 3000;

function copyVendorFiles() {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });

  const ethersUmd = require.resolve("ethers/dist/ethers.umd.min.js");
  fs.copyFileSync(ethersUmd, path.join(VENDOR_DIR, "ethers.umd.min.js"));

  const wcMain = require.resolve("@walletconnect/sign-client");
  const wcUmd = path.join(path.dirname(wcMain), "index.umd.js");
  fs.copyFileSync(wcUmd, path.join(VENDOR_DIR, "walletconnect-sign-client.umd.js"));

  const qr = require.resolve("qrcode-generator");
  fs.copyFileSync(qr, path.join(VENDOR_DIR, "qrcode-generator.js"));

  console.log("Vendor files copied into", VENDOR_DIR);
}

function main() {
  copyVendorFiles();
  const server = http.createServer((req, res) =>
    handler(req, res, { public: PUBLIC_DIR })
  );
  server.listen(PORT, () => console.log("Serving on port " + PORT));
}

main();
