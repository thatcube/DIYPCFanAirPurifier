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

## Deploy Free (Recommended): Cloudflare Worker + D1 + Netlify

For a zero-monthly-cost setup, keep the frontend on Netlify and run the leaderboard API on Cloudflare.

- Worker API code: `workers/leaderboard-worker.js`
- Cloudflare config: `wrangler.toml`
- Netlify API proxy: `netlify.toml`

### 1) Create Cloudflare D1 database

```bash
npm run cf:d1:create
```

The current `database_id` is already set in `wrangler.toml`. If you create a new D1 database later, update that value.

### 2) Set required secrets on Cloudflare

```bash
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put IP_HASH_SALT
```

- `ADMIN_TOKEN`: used for admin moderation endpoints.
- `IP_HASH_SALT`: random string used to hash client IPs before storage.

### 3) Deploy Worker

```bash
npm run cf:deploy
```

Copy the deployed Worker URL (for example: `https://your-worker.your-subdomain.workers.dev`).

### 4) Point Netlify `/api/*` to your Worker

`netlify.toml` is configured to proxy API calls to:

- `https://diy-air-purifier-leaderboard.essays-loges0y.workers.dev/api/:splat`

If your Worker URL changes later, update this line and redeploy Netlify.

Then push and redeploy Netlify.

### 5) Verify end-to-end

1. `https://airpurifier.brandonmoore.design/api/leaderboard` returns JSON.
2. Start a run and submit a score from the live site.
3. Confirm leaderboard no longer shows `Local fallback`.

Notes:

- The API contract matches the existing frontend routes (`/api/leaderboard`, `/api/run/*`, `/api/admin/*`).
- Existing Node server (`server.js`) is still available for local development.
- If you ever exceed free Cloudflare quotas, API requests will fail until limits reset.
- Share links can point to `/leaderboard?entry=<entryId>` to highlight a specific score.

## Deploy On Render (Paid Alternative)

The easiest path is Render using the included blueprint:

1. Push latest `main` to GitHub.
2. In Render: `New` -> `Blueprint` -> select this repo.
3. Render will detect `render.yaml` and create one web service with a persistent disk.
4. Wait for deploy, then open the Render URL.
5. Share that URL with friends.

Important:

- Use the Render URL (same origin) so client + API stay together.
- Persistent leaderboard storage is mounted at `/var/data` via `DATA_DIR`.
- Do not use static file hosting only (GitHub Pages/Netlify static-only) for shared scores.
- Keep instance count at 1 unless you move leaderboard storage to a real shared database.

## Shared Leaderboard Anti-Exploit Notes

Server-side protections in `server.js` include:

- Server-authoritative run timing (`/api/run/start` to `/api/run/finish`)
- Per-run coin claim validation (all required coins must be claimed)
- Run token bound to client IP
- Coin-claim pacing guard (minimum interval)
- Run min/max duration checks
- Basic per-IP rate limiting

## Optional Admin API (Now Included)

Admin endpoints are token-protected and disabled unless `ADMIN_TOKEN` is set.

- Header options:
	- `Authorization: Bearer <ADMIN_TOKEN>`
	- `x-admin-token: <ADMIN_TOKEN>`

Endpoints:

1. `GET /api/admin/leaderboard`
2. `POST /api/admin/delete` with JSON body `{ "id": "<entryId>" }`
3. `POST /api/admin/reset` with JSON body `{ "confirm": "RESET_LEADERBOARD" }`

Example:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://your-app.onrender.com/api/admin/leaderboard
```

Security notes:

- Keep `ADMIN_TOKEN` secret and rotate it if leaked.
- Do not expose admin requests from the browser client; use terminal/curl.

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
- **Shareable results** — finish-time copy button plus a `/leaderboard` page with deep-link highlight support

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
