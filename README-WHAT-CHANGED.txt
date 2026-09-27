Auto-switch-network fix -- 3 files changed
===========================================

What this does:
On a coin's detail screen (opened from Prices, or from a token row), if the
coin can't be swapped because you're on the wrong network -- but it's
actually some OTHER network's own native coin (e.g. you're viewing BNB while
on Base, or POL while on Ethereum Mainnet) -- instead of just a dead-end
note, you now get a "Switch to <network>" button. Tapping it switches your
active network right there and re-checks swap availability automatically.

If the coin genuinely isn't available anywhere (not a native coin, not one
you've tracked), it still falls back to the existing note + the always-on
Buy button, same as before.

Files changed (upload just these 3, overwriting the ones on the site):
  - app.js       (the new switch-network logic + button wiring)
  - index.html   (adds the new "Switch to <network>" button to the coin screen)
  - en.js        (2 new text strings for the note and button label)

Tested live on tokenswaphub.org before packaging: viewed BNB while on Base,
got the "Switch to BNB Smart Chain" button, tapped it, network switched and
Swap enabled automatically.
