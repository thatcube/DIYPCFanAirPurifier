# DIY PC Fan Air Purifier

Interactive 3D model of a DIY air purifier built from:

- **Plywood** — birch plywood construction
- **Arctic P12 Pro fans** — 120mm PC fans (x8), 7-blade sickle design with pinwheel support brace
- **3M 20×25×1 MERV 13 filters** — standard furnace filters

## About

This is a box-style air purifier designed around two rows of four Arctic P12 Pro fans pushing air through MERV 13 filtration. The 3D model lets you toggle between layout variants (front+back or front+top fan placement), switch wood stain options, and inspect the build from any angle.

## Run Locally (Shared Leaderboard Enabled)

The leaderboard now has a shared backend API. Run the app through the Node server:

1. `npm install`
2. `npm run dev`
3. Open `http://localhost:8787`

Opening `index.html` directly still renders the scene, but leaderboard sharing requires the API server.

## Shared Leaderboard Anti-Exploit Notes

Server-side protections in `server.js` include:

- Server-authoritative run timing (`/api/run/start` to `/api/run/finish`)
- Per-run coin claim validation (all required coins must be claimed)
- Run token bound to client IP
- Coin-claim pacing guard (minimum interval)
- Run min/max duration checks
- Basic per-IP rate limiting

## Features

- **Interactive 3D viewer** — orbit, zoom, and inspect from any angle
- **Fan color** — toggle white or black fan housings
- **RGB fans** — frosted translucent blades with LED color options (red, yellow, green, rainbow party mode)
- **Wood stain** — raw birch, oil, or walnut finish
- **Layout variants** — front+back or front+top fan placement
- **Exploded view** — pull apart components to see inner construction
- **Dimensions overlay** — toggle real-world measurements
- **X-ray mode** — see through panels to internals
- **Airflow particles** — 600-particle system showing intake → filter → exhaust flow (stagnant drift when fans off)
- **Day/night mode** — full lighting theme switch
- **Room context** — bedroom scene with bed, nightstand, TV wall, window with curtains, and door alcove for scale

## Room Layout

The purifier sits in a bedroom scene for real-world scale context:

- **Back wall (Z=50)** — split with a recessed door alcove (flush to right wall)
- **Front wall (Z=-50)** — opposite wall with mounted 65" OLED TV
- **Right wall (X=60)** — solid wall
- **Left wall (X=-60)** — wall with window and curtains, positioned near the bed
- **Bed** — Zinus Queen Piper platform bed, headboard against back wall
- **Nightstand** — between bed and purifier, with books and coffee mug
- **Door** — six-panel interior door in recessed alcove, brushed nickel hardware

## Tech

Single HTML file, ~2200 lines. Three.js r128 from CDN. No build step, no dependencies beyond the CDN.

- Phosphor Icons for UI
- Frosted glass UI panels with backdrop blur
- Liquid button animations (spring cubic-bezier)
- Proximity-based wall auto-fade (all 4 walls)
- Procedural birch plywood texture
