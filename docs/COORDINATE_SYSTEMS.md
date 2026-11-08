# Coordinate systems

All conversions go through one module, `backend/app/science/coordinates.py`, which is tested in `tests/scientific/test_coordinates.py`. The frontend repeats only the display conversion (`src/utils/field.ts: offsetToLatLon`), using the same formula.

## Body-fixed frame: MOON_ME

- **Terrain products.** LOLA LDEM, PGDA 69 and PGDA 78 are in the "MEAN EARTH/POLAR AXIS OF DE421" frame (product labels).
- **SPICE frame.** SPICE realises MOON_ME as MOON_ME_DE440_ME421, from moon_pa_de440_200625.bpc plus moon_de440_250416.tf.
  - Per the kernel notes, this frame differs from DE421's ME frame by less than 3.07e-7 rad (about 0.5 m) over 2000–2040.
- **Load-order trap.** moon_080317.tf (the DE421 set) also defines the alias MOON_ME, and the last kernel loaded wins.
  - Penumbra does not load it; the kernel list is in `ephemeris.py`.
- **MOON_PA vs MOON_ME.** MOON_PA (principal axes) differs from MOON_ME by a fixed rotation of about 0.0289°.
  - Test S3 checks that the vectors we compute really are in MOON_ME.

## Reference sphere

R = 1737.4 km. Heights are metres above this sphere; the PDS label says `OFFSET = 1737400`.

## South polar stereographic map (spherical, true scale at the pole)

- **Forward:** ρ = 2R·tan(π/4 + φ/2) for latitude φ < 0; x = ρ·sin λ; y = ρ·cos λ, with east longitude λ.
- **Inverse:** λ = atan2(x, y); φ = 2·atan(√(x² + y²) / 2R) − π/2.
- **Trig-free form from a unit vector v:** x = 2R·v_y/(1 − v_z), y = 2R·v_x/(1 − v_z), used by the horizon tracer.
- **pyproj check:** `+proj=stere +lat_0=-90 +lon_0=0 +k=1 +R=1737400` agrees to within 1 mm (test S1).
- **Grid offsets are not compass offsets.** Map +y points to longitude 0, not to local north.
  - The UI labels offsets as "grid-north", "grid-south-west" and so on.
  - Landing-uncertainty models are defined in local east/north and rotated into map axes through `grid_north_bearing(x, y)`.

## Raster georeferencing

- **PGDA 78 GeoTIFF.** GeoKey RasterPixelIsArea: the tiepoint is the outer corner of pixel (0, 0). This is the GMT "pixel-registered" convention in the PGDA 78 README.
  - Pixel centres lie at x₀ + (j + ½)·5 m and y₀ − (i + ½)·5 m.
  - Test S2: the Site01 and Site04 tile centres map to the published centres (−89.4632°, 222.510°E; −89.7668°, 188.130°E).
- **LOLA / PGDA 69 PDS images.** For 0-based line i and sample j:
  - x = (j − SAMPLE_PROJECTION_OFFSET)·MAP_SCALE;
  - y = (LINE_PROJECTION_OFFSET − i)·MAP_SCALE;
  - offsets are read from each label.

## Local frame at a surface point

- up = radial unit vector.
- east = (−sin λ, cos λ, 0).
- north = up × east.
- Azimuth = atan2(d·east, d·north), clockwise from north.
- Elevation = asin(d·up / |d|).

## Time

SPICE ephemeris time from UTC through naif0012.tls. Hour index k of a year is UTC (year-01-01 00:00) + k h.
