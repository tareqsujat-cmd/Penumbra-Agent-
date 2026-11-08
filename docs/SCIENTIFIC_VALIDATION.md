# Scientific method and validation

Measured results: [VALIDATION_RESULTS.md](VALIDATION_RESULTS.md) (generated from the last run). Coordinates and frames:
[COORDINATE_SYSTEMS.md](COORDINATE_SYSTEMS.md). Datasets: [DATA_PROVENANCE.md](DATA_PROVENANCE.md).

## 1. Terrain horizon (`backend/app/science/horizon.py`)

For an observer at map point (x, y) with surface height h₀ (metres above the 1737.4 km sphere) and mast m:

- up₀ is the radial unit vector; azimuth α is clockwise from local north; t = cos α · north + sin α · east.
- The point at arc distance s along azimuth α has unit vector v(s) = cos(s/R) · up₀ + sin(s/R) · t.
- Its height h(s) comes from the finest DEM covering it, interpolated bilinearly:
  - PGDA 78 5 m tile up to 12 km;
  - LOLA LDEM_80S_80M up to 150 km;
  - LOLA LDEM_75S_240M up to 300 km.
- Arc samples are spaced 5 m to 2 km, then 10 m to 6 km, 20 m to 12 km, 80 m to 150 km and 240 m to 300 km: 3,450 per azimuth.
- Apparent elevation of a sample: E(s) = asin(((R + h(s)) v(s) − P₀) · up₀ / |…|), with P₀ = (R + h₀ + m) · up₀.
  - Lunar curvature enters through this 3-D geometry, with no correction term.
- H(α) = max over s ≥ s_min of E(s), for 720 azimuths in 0.5° bins.
- s_min = 1.5 pixels of the finest DEM in use: 7.5 m on 5 m terrain, 120 m on LOLA 80 m.
  - Inside the observer's own cell, the bilinear surface only encodes that cell's tilt.
  - At the pole, the Sun stays within about 1.5° of the horizon, so that tilt alone would otherwise decide surface-level illumination.
- Map projection is trig-free: x = 2R·v_y/(1 − v_z), y = 2R·v_x/(1 − v_z).
- Implementation: Numba, parallel over (point, azimuth).
- Tests:
  - S4: the flat-Moon dip −acos(R/(R+m)) to within 1e-3°.
  - S5: a synthetic Gaussian hill against an independent brute-force ray, to within 0.05°.
  - S6: a taller mast never raises the horizon.

## 2. Sun and Earth geometry (`ephemeris.py`)

- Kernels: NAIF SPICE DE440 (de440s.bsp); lunar orientation moon_pa_de440_200625.bpc with moon_de440_250416.tf, so MOON_ME = MOON_ME_DE440_ME421.
- Target vector d = spkpos(target, et, MOON_ME, 'LT+S', MOON) − P_site.
  - Topocentric parallax matters for the Earth (about 0.26°), so P_site is subtracted.
  - Across a 1.4 km grid the remaining difference is below 0.0002°, so one vector per hour serves the site.
  - Each grid point still uses its own local basis.
- Angular radius: ρ = asin(R_body / |d|), with radii from pck00011.tpc.
- Validation V4: apparent az/el against JPL Horizons tables (DE441, MEAN_ME, airless) at four sites through 2027.
- Test S3: MOON_ME vs MOON_PA separations stay below the documented 0.0289° rotation, proving the frame is the one in use.

## 3. Visibility (`visibility.py`)

With e = E_target − H(A_target) and angular radius ρ:

- **Solar-disc fraction:** f = 1 if e ≥ ρ; 0 if e ≤ −ρ; otherwise 1 − [acos(e/ρ) − (e/ρ)·√(1 − (e/ρ)²)] / π.
  - The skyline is treated as a straight line across the disc.
  - Test S7: values at −ρ, 0 and +ρ, plus a pixel-counting comparison.
- **Earth visible (product):** e ≥ margin.
  - The margin defaults to 2° and is user-set.
  - It is labelled as our assumption, not a NASA requirement.
- **"Any part of the disc" (validation only):** e > −ρ. PGDA 69 and Gläser et al. 2018 use this definition.
- **Metrics over a window:**
  - sunlight = mean f;
  - longest darkness = longest run of hours with f = 0;
  - Earth % and DSN % = shares of hours.

## 4. DSN geometric visibility (`dsn.py`)

- Moon elevation at DSS-14, DSS-63 and DSS-43 comes from the station SPK and topocentric frame kernels.
- Masks follow DSN 810-005 module 301 Rev. P: 6° (receive) or 10.1° (uplink).
- DSN opportunity = Earth visible from the site AND at least one station above its mask.
- Geometric visibility does not guarantee scheduled DSN service or a successful communications link.

