# Restored: Buy/Sell open Transak in-app again (not a new tab)

## What happened
This feature was already built once (see your repo's own `README-transak-embed.md`)
but was missing from the snapshot you sent me: `app.js` had a comment saying
"nothing is embedded in an iframe here anymore" and both Buy and Sell were
back to `window.open(url, "_blank")`. `en.js` still had the correct
"opens right here in the app" wording, so only the HTML/CSS/JS plumbing had
been lost — most likely a later single-file upload (e.g. the approve/gas-fee
fix) was built from an older copy and silently overwrote this.

## What's in this zip
- `index.html`
- `app.css`
- `app.js`

Replace these three files in the repo root with the ones here. Nothing else
needs to change — `transak-widget-api.js`, `en.js`, and the CSP's
`frame-src https://*.transak.com ...` entry were already correct.

## What it does now
- Buy and Sell each have an intro view and a widget view. Tapping "Continue
  to Transak" fetches the same single-use widget URL as before and loads it
  into an `<iframe>` right in the screen, instead of opening a new tab.
- The iframe carries `allow="camera;microphone;payment"` (Transak's docs say
  this is required for KYC camera capture and card/bank payment to work
  inside a frame).
- Closing — the widget's own "← Close" link, or the screen's "Back" button —
  sets the iframe back to `about:blank` and returns to the intro view. That
  fully unloads whatever Transak had running (releasing the camera mid-KYC)
  so reopening Buy or Sell never shows a stale or expired widget.
- Scope is unchanged from the original: this is `index.html`/`app.js` only.
  The extension's small toolbar popup (`popup.html`/`popup.js`) still opens
  Transak in a new tab on purpose — Transak's own docs flag the KYC camera
  step as unreliable in a popup that can lose focus and auto-close.

## Verified before delivery
- `node --check app.js` passes; `index.html`'s `#buy-intro`/`#buy-widget` and
  `#sell-intro`/`#sell-widget` pairs are well-formed.
- Booted the real `server.js` and confirmed `/`, `/app.js`, `/app.css` all
  still serve.
- Full headless-browser click-through (real Chromium, your real `app.js`,
  with only the network call to `/api/transak-session` and the fake Transak
  page mocked): clicked "Continue to Transak" on Buy, confirmed the iframe's
  `src` was set and its content actually loaded; clicked the "← Close" link,
  confirmed it reset to the intro view and `about:blank`; reopened, then
  used the screen's own "Back" button, confirmed that also resets. Repeated
  the open/content-loads/close check for Sell independently — same result.
  Along the way this also confirmed your CSP's `frame-src` allowlist is
  doing its job: a fake non-Transak domain was correctly blocked from
  loading in the iframe.

## Noticed in passing, not fixed here (separate from what you asked for)
`package.json`'s test script is `node --test tests/*.test.js`, but this
snapshot has `*.test.js` and `load-libs.js` sitting flat in the repo root
with no `tests/` folder — so `npm test` currently matches zero files instead
of running your suite (and depending on the npm version, that can exit 0,
i.e. CI shows green while testing nothing). Say the word if you'd like me to
put those back in a `tests/` folder.
