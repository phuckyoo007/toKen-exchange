# What changed (Oct 3, 2026)

Drop these files into the repo (same paths). Then rebuild the extension and let Railway redeploy.

## 1. Big gold Back button restored (website + extension)
- Every Back/Cancel is the pinned gold pill with the dark arrow coin again (`.top-back-btn`).
- `index.html`: 26 buttons converted. `popup.html`: 19. Styles in `app.css` and `popup.css`.
- Inside the rotating cube (Activity / Send) it sticks to the top of the face instead of using fixed positioning.
- `sw.js`: cache bumped to v11 so phones pick up the new look.
- The README said this was restored once before, but the CSS and markup were gone from the repo again. A new test (`tests/networks-and-back.test.js`) now fails if a Back button reverts.

## 2. Swap on 3 more networks (now 9 of 15)
Added from official sources, never guessed:
- Avalanche: Uniswap V2 router 0x4752ba5D...aD24 (docs.uniswap.org v2 deployments)
- Linea: SushiSwap V2 router 0x2abf4690...25b1, WETH 0xe5D7C2a4...f34f
- Gnosis: SushiSwap V2 router 0x1b02dA8C...7506, WXDAI 0xe91D153E...a97d
Still OFF: Robinhood Chain, Monad, Scroll (sources disagree on its wrapped-ETH address), ZKsync Era, Mantle, Celo (Sushi's docs table lists a Scroll factory as the Celo router).
Sushi pools on Linea/Gnosis are thin, so the price-impact warning matters there.

## 3. Token picker
The full-page picker (back arrow, search, network chips, token rows, favourites) is already in this repo for both website and extension. The status PDF was out of date. Nothing to build.

## 4. Android: Back button and screen edges (needs a build)
The Android source was not in the repo, only the compiled app. `android/` is a rebuilt project with the same behaviour as 2.1 plus:
- Back works on Android 13-16 (OnBackInvokedCallback). It asks the web app first (`window.TMNativeBack` in `app.js`: closes the picker/sheet, or goes up one screen) and only sends the app to the background from a top-level screen.
- Edge-to-edge: padding for status bar, navigation bar, cutout and keyboard.
- Fixed port 47831 (never change it). No orientation lock. versionCode 12, versionName 2.1.
- `.github/workflows/android.yml` builds a signed .aab (Play) and a signed .apk (install on your phone).

### One-time GitHub setup
Repo > Settings > Secrets and variables > Actions > New repository secret:
- KEYSTORE_BASE64  (run `base64 -w0 your.keystore` and paste the output)
- KEYSTORE_PASSWORD, KEY_ALIAS (probably tokenexc; check with `keytool -list -keystore your.keystore`), KEY_PASSWORD
Then Actions > "Android build" > Run workflow > download the artifact.
Do not paste the keystore password into chat again.

## Tests
149 pass, 1 fails: "every image in the repo root is actually used" (stray screenshots in the repo root). It fails the same way on your untouched repo.
