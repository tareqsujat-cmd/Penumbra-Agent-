# Data download manual

The repository holds Penumbra's code. It does not hold the data, which is too large for GitHub. The data comes in three parts:

| Part | Folder | How you get it | Size |
|---|---|---|---|
| Raw NASA/JPL data | `data/raw/` | **downloaded** by `python tasks.py data` | 3.3 GB |
| Globe imagery tiles | `tiles/` | **built** by `python tasks.py imagery` (it downloads imagery while it runs) | about 1 GB downloaded, up to about 2 GB on disk |
| Cached results | `data/cache/` | **computed** by `python tasks.py precompute` | about 130 MB |

Plan for about **6 GB of free disk space**, including `node_modules`.

All of it is public data from NASA, JPL and partner archives. You do not need an account or an API key.

## Quick start

Run these from the repository folder, using the Python environment you set up in the README (Python 3.12 with `backend/requirements.txt`):

```bash
python tasks.py data          # 1. download and verify the raw data (3.3 GB, 165 files)
python tasks.py precompute    # 2. cached horizon grids for the 5 sites (about 5 minutes on 16 threads)
python tasks.py imagery       # 3. build the globe imagery tiles (long; needs internet)
python tasks.py doctor        # 4. check that everything is in place
python tasks.py dev           # 5. run the app at http://127.0.0.1:4173
```

You can stop any step and run it again. Finished files are kept, and an interrupted download picks up where it stopped.

Steps 2 and 3 are optional:

- **Without the cache (step 2)**, the app computes each site's grid on first use. The first time you open a site, it is slow.
- **Without the tiles (step 3)**, the app still runs. However, the globe has no zoomable imagery, and the site photo layers are missing.

## Step 1: raw data (`python tasks.py data`)

`python tasks.py data` runs `scripts/download_data.py`. That script uses only Python's standard library, so you can even run it before `pip install`:

```bash
python scripts/download_data.py
```

It reads the file list in `data/metadata/downloads.json` and downloads each file into `data/raw/`. It checks every file after downloading it, and skips files that are already in place.

### What gets downloaded

| Group | Files | Size | Contents | Source |
|---|---:|---:|---|---|
| `spice` | 14 | 72 MB | SPICE kernels: DE440, lunar orientation (MOON_ME), Earth orientation, DSN station positions | NASA JPL NAIF |
| `lola` | 4 | 145 MB | LOLA south-polar DEMs LDEM_80S_80M and LDEM_75S_240M | NASA PDS Geosciences Node |
| `pgda78` | 58 | 2.5 GB | PGDA Product 78: 5 m DEMs of the five sites, with slope, error and 20 error clones | NASA GSFC PGDA |
| `pgda69` | 4 | 233 MB | PGDA Product 69: average Sun and Earth visibility maps (validation V1) | NASA GSFC PGDA |
| `horizons` | 75 | 181 MB | Sun and Earth azimuth/elevation tables (validation V4) | JPL Horizons API |
| `stars` | 1 | 0.4 MB | Yale Bright Star Catalogue, 5th edition (the star field) | CDS VizieR V/50 |
| `imagery` | 6 | 178 MB | LOLA north-polar DEMs and the global LDEM_16 (inputs for step 3) | NASA PDS Geosciences Node |
| `docs` | 3 | 17 MB | Reference papers and the DSN handbook (PDF; the app does not use them) | JPL DSN, NASA NTRS |

Most of the size is PGDA 78. The **Connecting Ridge (Site01)** and **Shackleton rim (Site04)** folders are about 940 MB each, because they include the 20 error clones.

### Options

```bash
python tasks.py data --list                 # the groups above, with file counts and sizes
python tasks.py data --only spice,lola      # only some groups
python tasks.py data --skip docs            # everything except some groups
python tasks.py data --match Site01         # only files whose path contains this text
python tasks.py data --jobs 3               # parallel downloads: 1 to 3 (default 2)
python tasks.py data --check                # verify what is on disk (full checksums), download nothing
```

On a slow or shared connection, use `--jobs 1`.

### How files are checked

- **Static files** (PDS, PGDA, NAIF, the PDFs) must match their SHA-256 checksum exactly. If one doesn't match, the script deletes it and downloads it again.
- **JPL Horizons tables and the star catalogue** come from live web services. Their headers include the request time and the current Earth-orientation file name, so the file is never byte-identical. The script therefore checks only the **data rows**. On 12 Nov 2026, a sample re-download reproduced the data rows of the copies used for validation exactly.
  - If JPL later updates its models, the rows may differ slightly. The script then keeps the file and prints a note. Validation V4 allows 10″, while the reference tables agreed with SPICE to within 0.1″.
