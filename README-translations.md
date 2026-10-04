# Translated app name + remaining translations (website and extension)

## The title now follows the chosen language
New string `app.name` in all 9 language files:
English Token Exchange | Spanish Intercambio de Tokens | French Échange de Tokens |
Portuguese Troca de Tokens | Russian Обмен токенов | Chinese 代币交易所 |
Japanese トークン取引所 | Arabic تبادل الرموز | Hindi टोकन एक्सचेंज
Used for: browser tab title, home-screen name (apple-mobile-web-app-title), the TOKEN EXCHANGE
splash banner and the extension header logo (uppercased by the language's own rules and
squeezed to fit if long), image alt text / screen-reader label, and the "© 2026" footer line.
How: i18n.js applyI18n() understands data-i18n-upper, data-i18n-alt, data-i18n-aria and sets
document.title. The big medallion/splash artwork is a picture and stays as drawn.

## Extension name in Chrome itself
manifest.json now uses __MSG_appName__ / __MSG_appShortName__ / __MSG_appDescription__ with
default_locale "en". New root files locale-<lang>.json become _locales/<code>/messages.json
in the built extension (build-extension.js; Chrome codes: pt_BR, zh_CN). Chrome picks these by
the BROWSER language (chrome://extensions, Chrome Web Store); the in-wallet language picker
controls everything inside the wallet.

## Translated
- Scan wallet: button, screen title, intro paragraph, Add all / Scan again and the status
  messages (new keys scan.*; token-scan-ui.js now reads them).
- The 4 price-impact strings (previously English text in the 8 other languages).

## Checks run
All 9 language files have identical keys and identical {placeholders}; every data-i18n key
used by index.html and popup.html exists in en.js; applyI18n run against a fake page for
every language; extension build produces all 9 _locales folders.
Not run: in a real browser, and the repo's own test files (their tests folder isn't in the zip).

## Not changed
- The sentences inside Help/FAQ and other body text still say "Token Exchange" as the brand.
- Sign-in / backup screens in index.html (lines ~96-99, ~685) are English-only in the page itself.
- AI-written translations: have a native speaker check them, especially for Arabic and Hindi.
