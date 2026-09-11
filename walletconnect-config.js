// lib/walletconnect-config.js
// WalletConnect (now "Reown") requires every app -- wallets included -- to
// register a free Project ID so their relay server knows who's connecting.
// This is just an app identifier, not a secret key: it's fine for it to sit
// in the extension's source like this. Nothing you type, sign, or hold in
// this wallet is ever sent to WalletConnect/Reown beyond the bare JSON-RPC
// requests a connected dapp itself asks you to approve.
//
// 1. Sign up (free) at https://cloud.reown.com (formerly cloud.walletconnect.com).
// 2. Create a project, copy its "Project ID".
// 3. Paste it below between the quotes.
// 4. Optionally also update WC_METADATA.url/icons to point at wherever this
//    wallet is actually listed/hosted -- dapps show this to their users on
//    the connection-approval screen.
//
// Until a Project ID is set, the WalletConnect screen in Settings will show
// a clear "not configured yet" message instead of a confusing relay error.
const WC_PROJECT_ID = "";

const WC_METADATA = {
  name: "Token Exchange",
  description: "Self-custody multi-chain wallet with a built-in token swap.",
  url: "https://github.com/",
  icons: [],
};

if (typeof self !== "undefined") {
  self.TM_WC_CONFIG = { PROJECT_ID: WC_PROJECT_ID, METADATA: WC_METADATA };
}