- **The north LOLA label** (`ldem_80n_80m.lbl`) is checked by size only.

If the main VizieR server (CDS Strasbourg) is unavailable, the script uses the Harvard mirror. It returns the same rows.

## Step 2: cached results (`python tasks.py precompute`)

This step computes each site's terrain horizon grid and saves it in `data/cache/`, along with the derived geometry and metric fields. It needs the `spice`, `lola` and `pgda78` groups.

Anything missing from the cache is computed the first time it is needed. The cache is keyed by the input data and the terrain version, so stale entries are never used.

## Step 3: globe imagery (`python tasks.py imagery`)

This step runs the imagery builders in order. Each builder adds to `tiles/manifest.json`.

1. `prepare_tiles.py all`: global LOLA heights (`ldem16.bin`), LROC WAC global mosaic levels 0 to 6, and the manifest.
2. `prepare_polar.py north`: coarse polar height grids.
3. `prepare_polar.py sites`: site and region boxes.
4. `prepare_trek.py all`: polar height tiles and photo-plus-relief composites on the NASA Moon Trek grid.
5. `prepare_site_images.py`: site, detail and region images for the landing views.

It needs the `lola`, `imagery` and `pgda78` groups from step 1. It downloads imagery from the USGS Astrogeology map server and NASA Moon Trek, and caches the source tiles in `tiles/src/`. This is the longest step. If a step fails, run the command again: finished tiles are kept.

While the app runs online, the server fetches deeper zoom levels on demand (WAC level 7, LROC NAC and Kaguya levels 8 to 11) and caches them in `tiles/`.

## Working offline

After steps 1 to 3, the app needs no internet:

```bash
PENUMBRA_OFFLINE=1 python tasks.py dev        # Windows PowerShell: $env:PENUMBRA_OFFLINE=1; python tasks.py dev
```

In offline mode, the server never contacts USGS or Moon Trek. The globe shows only the tiles already in `tiles/`. If you want deep zoom offline, browse the areas you need while online first.

## Troubleshooting

| Message | What to do |
|---|---|
| `FAIL ... (timed out)`, `Not Found` or `Service Unavailable` | Run the same command again. Each file is tried 4 times with growing waits. Finished files are kept, and partial `*.part` files resume. |
| `Not enough free disk space` | Free some space, or download in parts with `--only`. |
| `SHA-256 mismatch` after the retries | The file on the server has changed, or something on your network is altering downloads. Try another network. If it persists, the archive has published a new version: tell the team. |
| `WARNING: data rows differ from the reference copy` | The file was kept. See *How files are checked*. Validation V4 tells you if the difference matters. |
| `the response contains no data rows` | JPL Horizons or VizieR returned an error page. Try again later. |
| Downloads fail behind a proxy | Set `HTTPS_PROXY` (and `HTTP_PROXY`) before running. Python's downloader uses them. |
| `doctor` reports missing raw files | Run `python tasks.py data --check`. It lists exactly which files are missing or damaged. |

## For maintainers

- `data/metadata/downloads.json` is generated by `python scripts/build_download_manifest.py`. The generator reads `data/metadata/datasets.json` and the local copies of the files. It rebuilds the Horizons API requests from the table headers, and the VizieR request from the catalogue header.
- On the original workstation, `python tasks.py link` hard-links the same files from the first download folders (`../penumbra_prep/data/raw`, `../research/top3_probes/data`) instead of downloading them.
- The reference PDFs are kept out of the repository because they are third-party publications. The script downloads them from their publishers.

## Credits

- NASA LRO LOLA team and the PDS Geosciences Node.
- NASA GSFC Planetary Geodesy Data Archive:
  - Product 78: Barker et al. 2021.
  - Product 69: Mazarico et al. 2011.
- NASA JPL NAIF (SPICE) and the JPL Solar System Dynamics group (Horizons).
- CDS Strasbourg (VizieR; Hoffleit and Warren 1991).
- USGS Astrogeology and NASA Moon Trek (LROC WAC/NAC, Kaguya TC from JAXA, Chang'e-2 hillshade).

Files, versions, frames and checksums are listed in [docs/DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md).
