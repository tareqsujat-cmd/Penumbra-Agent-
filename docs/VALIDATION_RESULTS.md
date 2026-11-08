# Validation results

Computed 2026-10-01T11:00:33Z by this build (pgda78-v1+ldem80s-v2+ldem75s-v2+smin1.5px). Method and assumptions:
SCIENTIFIC_VALIDATION.md.

## V1 · NASA PGDA 69 (PASS)

Surface-level horizons (720 az) from LOLA 80/240 m (the reference used the 120 m LDEM); SPICE DE440 Sun/Earth every 6 h over 18.6 years from 2009-01-01; 'any part of the disc'. Reference: PGDA 69 AVGVISIB_75S_120M (sun and earth): each point is snapped to its 120 m pixel centre and compared with that pixel's value. The 18.6-year window start is our choice: the product label gives the cycle but not its start.

| Point | Sun ours | Sun PGDA 69 | Earth ours | Earth PGDA 69 |
|---|---|---|---|---|
| Connecting Ridge | 63.68 | 67.7 | 50.06 | 52.3 |
| Shackleton rim | 77.35 | 85.7 | 54.94 | 56.08 |
| Malapert massif | 31.91 | 38.07 | 52.23 | 52.94 |
| Mons Mouton / Leibnitz β | 20.64 | 18.78 | 37.44 | 36.64 |
| Nobile rim 1 | 30.52 | 30.47 | 33.89 | 33.52 |
| Random point 01 | 45.49 | 45.74 | 27.57 | 27.83 |
| Random point 02 | 27.63 | 27.86 | 0.3 | 0.58 |
| Random point 03 | 14.46 | 14.74 | 34.15 | 34.28 |
| Random point 04 | 24.21 | 24.47 | 15.44 | 15.04 |
| Random point 05 | 19.36 | 19.81 | 49.65 | 49.62 |
| Random point 06 | 35.47 | 35.44 | 46.52 | 43.93 |
| Random point 07 | 38.9 | 39.19 | 58.5 | 58.49 |
| Random point 08 | 0.0 | 0.0 | 0.0 | 0.0 |
| Random point 09 | 41.27 | 41.46 | 0.0 | 0.0 |
| Random point 10 | 31.39 | 31.62 | 5.64 | 6.24 |
| Random point 11 | 24.33 | 28.92 | 39.31 | 39.24 |
| Random point 12 | 39.81 | 40.02 | 26.84 | 27.67 |

Mean absolute error: Sun 1.61 pp, Earth 0.62 pp (tolerance 2.0 pp).

## V2 · Gläser et al. 2018 (PASS: 6 / 7 within 3.0 pp)

2 m cases: horizons from PGDA 78 5 m + LOLA 80/240 m (the product pipeline). Surface cases: PGDA 78 averaged to 20 m (the published DTM resolution) + LOLA, because surface-level light is set by slopes at the DEM's own scale; the 5 m surface value is reported alongside as a sensitivity. SPICE DE440 Sun hourly 2017-01-01 to 2037-01-01. Average illumination = mean visible fraction of the solar disc; solar visibility = any part of the disc; longest shadow = longest run with no part of the disc visible.

| Point | Table | Published | Ours | Diff | Visibility pub / ours | Longest shadow pub / ours | Terrain | 5 m surface |
|---|---|---|---|---|---|---|---|---|
| Connecting Ridge C1 (surface) | Table 1 | 76.0 | 69.91 | -6.09 | 81.3 / 74.96 | 268 / 301 h | PGDA 78 at 20 m + LOLA | 41.77 |
| Connecting Ridge C2 (surface) | Table 1 | 75.6 | 74.68 | -0.92 | 80.6 / 81.6 | 166 / 166 h | LOLA 80/240 m | 74.68 |
| Shackleton S (surface) | Table 1 | 81.0 | 79.85 | -1.15 | 85.5 / 84.25 | 221 / 224 h | PGDA 78 at 20 m + LOLA | 62.81 |
| Connecting Ridge C1 (2 m) | Table 2 | 88.0 | 85.97 | -2.03 | 92.1 / 90.88 | 112 / 115 h | PGDA 78 at 5 m + LOLA | - |
| Connecting Ridge C2 (2 m) | Table 2 | 78.1 | 77.58 | -0.52 | 82.0 / 81.48 | 165 / 230 h | LOLA 80/240 m | - |
| Shackleton S (2 m) | Table 2 | 85.5 | 83.94 | -1.56 | 89.4 / 88.8 | 66 / 67 h | PGDA 78 at 5 m + LOLA | - |
| Shackleton S' (2 m) | Table 2 | 82.1 | 81.82 | -0.28 | 89.8 / 88.47 | 65 / 65 h | PGDA 78 at 5 m + LOLA | - |

## V4 · SPICE vs JPL Horizons (PASS)

Apparent az/el ('LT+S') of the Sun and Earth from a surface point on the 1737.4 km sphere, hourly through 2027, compared with JPL Horizons tables for the same points (MEAN_ME, airless).

| Site | Body | Hours | Max | Mean |
|---|---|---|---|---|
| cr1 | SUN | 8760 | 0.01" | 0.0" |
| cr1 | EARTH | 8760 | 0.1" | 0.06" |
| malapert | SUN | 8760 | 0.01" | 0.0" |
| malapert | EARTH | 8760 | 0.1" | 0.06" |
| mouton | SUN | 8760 | 0.01" | 0.0" |
| mouton | EARTH | 8760 | 0.1" | 0.06" |
| im1 | SUN | 8760 | 0.01" | 0.0" |
| im1 | EARTH | 8760 | 0.1" | 0.06" |
