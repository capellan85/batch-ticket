# Batch Ticket — Prep Calculator

A batch cocktail prep calculator for bartenders. Save recipes as per-serving
ratios, pick a batch size, and it scales the math and adds a dilution
adjustment — styled like a kitchen ticket / dupe slip.

## Features

- **Recipes** — add / edit / delete recipes, each with ingredients in oz, ml, or dashes
- **Calculator** — pick a recipe, set servings, toggle oz/ml display
- **Dilution** — optional water adjustment with an adjustable % (default 20%)
- **Per-serving math** — every line shows how the total was scaled
- Recipes persist in the browser via `localStorage`

## Run locally

It's a static site — no build step. Serve the folder with any static server:

```bash
python3 -m http.server 4173
# then open http://localhost:4173
```

## Files

- `index.html` — markup + font/style links
- `styles.css` — all styling (dark charcoal / amber, Barlow Condensed + IBM Plex Mono)
- `app.js` — state, recipe storage, and the batch math
