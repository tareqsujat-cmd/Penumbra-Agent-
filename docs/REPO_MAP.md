# Repository map

```text
penumbra_mockup/
├── backend/app/          FastAPI app; science/ (tested modules) and services/ (cache, bundles, analyses)
├── src/                  React + TypeScript frontend (features/, api/client.ts, hooks/, state/, utils/)
├── tests/
│   ├── scientific/       S1-S12 + V4 (pytest)
│   ├── api/              endpoints and every error path (pytest + FastAPI TestClient)
│   ├── frontend/         Vitest + Testing Library
│   └── e2e/              Playwright journeys A-C, responsive and offline checks
├── scripts/              link_data, build_datasets, precompute, benchmark, gen_docs; imagery builders (polarlib,
│                         prepare_trek, prepare_site_images, prepare_tiles, prepare_globe, prepare_polar)
├── data/
│   ├── raw/              hard links to the NASA/JPL files (not committed)
│   ├── cache/            computed products (not committed)
│   └── metadata/         files.json (SHA-256), datasets.json (sources, frames, versions)
├── tiles/                globe imagery tile cache (not committed)
├── docs/                 method, validation, provenance, performance, test report, UI references
├── screenshots/          QA and e2e screenshots
├── serve.py              tile builders (imported by the backend for /tiles)
├── tasks.py              doctor · link · precompute · build · dev · test
└── README.md, ARCHITECTURE.md, .env.example
```

## Outside this folder (read-only inputs)

- `../penumbra_prep/data/raw/`: raw NASA/JPL downloads with checksums (SPICE kernels, PGDA 78 clones and tiles, reference PDFs).
- `../research/top3_probes/data/`: raw NASA data downloaded during research (LOLA DEMs, PGDA 69 maps, PGDA 78 Site01/04 surfaces, JPL Horizons tables).
  - Only these **data files** are linked.
  - The research **probe scripts** (`../research/top3_probes/*.py`) and their outputs are not used by, or copied into, this code base.
- `../penumbra_prep/env/`: offline Python wheelhouse and npm cache.