## 5. Landing uncertainty and robust aim (`landing.py`)

- **Models** (offsets in local east/north metres, converted to map offsets through the site's grid-north bearing):
  - circular: uniform over radius r;
  - elliptical Gaussian: σ_E, σ_N and rotation θ.
- **Samples:** N = 2,000, fixed seed. The same offsets are reused for every candidate aim (common random numbers), so rankings are stable.
- **Performance grid:**
  - 10 m spacing over ±700 m at Connecting Ridge and Shackleton (19,881 points);
  - 25 m elsewhere (3,249 points).
  - Metrics come from §1–3. Touchdown values are bilinear interpolations, and horizons are never recomputed per sample.
- **Statistics:** Pq = q-th percentile over the touchdowns. P50 is typical, P20 cautious, P10 conservative, P05 highly conservative.
- **Robust aim:** argmax of Pq over grid nodes within the search radius whose landing zone stays on the grid.
  - Ties are broken by the higher nominal value.
  - An optional slope filter uses PGDA 78 slope and is an assumption the user sets.
- **Tests:**
  - S8: sampling distributions (KS test; covariance within 2%).
  - S9: percentiles on a planar field.
  - S10: a spike-vs-plateau field, where the robust aim must be the plateau.

## 6. Power scenario (`power.py`)

- Vertical panels: P = Σ P_rated · f · max(0, cos E_sun · cos(A_sun − A_panel)).
- Hourly balance: B(t+1) = clip(B(t) + (P_solar − P_load) · 1 h, 0, B_max).
  - The load drops to the hibernation value at the usable reserve, and returns 10% of capacity above it.
- **VIPER preset, VERIFIED values:** 5,420 Wh; 3 × 320 W arrays; 50 h low-power survival.
- **VIPER preset, ASSUMPTION values:** operating load and reserve.
- Output name: "Energy endurance estimate". It is not a thermal or electrical mission simulation.

## 7. Validation cases

Tolerances were fixed before any result existed. If a case fails, the science is fixed; the tolerance is never widened.

| Case | Reference | Tolerance |
|---|---|---|
| V1 | NASA PGDA 69 average Sun and Earth visibility, 17 points (5 sites + 12 random landable, seed 2026) | MAE ≤ 2 pp |
| V2 | Gläser et al. (2018) Tables 1–2, 7 south-polar points, 2017–2037 hourly | ≥ 5 of 7 within 3 pp |
| V4 | JPL Horizons apparent az/el | ≤ 10″ |
| V3 | Barker et al. (2021) clone percentiles | not run (optional clone grids) |

How each comparison is made like-for-like (decided while investigating, recorded here because it matters):

- **V1 uses LOLA terrain only.** PGDA 69 was computed on the 120 m LDEM.
  - Each point is snapped to its 120 m pixel centre and compared with that pixel's value.
  - Bilinear sampling of the map blends cells across ridge crests.
  - The 18.6-year averaging window starts on 2009-01-01. That start is our choice: the product gives the cycle length but not its start.
- **V2 surface-level cases use PGDA 78 averaged to 20 m** (the published DTM resolution) plus LOLA.
  - Surface-level light at the pole is set by slopes at the DEM's own scale.
  - The raw 5 m surface values are reported alongside as a sensitivity (39–75%), not hidden.
  - The 2 m cases use the full 5 m product pipeline, which is what the app uses.
- **Development history.** Before s_min existed, surface-level cases were 30+ pp too dark and failed V1/V2.
  - The cause was traced to self-shadowing inside the observer's DEM cell (§1).
  - The fix was made in the science, not in the tolerance.

## 8. Known limitations

- **Terrain resolution and elevation error affect results.**
  - PGDA 78 5 m tiles are only 7–10% filled by LOLA returns at 5 m (Barker et al. 2021); the rest is interpolated.
  - The 20 terrain-error clones per hero site can be run with `python tasks.py precompute --clones 20`. They are not used by default.
- **Knife-edge ridges.** Shackleton's rim at LOLA resolution is about 8 pp darker than PGDA 69 (V1), from the 80 m vs 120 m DEM.
- **Mast height.** The grid is computed for a 2 m mast; other masts recompute horizons at the aim only.
- **Uncertainty model.** A user-selected model is not the true distribution of a real lander.
- **DSN.** Geometric visibility only, as above.
- **Power.** A simplified energy model with assumption-labelled loads.
- **Year.** The default analysis year is 2027. Any year inside the kernel coverage (to 2126) can be requested through the API.
