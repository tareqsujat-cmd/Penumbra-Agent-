# Architecture

The goal is the smallest architecture that delivers the product (Instructions §50):

- one Python process (FastAPI + Uvicorn);
- one static frontend;
- files instead of a database.

## Processes

| Process | Command | Serves |
|---|---|---|
| Backend | `python tasks.py dev` (`uvicorn backend.app.main:app --port 4173`) | `/api/*`, the built frontend `dist/`, imagery `/tiles/*` |
| Frontend dev server (optional) | `python tasks.py dev --vite` (`vite` on :5173) | hot reload; proxies `/api` and `/tiles` to :4173 |

## Backend (`backend/app`)

```text
main.py          routes, error envelope {error: {code, message, detail}}, timeouts, static + tiles
schemas.py       typed requests (Pydantic)
config.py        paths, port, default year (env-overridable; see .env.example)
science/         pure, individually tested modules
  coordinates.py   the only place with frame/projection formulas
  terrain.py       PGDA 78 GeoTIFF + LOLA/PGDA 69 PDS readers (memory-mapped)
  horizon.py       Numba horizon tracer (720 az, 5 m + 80 m + 240 m to 300 km)
  ephemeris.py     SPICE kernels, Sun/Earth vectors, DSN station elevations, coverage checks
  visibility.py    solar-disc fraction, grid metrics kernel (Numba)
  landing.py       touchdown models, landing-zone statistics, robust-aim optimiser
  dsn.py, power.py, validation.py, errors.py
services/
  sites.py         site registry (centres and reference points from the cited sources)
  products.py      cached horizon grids, hourly geometry, metric fields (data/cache, keyed by inputs)
  bundle.py        site bundle for the UI (terrain PNGs, fields, ephemeris, skyline)
  analysis.py      visibility at an aim, landing risk, robust aim
  validation.py, provenance.py
```

### Request flow

Taking "Find robust aim" as the example:

1. `POST /api/robust-aim` is validated by Pydantic.
2. `analysis.robust` reads the site's metric field. That field comes from cached horizons and cached SPICE geometry, built once in about 1.5 min for a hero site.
3. 2,000 offsets are drawn with a fixed seed (common random numbers).
4. `landing._pq_for_candidates` (Numba, parallel) evaluates Pq at about 6,000 candidates.
5. The response holds the best nominal point, the robust aim and the score field. It returns in about 50 ms end to end.

### Caching

- **Disk:** `data/cache/{horizons,geometry,bundles,validation}`, keyed by a hash of the inputs and the terrain version.
- **Memory:** an in-memory LRU sits on top.
- **Invalidation:** changing the horizon method bumps `TERRAIN_VERSION`, which invalidates every derived product.

### Errors

| Code | Status | Meaning |
|---|---|---|
| `DATASET_MISSING` | 503 | names the missing file |
| `OUT_OF_COVERAGE` | 422 | high-resolution terrain is unavailable at the requested point |
| `KERNEL_MISSING` | 503 | names the missing SPICE kernel |
| `DATE_OUT_OF_RANGE` | 422 | the date is outside kernel coverage |
| `INVALID_UNCERTAINTY` | 422 | malformed uncertainty model |
| `UNKNOWN_SITE` | 404 | no such site |
| `COMPUTE_FAILED` | 500 | carries a trace id; the stack goes to the log |

## Frontend (`src/`)

```text
api/client.ts        typed API client (implements PenumbraApi), site cache, ApiError
hooks/useMission.ts  shared request cache: de-duplicated, debounced, stale-while-revalidate
state/store.ts       one app store (Open MCT pattern: one time state), URL permalink
utils/field.ts       display helpers over API data (no science)
features/            globe · terrain3d · map · mission · uncertainty · timeline · skyline · comparison · validation · provenance · simple
```

- **No client-side science.** Every number on screen comes from the API.
- **First load.** Before an answer arrives the UI shows "—" or "computing…".
- **Errors.** API errors are shown with their message.

## Imagery (globe only)

The tile builders live in `serve.py` and `scripts/polarlib.py`:

- **Global:** WAC and Kaguya TC tiles from the USGS WMS.
- **Polar caps:** WAC, LROC NAC and Kaguya composites with Chang'e-2/LOLA relief filling permanently shadowed ground, from NASA Moon Trek.
- **Caching:** tiles are built on demand and cached under `tiles/`.
- **Offline:** `PENUMBRA_OFFLINE=1` disables upstream fetching. The science never depends on these tiles.

## Data

- **Raw files:** `data/raw/` holds hard links to the raw NASA/JPL files (`python tasks.py link`).
- **Metadata:** `data/metadata/files.json` lists SHA-256 checksums; `datasets.json` records sources, frames, resolutions, versions and uses.
