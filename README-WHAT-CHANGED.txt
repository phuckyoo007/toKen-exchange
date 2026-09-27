Network switcher redesign -- neon-sign dropdown -- 3 files changed
====================================================================

What this does:
Replaces the plain dropdown on the dashboard's "Network" row with the
LED-sign look you approved -- the same 6 glowing signs. Tapping it opens a
bottom sheet showing all your networks as neon signs, 2 per row --
Ethereum Mainnet, Base, Polygon, BNB, Arbitrum, Optimism, each in its own
brand color with its own icon. The current network gets a soft gold glow
ring around it. Tapping a different sign switches to it and closes the
sheet.

Base's icon got a second pass after the first version looked like a plain
circle at this smaller size: it's now a bigger white disc with a bolder
divider line and dot, inside a teal-to-blue gradient hexagon frame
(matching your reference image's color transition), so the detail actually
reads at a glance instead of blurring into a blob.

If you ever add a custom network (Settings > Add network, or a dapp
requesting one via WalletConnect), it still shows up in this list too --
it just gets a plain circle with its first letter in its own color instead
of a hand-drawn icon. Long custom network names are shrunk down and
truncated so they don't overflow their sign.

The small network badge in the header (top of the app) is UNCHANGED --
this only touches the dashboard's network switcher.

Files changed (upload just these 3, overwriting the ones on the site):
  - app.js    (the sign-grid rendering, sheet open/close, click-to-switch,
                the updated Base icon)
  - index.html (adds the sheet's markup, swaps the old <select> for a
                button that opens it)
  - app.css   (styles for the sheet, the sign grid, and the selected-network
                highlight)

Tested live on tokenswaphub.org before packaging:
  - Opened the sheet, confirmed all 6 signs render, current network shows
    the gold selected-ring.
  - Tapped Polygon -> network switched, sheet closed, selected-ring moved
    to Polygon on reopen; switched back to Base afterward.
  - Confirmed Base's new icon reads clearly (line + dot visible) at the
    actual small size it renders at in the sheet, not just at full size.
