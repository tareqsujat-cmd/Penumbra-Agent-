# UI references (studied 29 September 2026)

**Rules.**
- Licenses were checked through the GitHub API and each project's LICENSE file.
- We borrow **patterns**, not code. Adapting code from Apache/MIT/BSD/ISC projects is legally possible with attribution, but nothing is copied before the event. At the event, any adapted snippet gets a comment naming its source and license.
- Nothing is taken from AGPL or NOSA projects beyond visual observation.

## 1. References

| # | Reference | License | Pattern studied | What we borrow (conceptually) | What we do differently |
|---|---|---|---|---|---|
| 1 | **NASA Open MCT**, https://github.com/nasa/openmct (API: `API.md`) | Apache-2.0 (LICENSE.md: "licensed under the Apache License, Version 2.0") | One app-wide **time state** ("time bounds") that every view subscribes to via `boundsChanged` events; **Fixed vs Real-time** modes; the **Time Conductor** UI; **Indicators**, small persistent status widgets that reveal detail on hover | A single time store `{landingDate, cursorTime, window}` drives the map, sky, card and calendar. Indicators in the header: "Local data", "Offline", "Frame MOON_ME", "Kernels loaded", each with hover detail and a click through to the DATA panel. | No real-time mode (we plan missions; we don't run operations). No plugin framework and no free-form dashboard layout: one opinionated screen. |
| 2 | **CesiumJS**, https://github.com/CesiumGS/cesium (Timeline and Animation widgets) | Apache-2.0 | A clock with play/pause and a speed multiplier; a timeline you can scrub; time-dynamic properties | The play/pause/speed scrubber under the sky dome; the timeline cursor moving in step with the Sun and Earth | **No 3-D globe:** landing-zone work is 2-D at 5 m in polar stereographic. No Cesium ion tokens, because the demo must run offline. |
| 3 | **OpenLayers**, https://github.com/openlayers/openlayers, examples `static-image`, `webgl-shaded-relief`, `webgl-sea-level`, `webgl-tile-style`, `cog-projection`, `layer-swipe`, `tooltip-on-hover`, `overlay`, `scale-line` | BSD-2-Clause | `ImageStatic` in a **custom metric projection**. **GPU shaded relief** computed from elevation with `sunEl`/`sunAz` style variables. `updateStyleVariables()` re-colours a WebGL layer instantly from a slider. Swipe comparison. Hover tooltips. | A local polar-stereographic projection in metres. **Hillshade lit from the real Sun azimuth at the cursor time** (a physically meaningful twist on the shaded-relief example). Percentile and threshold sliders re-style the heatmap without a server round trip. A nominal-vs-robust swipe. | No web tiles, basemaps or geocoding (it is the Moon and it must work offline). Never a lat/lon view at site scale. |
| 4 | **NASA Worldview**, https://github.com/nasa-gibs/worldview (`doc/url_parameters.md`) | NASA Open Source Agreement 1.3 (LICENSE.md) | **All app state in the URL:** projection, extent, layers with opacity and palette min/max, time, animation start/end/speed, and a two-state **A/B compare** (`ca`, with `cm` = swipe/spy/opacity). Polar projections with rotation. Date-step arrows with a custom interval. A distraction-free mode. | A **decision permalink**: site, date, aim, uncertainty model, percentile and layers are encoded in the URL, so an exported decision reopens exactly. Nominal-vs-robust A/B compare (swipe or opacity). Date-step arrows (hour, day, lunar day). A presentation mode for judging. | NOSA terms: patterns only, no code. One site at a time instead of a global layer catalogue. |
| 5 | **NASA WebWorldWind**, https://github.com/NASAWorldWind/WebWorldWind | Apache-2.0 (per the repository's "Apache License 2.0.pdf") | Virtual-globe navigation | Nothing structural | Rejected: a globe adds nothing at 5 m site scale, and the project is barely active (last push September 2025). |
| 6 | **react-three-fiber + drei**, https://github.com/pmndrs/react-three-fiber, https://github.com/pmndrs/drei | MIT (both) | Declarative three.js scenes. drei `Line`, `Html`, `Billboard`, `Text`, `CameraControls`, `Stars`, `Sky` | A skyline drawn as a 720-vertex `Line` loop; Sun and Earth tracks as `Line`s; cardinal and body labels via `Html`/`Billboard`; a first-person camera with limited pitch | **We do not use drei `<Sky>`:** it models Earth's atmospheric (Rayleigh) scattering, and the lunar sky is black. No DEM meshes in the browser (§21), only the backend's skyline. |
| 7 | **three.js**, https://github.com/mrdoob/three.js | MIT | Rendering core | – | – |
| 8 | **D3**, https://github.com/d3/d3, and **Observable Plot**, https://github.com/observablehq/plot | ISC (both) | Time scales and axes; band and interval marks | D3 scales and axes with hand-written SVG for the calendar rows and histograms | Only one chart library (D3). Plot is not added, to avoid overlap (§31). |
| 9 | **kepler.gl**, https://github.com/keplergl/kepler.gl, and **deck.gl**, https://github.com/visgl/deck.gl | MIT (both) | A layer panel with per-layer visibility, opacity, colour ramp and an inline legend | A compact layer list on the map: toggle, opacity and a legend ramp in one row | Not a second map engine: OpenLayers only. |
| 10 | **Grafana**, https://github.com/grafana/grafana | AGPL-3.0 | Stat panels with thresholds, a dense time picker, panel density | Visual density targets only | **Visual reference only (AGPL):** no code, no CSS. |
| 11 | **Stellarium Web Engine**, https://github.com/Stellarium/stellarium-web-engine | AGPL-3.0 (LICENSE-AGPL-3.0.txt) | Sky-view conventions: cardinal letters on the horizon, altitude rings, object labels, time controls along the bottom | These conventions in our sky dome | **Visual reference only (AGPL).** |
| 12 | **Radix UI Primitives**, https://github.com/radix-ui/primitives | MIT | Unstyled, accessible Dialog, Tooltip, Slider, Tabs, ToggleGroup and Popover (focus management, ARIA, keyboard) | All interactive controls, styled only with `design-system/tokens.css` | No default theme: our visual identity stays ours (§31). |
| 13 | **IBM Carbon**, https://github.com/carbon-design-system/carbon | Apache-2.0 | A token methodology (primitives → semantic roles → themes), a "productive" type scale for dense UI, data-viz colour guidance | The structure of `design-system/tokens.css` | Our own palette: Okabe–Ito categories and cividis for magnitude. |
| 14 | **U.S. Web Design System**, https://github.com/uswds/uswds | Mostly public domain; some parts Apache-2.0 (LICENSE.md) | Focus-state, contrast and plain-language guidance | A visible 2 px focus ring on every control; plain-language copy in Simple mode | – |
| 15 | **Inter** (https://github.com/rsms/inter) and **IBM Plex** (https://github.com/IBM/plex) | OFL-1.1 (both) | Typefaces for UI text and tabular numerals | Self-hosted fonts, so the demo works offline; OFL allows bundling | – |

## 2. Principles we take from the study

1. **One time, many views** (Open MCT, Cesium). Dragging the calendar cursor moves the Sun in the sky dome, re-lights the hillshade and updates the card, all from one store.
2. **State is shareable** (Worldview). A decision is a URL plus an export file; both reproduce the same numbers.
3. **Compare, don't flip** (Worldview A/B, OpenLayers swipe). Nominal and robust are shown together, never on separate pages.
4. **Legend at the point of use** (kepler.gl). Every heatmap has its ramp, units and definition beside it.
5. **Status is ambient** (Open MCT indicators). Data freshness, offline state and frame are always visible without opening a panel.
6. **Physics decides the visuals.** A black lunar sky, the real Sun azimuth for relief shading, and cividis for magnitude. No decorative atmosphere, glow or particles.
7. **Accessible primitives, custom skin** (Radix + our tokens).

## 3. Differentiation from rival Challenge-4 tools

`top3_phase2/penumbra/competition_and_judges.md` reviews 11 public repositories. Several already have:
- a terrain horizon, a flat/terrain toggle and a 3-D sky view;
- site comparison and 5 m tiles.

The layout must therefore put the **landing-uncertainty map, the robust aim and validation** first. The sky view goes in the secondary tab (§27).

## 4. Visual study (screenshots, 29 Sep 2026)

**How:**
- Opened in Playwright Chromium at 1600×900, one page at a time.
- The screenshots are kept only in the session scratchpad for internal study; third-party UI images are not added to the workspace.
- The two lunar portals are closed-source, so they are visual references only, with no code or assets.

| UI | What we saw | Take | Avoid |
|---|---|---|---|
| **NASA Worldview**, antarctic projection (https://worldview.earthdata.nasa.gov/?p=antarctic) | Top-left layer panel grouped as "Reference" and "Base layers". Each row has an eye toggle, the layer name and, beneath it, **the source in italics ("Terra / MODIS") plus a version badge ("v6.1 NRT")**. A full-width bottom timeline with a large date readout ("2026 SEP 28"), per-field up/down steppers, prev/next arrows, an interval chip ("1 DAY") and a zoomable axis. Map tools stacked on the right edge (zoom, **rotation reset for polar views**, share, snapshot, info). "Start Comparison" is a first-class button. **Data gaps render as honest black wedges.** | Source and version under every layer name (provenance at the point of use). Step arrows plus an interval chip for landing dates. Rotation reset on the polar map. Show "no data / outside 5 m coverage" explicitly instead of hiding it. | A second sidebar for tools; everything lives in one panel. |
| **LROC QuickMap** (ACT). The old address https://quickmap.lroc.asu.edu/ now shows a notice that the site has moved to **https://quickmap.lroc.im-ldi.com** | Dark UI, a slim left icon rail (globe, layers, markers, settings, fullscreen), a search box, and **a bottom status strip with LAT, LON and RES (m/px) in monospace**, plus an "Accuracy" control. | A cursor readout strip: x/y (m), lat/lon, the DEM resolution under the cursor, and the heatmap value under the cursor. Monospace figures. | The modal announcement on load. |
| **NASA Moon Trek** (https://trek.nasa.gov/moon/) | A full-screen global mosaic behind a **"Welcome to Moon Trek" tutorial modal that blocks the map on first load**. Corner icon clusters; a small scale bar. | A calm, black stage for lunar imagery. | **Any blocking modal on load.** The judged demo must open straight onto the map, with optional help on demand. |
| **OpenLayers "Shaded Relief (with WebGL)"** example | Three plain sliders (vertical exaggeration, sun elevation, sun azimuth) re-light the terrain instantly on the GPU. | Confirms the pattern: the hillshade's sun direction can follow the *real* Sun at the cursor time, and style variables update without a server round trip. | Default browser sliders; ours use the design-system slider. |

**Layout decision after the study** (feeds IMPLEMENTATION_PLAN §5):
- A **left map area** with a small layer list (Worldview style, with source and version under each layer) and **right-edge map tools**, including a polar rotation reset.
- The **mission card on the right**.
- A **full-width calendar strip at the bottom** that also acts as the time scrubber (Worldview's timeline plus Open MCT's single time state).
- A **monospace status strip** (the QuickMap pattern) in the map's bottom-left.
- **No modal on load.**
