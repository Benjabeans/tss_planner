# TSS Planner

A WebReg-style weekly planner for UC San Diego classes. Search courses and hover a section to see it on your week, then add it. Conflicts get flagged and explained, with suggested fixes. When you're done, copy the section IDs into TSS (sis.ucsd.edu) to book.

The data comes from UCSD's public Class Planner API and refreshes automatically. See [DESIGN.md](DESIGN.md) for how it all works.

## Run it locally

Requires Node 24+ (Node 26 recommended, since the server runs TypeScript directly).

```bash
npm install
npm run sync        # first time only: downloads every term (~1 min each)
npm run dev         # server on :8787 + web on http://localhost:5173
```

`npm run dev` also keeps the data fresh on its own. It checks UCSD every 15 minutes and re-downloads a term when UCSD publishes an update, or when seat counts are more than an hour old.

## Using it

| Do this | How |
|---|---|
| Find courses | Type `CSE 110, 120`, `math18`, a subject (`COGS`) or a professor. Press `/` to jump to search. |
| Preview a section | Hover it (or tab to it). Ghost blocks show where it lands, and red hatching marks any overlap. |
| Add or swap | Click a section. Clicking another section of a course already in your plan swaps it. |
| Fix a conflict | Click the red pill in the header (or **Fix** on the toast). You can swap to a section that fits, mark one course as a backup, move it to another plan, or remove it. |
| Compare schedules | Use the plan menu in the header: new plan, duplicate, rename. |
| Block off time | Use **Block off time** for work, practice or commute. Classes that overlap it are flagged as warnings. |
| Finals | The **Finals** tab shows final exams by date and flags clashes. |
| Book | The plan table lists every section ID with copy buttons. **Copy all IDs** copies the whole list. |
| Calendar app | Use **⋯ → Export to calendar (.ics)**. Classes repeat through the quarter, skip holidays, and include finals. |

Plans are saved in your browser (localStorage).

## Project layout

```
shared/   planning core: normalizer, event packages, conflicts, lanes, search, ICS (pure TS)
server/   Hono API + UCSD sync (Node runs the .ts files directly)
web/      React + Vite + Tailwind UI
e2e/      Playwright smoke test (screenshots land in e2e/screenshots/)
deploy/   docker-compose + Caddy for the VPS
data/     synced catalogs and raw snapshots (gitignored)
```

## Checks

```bash
npm test            # unit tests (+ full-term package validation once data/ is synced)
npm run typecheck
npm run dev & node e2e/smoke.mjs     # end-to-end, needs `npx playwright install chromium` once
```

## Deploying to a VPS

```bash
# on the server, with Docker installed and DNS pointing at it
$EDITOR deploy/Caddyfile        # set your domain; optionally enable basic auth
docker compose -f deploy/docker-compose.yml up -d --build
```

The container serves the built web app and the API on port 8787. Caddy terminates HTTPS in front of it, and catalog data persists in the `planner-data` volume. Without Docker, run `npm ci && npm run build && npm run sync && NODE_ENV=production HOST=0.0.0.0 npm start` behind any reverse proxy.

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8787` / `127.0.0.1` | Where the server listens |
| `DATA_DIR` | `./data` | Catalog storage |
| `SYNC` | on | Set to `off` to disable background sync |
| `SYNC_POLL_MIN` | `15` | How often to check UCSD for updates |
| `SYNC_SEAT_REFRESH_MIN` | `60` | Re-download a term at least this often |
| `SYNC_REQUEST_DELAY_MS` | `700` | Pause between upstream requests |

## Caveats

- This is an unofficial tool. Seat counts can lag, and TSS is the source of truth when you book.
- The public data has no building or room numbers.
- The UCSD API is undocumented. If its format changes, the sync fails safely and keeps the last good data, and the server log says what broke.
