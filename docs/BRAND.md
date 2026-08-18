# SUNMILL — brand

The name is the brief: **sun + mill**. The mark is a windmill standing in a
sun — but the sails are not drawn *on* the sun, they are cut *out* of it.
Everything inside the disc is clipped to the disc, so the sail tips and the
ground end flush with its edge and the two shapes read as one struck form
rather than a sticker on a coin. It also happens to be the Feed Mill the player
builds first, so the logo is a thing that exists in the game rather than an
abstraction bolted on top.

Everything is drawn as SVG, including the letters. There is no font to load,
embed or licence, and no binary anyone has to trust — the same reasoning that
made the game's art procedural in the first place.

---

## Files

All under `frontend/public/brand/`.

| File | Use |
|---|---|
| `sunmill-logo.svg` | **Primary.** Horizontal lockup, dark wordmark. Light backgrounds. |
| `sunmill-logo-light.svg` | Horizontal lockup, cream wordmark. Dark backgrounds. |
| `sunmill-logo-stacked.svg` | Vertical lockup. Narrow spaces, splash screens. |
| `sunmill-logo-stacked-light.svg` | Vertical lockup for dark backgrounds — including the game's own intro card, which sits on dark green. |
| `sunmill-mark.svg` | The mark alone, full detail. **32px and up.** |
| `sunmill-mark-simple.svg` | Bigger disc, heavier sails, no gradient, hub or rim. **Use below 32px** — none of that detail survives, and leaving it in turns the icon to mud. |
| `sunmill-mono.svg` | One colour. Stamps, embossing, single-colour print. Set `color` to recolour. |
| `sunmill-mono-light.svg` | The same, pre-set to cream. |
| `sunmill-wordmark.svg` | Letters only. Set `color` to recolour. |

Raster exports (`icon-192`, `icon-512`, `icon-maskable-512`, plus
`app/icon.png`, `app/apple-icon.png`, `app/opengraph-image.png`) are
**generated**, never hand-edited:

```bash
npm i -D playwright
node frontend/scripts/build-brand-assets.mjs
```

Re-run it after changing any brand SVG, or the PNGs quietly drift out of step
with the vectors.

---

## Colour

| Role | Hex | Where |
|---|---|---|
| Sun, centre | `#FFE9A8` | disc gradient highlight |
| Sun, mid | `#F6C94F` | disc body, hairline rim |
| Sun, edge | `#DDA426` | disc gradient shading |
| Ink | `#2C1705` | tile, mill, sails, ground |
| Wordmark | `#5C3618` | letters on light |
| Wordmark, reversed | `#FFF4D4` | letters on dark |
| Social ground | `#170C02` | the `opengraph-image` field, deeper than the tile |

The sun's three stops are the game's own gold ramp; the ink is the outline
colour every sprite in `art.ts` already uses, so the logo and the UI share one
palette and nothing has to be matched by eye.

---

## Using it

- **Clear space:** keep one quarter of the tile's width free on every side. In
  the lockups that spacing is already built in.
- **Minimum size:** 16px for `sunmill-mark-simple.svg`, 32px for
  `sunmill-mark.svg`, 96px wide for the horizontal lockup. Below that, use the
  mark alone.
- **On a dark background** use the `-light` variants. The tile carries its own
  colour, so only the wordmark changes — never invert the mark itself, which
  would turn the sun into a hole.
- **The tile is full-bleed.** Where the platform rounds or masks its own shape
  (Apple touch icons, Android maskable icons), render the mark on `#2C1705`
  rather than on gold, or the rounding shows as a frame. The build script
  already does this.
- **Do not** re-colour the disc, rotate the mark, add a second shadow, stretch
  either axis independently, or set "SUNMILL" in a font next to the mark. The
  wordmark is drawn; a typeface substitute will not match it.
- The wordmark and both mono files use `currentColor`, so inlining the SVG and
  setting CSS `color` is the supported way to recolour them.

---

## How the wordmark is built

Stroked skeletons, not filled outlines: cap height 100, stroke 27, round caps
and joins, on a shared grid. That keeps every letter the same weight by
construction rather than by eye, and makes the whole wordmark one short path
list instead of seven traced glyphs.

If a letter ever needs adjusting, move the skeleton — never thicken one stroke
on its own.

---

## Why three marks

A logo that only exists at one size is not finished. The three cuts are the
same drawing at three levels of detail:

- **Full** — gradient sun, hub, and a gold hairline on the tile. The tile is
  nearly black, and without that hairline the icon loses its edge against a
  dark page; it is definition, not decoration. Anything 32px and up.
- **Simple** — flat gold, bigger disc, heavier sails, no hub or rim. Favicons
  and 16–24px, where the full mark's detail collapses into noise. The tile
  stays, because it is what guarantees contrast on an unknown background.
- **Mono** — one colour, and the only cut that changes the drawing: the filled
  disc becomes a ring. With no second colour available, a solid sun would
  swallow the mill standing on it.
