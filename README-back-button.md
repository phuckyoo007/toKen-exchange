# Back button restored

Found it — it's called `.top-back-btn` in the code, and it got dropped from the
current file set at some point (probably one of the old "upload files to
GitHub" mixups). I found it still intact in an older backup copy and ported
it back into the current files, adapted for the gold-frame desktop layout
that's been added since.

## What changed

Every "Back" (and the one "Cancel") button in the app is now a floating gold
pill pinned to the top-left corner of the screen, with a small dark circle
"←" icon, instead of a plain underlined text link sitting wherever it fell in
the page.

Because it's pinned (`position: fixed`) rather than sitting in the normal
page flow, it stays visible the whole time you're scrolled down a long list
(Prices, Activity, Settings, etc.) instead of you having to scroll all the
way back up or down to find it. It also has a slow gold glow pulse so it
doesn't get lost against the background (this turns off automatically for
anyone with "reduce motion" turned on at the OS level).

Files touched:
- `index.html` — 23 back/cancel buttons converted to the new markup
- `app.css` — added the `.top-back-btn` / `.top-back-btn-coin` styles, the
  glow animation, and the desktop-width repositioning rule (so it lines up
  with the gold card frame instead of the raw browser corner)

No `app.js` changes were needed — the click handling (`data-back` attribute,
`showScreen()`) was already generic and works with the new markup as-is.

Live-tested on the actual site (both scrolled and at the top of the Prices
screen, at the desktop card width) before packaging — screenshots matched
the old look and the button correctly navigated back on click.
