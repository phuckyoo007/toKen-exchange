# Currency stablecoin-link fix

`prices.js` replaces the file of the same name at the root of the `toKen-exchange`
GitHub repo.

## What was wrong

Earlier today I added GBP -> GBPT, JPY -> JPYC, BRL -> BRZ, and MXN -> MXNT to the
"tap a currency, see its closest stablecoin" feature on the Prices > Currencies
tab. When we tested it live just now:

- JPY -> JPYC: correct, works.
- BRL -> BRZ: the *coin* was right but the CoinGecko id I used
  ("brazilian-digital-token") was wrong -- fixed to the real id, "brz".
- GBP -> GBPT and MXN -> MXNT: neither "GBPT"/"poundtoken" nor "MXNT" could be
  found on CoinGecko at all when checked directly against their live API and
  search endpoint, even by name. Rather than link to a dead page, I removed
  both -- GBP and MXN rows now just aren't clickable, same as every other
  currency without a confident stablecoin match.

## Double click "Upload to GitHub.url"

That opens the repo's upload page directly. Drag `prices.js` in, commit to
`main`, and Railway will redeploy automatically like always.
