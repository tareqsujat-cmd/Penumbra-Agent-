"""Power scenario / energy endurance estimate (Instructions §23; IMPLEMENTATION_PLAN §3.8). Secondary to geometry.

Vertical panels:  P(t) = sum_panels P_rated * f(t) * max(0, cos(E_sun) cos(A_sun - A_panel))
Hourly balance:   B(t+1) = clip(B(t) + (P_solar - P_load) * 1 h, 0, B_max)
The load drops to the hibernation value once the battery reaches the usable reserve and returns to the operating
load once it has recovered 10% of capacity above it.
This simplified energy model is not a thermal or electrical mission simulation; outputs are called an
"energy endurance estimate", never mission life or survival.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Vehicle:
    panels: list[tuple[float, float]]  # (azimuth offset from heading, deg; rated W)
    battery_wh: float
    base_load_w: float
    hibernate_w: float
    reserve_pct: float


def panel_power(v: Vehicle, sun_az: np.ndarray, sun_el: np.ndarray, frac: np.ndarray, heading_deg: float) -> np.ndarray:
    el = np.radians(sun_el)
    p = np.zeros_like(frac, dtype=float)
    for off, watts in v.panels:
        daz = np.radians(sun_az - (heading_deg + off))
        p += watts * frac * np.maximum(0.0, np.cos(el) * np.cos(daz))
    return p


def energy_balance(v: Vehicle, p_in: np.ndarray) -> dict:
    n = p_in.shape[0]
    soc = np.empty(n)
    hib = np.zeros(n, dtype=np.uint8)
    b = v.battery_wh
    reserve = v.reserve_pct / 100.0 * v.battery_wh
    hibernating = False
    depleted = None
    for k in range(n):
        if b <= reserve:
            hibernating = True
        elif b > reserve + 0.1 * v.battery_wh:
            hibernating = False
        b = min(v.battery_wh, max(0.0, b + p_in[k] - (v.hibernate_w if hibernating else v.base_load_w)))
        soc[k] = b / v.battery_wh
        hib[k] = 1 if hibernating else 0
        if b <= 0.0 and depleted is None:
            depleted = k
    return {"soc": soc, "hibernating": hib, "depleted_at": depleted,
            "endurance_days": None if depleted is None else depleted / 24.0}
