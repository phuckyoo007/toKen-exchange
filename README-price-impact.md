# Price-impact warning (swap screen, website + extension)

What it does: when you quote a swap through the router, the wallet also quotes a tiny
(1/1000-size) trade to see the pool's un-moved price, and shows how much worse your
trade's price is. 3%+ shows a yellow note, 10%+ a stronger note and asks "Swap anyway?"
before anything is sent. Aggregator (0x) quotes and dust amounts show nothing.

Not changed: the 0.5% app fee is still taken BEFORE the swap.

Files: swap.js (getPriceImpactBps), wallet-engine.js + background.js (quote returns
priceImpactBps), app.js + index.html (website), popup.js + popup.html (extension),
en/ar/es/fr/hi/ja/pt/ru/zh.js (4 new strings each).

Tested against a mock constant-product pool: 100,000 into a 100M pool = 0.10%; into a 1M
pool = 9.06% (textbook 9.09%); into a 150k pool = 39.9% (textbook 40%); dust = hidden.
Not run in a browser or on a phone. The 8 non-English files carry the English text for
the 4 new strings, so they need translating. The repo's tests folder wasn't in the zip,
so the test suite was not run.
