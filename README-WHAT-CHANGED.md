# Transak switch-over + polish -- what's in this folder

These 7 files replace the same-named files at the root of the `toKen-exchange`
GitHub repo. Upload them the same way you always have (Add files via upload,
drag these in, commit to `main`) -- Railway will redeploy automatically.

## Buy/Sell now use Transak instead of MoonPay

- `index.html`, `popup.html` -- Buy and Sell screens rewritten: description
  text + a single "Continue to Transak" button that opens Transak in a new
  tab (no more embedded iframe, no more "Coming soon" on Sell -- Sell is now
  live). Script tags switched from `buy-config.js`/`sell-config.js` to the
  already-existing `transak-config.js`.
- `app.js` (website), `popup.js` (extension) -- `setupBuyScreen`/
  `setupSellScreen` rewritten to call `TM_TRANSAK_CONFIG.buildTransakUrl(...)`
  and open the result with `window.open(..., "_blank")`. Also added the
  missing Sell wiring to `popup.js` (the extension's popup never had a
  working Sell button at all -- only Buy).
- `en.js` -- Buy/Sell copy updated from MoonPay wording to Transak wording;
  removed the now-unused "Sell coming soon" strings; the Support FAQ entry
  was reworded to cover both Buy and Sell isn't working.

Reminder: Transak still needs `TRANSAK_API_KEY` / `TRANSAK_API_SECRET` /
`TRANSAK_ENVIRONMENT` / `TRANSAK_REFERRER_DOMAIN` set as Railway environment
variables (set those yourself in the Railway dashboard -- never paste them
into chat or commit them to the repo). Until those are set, clicking
"Continue to Transak" shows a friendly "isn't set up yet" error instead of
opening anything -- it won't crash.

## Currency screen: no more dead-end taps

`prices.js` -- Prices > Currencies tab: tapping GBP, JPY, BRL, or MXN now
opens that currency's closest real stablecoin (GBPT, JPYC, BRZ, MXNT --
verified against CoinGecko's own coin pages), the same way USD -> USDT and
EUR -> EURC already worked. Currencies with no confident stablecoin match
(most of them) still just aren't clickable, on purpose -- guessing one would
be actively misleading.

## Small visual fixes

- `app.css` -- the "Send delay" and "Auto-lock" dropdowns in Settings were
  clipping their own selected text ("30 seconds (recomâ€¦"). They now get
  their own full-width row instead of squeezing next to the label.
- `index.html`, `popup.html` -- the Assets tab icon was a plain "&#9679;"
  dot; switched to the coin emoji used elsewhere in the app for
  assets/tokens.

## Tested locally (this repo cloned + run standalone, since I don't have
push/deploy access)

- Full walkthrough (splash -> create wallet -> home -> assets/activity/send
  -> swap -> Buy -> Sell -> settings -> support) at both desktop and mobile
  widths, dark mode: no console errors, no crashes.
- Buy and Sell both correctly show "Couldn't reach Transak" when Transak
  isn't configured/reachable, instead of throwing.
- Currency-peg links verified against real CoinGecko URLs (mocked the
  exchange-rate response locally since this sandbox can't reach CoinGecko,
  but the code path and URLs are the real ones).
- The Chrome extension's `popup.js` depends on `chrome.storage`/
  `chrome.runtime` APIs that only exist inside a real loaded extension, so it
  couldn't be driven end-to-end outside Chrome -- the Buy/Sell/Assets-icon
  changes there were verified by direct code review and syntax-checked
  instead. Worth one quick manual click-through after you load the updated
  extension, just to be safe.
