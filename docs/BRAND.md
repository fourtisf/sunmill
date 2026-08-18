# SUNMILL — brand

The name is the brief: **sun + mill**. The mark is a windmill standing in a
sun, and the mill's four sails are the sun's rays — one shape doing both jobs.
It also happens to be the Feed Mill the player builds first, so the logo is a
thing that exists in the game rather than an abstraction bolted on top.

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
| `sunmill-logo-stacked.svg` | Vertical lockup. Narrow spaces, splash screens, the game's own intro card. |
| `sunmill-logo-stacked-light.svg` | Vertical lockup for dark backgrounds. |
| `sunmill-mark.svg` | The mark alone, full detail. App icons from 32px up. |
| `sunmill-mark-simple.svg` | The mark with the lattice, door, rays and gloss removed. **Use below 32px** — none of that detail survives, and leaving it in turns the icon to mud. |
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

Straight from the game's own CSS variables — the logo and the UI share one
palette, so nothing has to be matched by eye.

| Role | Hex | Where |
|---|---|---|
| Sun, centre | `#FFF4D4` | disc highlight, sails, door |
| Sun, mid | `#F6C94F` | disc body, hub pip |
| Sun, edge | `#D5951E` | disc rim shading |
| Wood, mid | `#7A4A1C` | mill body highlight |
| Wood, deep | `#54300F` | mill body |
| Ink | `#2C1705` | every outline, cap, plinth |
| Wordmark | `#5C3618` | letters on light |
| Wordmark, reversed | `#FFF4D4` | letters on dark |

Sky `#5AA8D8` → `#8FCBE8` and grass `#3E7A2A` are the game's background
gradient, used on the social card.

---

## Using it

- **Clear space:** keep the height of the mark's rim free on every side. In the
  lockups that spacing is already built in.
- **Minimum size:** 24px for `sunmill-mark-simple.svg`, 32px for
  `sunmill-mark.svg`, 96px wide for the horizontal lockup. Below that, use the
  mark alone.
- **On a dark background** use the `-light` variants. Do not invert the full
  lockup wholesale — that turns the gold disc into a white blob.
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

- **Full** — gradients, rays, lattice, door, gloss. Anything 64px and up.
- **Simple** — flat gold, four sails, tower, rim. Favicons and 16–32px, where
  the full mark's detail collapses into noise.
- **Mono** — one colour, with the hub raised and the sails shortened so they
  clear the tower. Without a second colour to separate them, sails that crossed
  the tower would merge into a single blob.
