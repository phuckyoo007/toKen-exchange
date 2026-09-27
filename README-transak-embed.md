# Buy/Sell: Transak now opens in-app, not a new tab

## What changed

Buy and Sell used to hand off to Transak by opening `window.open(url, "_blank")` --
a brand-new browser tab. Tapping "Continue to Transak" now loads that exact
same widget URL into an `<iframe>` embedded right in the Buy/Sell screen
instead, so you never leave the app. This is the same pattern MetaMask's own
Buy flow uses.

Nothing about *what* Transak does changed -- it's still Transak handling the
actual payment and identity verification, on their servers, same as before.
The backend that builds the widget URL (`transak-widget-api.js` at the repo
root) didn't need any changes either: Transak's own iframe-integration docs
confirm the exact same single-use, 5-minute widget URL that was already being
opened in a new tab is meant to be dropped straight into an iframe's `src`.

## How it works now

Each Buy/Sell screen has two states, toggled with the existing `.hidden`
class:

- **Intro view** (`#buy-intro` / `#sell-intro`): the description text and the
  "Continue to Transak" button -- what you see first.
- **Widget view** (`#buy-widget` / `#sell-widget`): a "← Close" link plus the
  `<iframe>` that Transak's flow actually runs in.

Tapping "Continue to Transak" fetches a fresh widget URL (same as before --
still single-use, still expires in 5 minutes, still never cached) and swaps
from the intro view to the widget view. Tapping "← Close", or the screen's
own "Back" button, swaps back and sets the iframe's `src` to `about:blank` --
this fully unloads whatever Transak had running, including releasing the
camera/microphone if a KYC step was mid-flow. Leaving and re-opening Buy or
Sell through any other path (bottom nav, a coin's "Buy" shortcut, etc.)
always resets back to the intro view too, so you never land back on a stale
or expired widget.

The iframe carries `allow="camera;microphone;payment"`, which Transak's docs
say is needed for their KYC camera-capture and card/bank-payment steps to
work inside an iframe at all.

## Scope: website + app only, not the toolbar popup

This change is in `index.html` + `app.js` only -- the full-size app view used
by the website and, when opened as the extension, its expanded/full-tab
view. The Chrome extension's small toolbar popup (`popup.html` / `popup.js`,
which duplicate the Buy/Sell screens independently) were deliberately **not**
touched, and still open Transak in a new tab as before.

Reason: Transak's own iframe-integration docs specifically flag that the
KYC camera step doesn't work reliably inside a small popup window that can
lose focus and auto-close mid-flow -- which describes exactly how a Chrome
extension's toolbar popup behaves (Manifest V3 also restricts that popup's
ability to hold onto a camera permission). A bank-linking/payment flow also
just deserves more screen space than a ~360x600px popup can offer. So the
popup keeps the safer, already-working new-tab handoff, while the website
and full-page app view -- where this all works properly -- get the smoother
in-app experience.

## Files changed

- `index.html` -- wrapped each Buy/Sell screen's existing content in an
  `#buy-intro`/`#sell-intro` div, and added a sibling `#buy-widget`/
  `#sell-widget` div holding the close button + `<iframe>`. Back buttons on
  both screens got explicit ids (`btn-buy-back`/`btn-sell-back`) so the new
  JS can reset the widget when you back out.
- `app.js` -- `btn-buy-open`/`btn-sell-open` now set the iframe's `src` and
  toggle the intro/widget views instead of calling `window.open`. Added
  `resetBuyWidget()`/`resetSellWidget()`, wired to the new close buttons and
  the back buttons.
- `app.css` -- `.transak-widget` (layout for the close button + iframe) and
  `.transak-iframe` (sizing: full width, ~560px tall, capped at 70% of
  viewport height, white background since Transak's widget assumes a light
  host).
- `en.js` -- reworded `buy.description2`/`sell.description2` (no longer say
  "opens in a new tab"), added `buy.closeWidgetBtn`/`sell.closeWidgetBtn`
  ("← Close").

## Testing note

The browser bridge to your computer wasn't connected while building this, so
I verified the state machine (intro ↔ widget toggling, iframe src set on
open and cleared to `about:blank` on close, error handling leaving you on
the intro view rather than a broken widget view) with an isolated script
covering all five transitions, and confirmed `app.js`/`en.js` still parse
cleanly and `index.html`'s tags stay balanced. Worth a real click-through
once it's live: open Buy, confirm the widget loads inline instead of a new
tab opening, and confirm "← Close" and the screen's "Back" button both get
you back to a clean intro view (not stuck on a blank/expired iframe if you
reopen Buy again).
