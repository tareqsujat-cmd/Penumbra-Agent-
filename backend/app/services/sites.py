"""Site registry. Centres and reference points are VERIFIED values from the cited sources."""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np

from ..science import coordinates as C
from ..science.errors import UnknownSite
from ..science.horizon import TerrainStack
from ..science.terrain import ldem80, ldem240, load_pgda78

GRID_HALF = 700.0  # m: half-width of the local performance grid and of the 5 m terrain window


@dataclass(frozen=True)
class Site:
    id: str
    name: str
    short: str
    tile: str  # NASA PGDA 78 tile with the 5 m terrain
    lat: float
    lon: float
    centre_source: str
    note: str
    grid_dx: float  # m: performance-grid spacing (10 m at the hero sites, 25 m elsewhere)
    clones: bool
    known: tuple = field(default_factory=tuple)  # (label, lat, lon, source)

    @property
    def xy(self) -> tuple[float, float]:
        x, y = C.ll_to_ps(self.lat, self.lon)
        return float(x), float(y)


GLASER = "Gläser et al. (2018), Planetary and Space Science 162, 170-178, Table 2 (2 m above ground, 2017-2037)"

SITES: dict[str, Site] = {s.id: s for s in [
    Site("cr1", "Connecting Ridge", "CR1", "Site01", -89.45, 222.69,
         "Mazarico et al. (2011) CR1, as listed in Gläser et al. (2018) Table 1",
         "Best-lit ridge between Shackleton and de Gerlache (PGDA 78 Site01)", 10.0, True,
         (("Gläser et al. (2018) best point, 2 m", -89.4398, 222.83, GLASER),)),
    Site("shk", "Shackleton rim", "SHK", "Site04", -89.78, 204.27,
         "Mazarico et al. (2011) S, as listed in Gläser et al. (2018) Table 1",
         "Shackleton crater rim (PGDA 78 Site04)", 10.0, True,
         (("Gläser et al. (2018) point S, 2 m", -89.7815, 204.70, GLASER),)),
    Site("mal", "Malapert massif", "MAL", "Site23", *C.ps_to_ll(-500.0, 121500.0),
         "Centre of NASA PGDA 78 tile Site23 (Barker et al. 2021)",
         "Earth-facing massif near 86 S (PGDA 78 Site23)", 25.0, False),
    Site("mou", "Mons Mouton / Leibnitz β", "MOU", "Site20", *C.ps_to_ll(73000.0, 118000.0),
         "Centre of NASA PGDA 78 tile Site20 (Barker et al. 2021)",
         "Leibnitz beta plateau; a proxy for the Griffin-1 region (no official landing coordinates are published)",
         25.0, False),
    Site("nob", "Nobile rim 1", "NOB", "Site06", *C.ps_to_ll(84000.0, 110000.0),
         "Centre of NASA PGDA 78 tile Site06 (Barker et al. 2021)",
         "Rim of Nobile crater (PGDA 78 Site06)", 25.0, False),
]}


def get(site_id: str) -> Site:
    try:
        return SITES[site_id]
    except KeyError:
        raise UnknownSite(f"unknown site {site_id!r}", known=list(SITES)) from None


@lru_cache(maxsize=8)
def stack(site_id: str, clone: int | None = None) -> TerrainStack:
    s = get(site_id)
    return TerrainStack(load_pgda78(s.tile, "surf", clone), ldem80(), ldem240())


def grid_axes(site_id: str) -> tuple[np.ndarray, np.ndarray]:
    """Offsets (m) of the performance-grid columns (x) and rows (y, ascending) from the site centre."""
    s = get(site_id)
    k = int(round(GRID_HALF / s.grid_dx))
    ax = np.arange(-k, k + 1) * s.grid_dx
    return ax, ax.copy()
