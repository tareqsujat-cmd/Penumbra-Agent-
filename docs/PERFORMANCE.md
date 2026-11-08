# Performance

Measured with `python scripts/benchmark.py` on AMD64 Family 25 Model 97 Stepping 2, AuthenticAMD, 16 logical CPUs, Windows 11 (median of several runs, warm caches
unless stated). Targets from Instructions §44: interactions near-instant when cached, risk update < 1-2 s, progress
shown above 2 s.

## Science kernels

| Operation | Time |
|---|---|
| One terrain horizon (720 azimuths x 3,450 samples, 5 m + LOLA to 300 km) | 5.8 ms |
| 256 horizons (parallel over 16 threads) | 1004.6 ms |
| Site grid cr1 (19,881 points, precomputed once and cached) | 97.8 s |
| Site grid shk (19,881 points, precomputed once and cached) | 94.1 s |
| Site grid mal (3,249 points, precomputed once and cached) | 15.1 s |
| Site grid mou (3,249 points, precomputed once and cached) | 13.5 s |
| Site grid nob (3,249 points, precomputed once and cached) | 16.1 s |
| Annual metrics on the Connecting Ridge grid (19,881 points x 8,760 h) | 835.5 ms |
| 30-day window metrics on the same grid | 70.1 ms |
| Robust-aim search (6,361 candidates x 2,000 touchdowns) | 16.5 ms |
| Landing-risk statistics (2,000 touchdowns) | 1.9 ms |

## HTTP (end to end through FastAPI)

| Request | Time |
|---|---|
| GET /api/sites/cr1 (cached bundle) | 48.8 ms |
| POST /api/landing-risk | 5.9 ms |
| POST /api/robust-aim | 50.7 ms |
| POST /api/visibility (new date, 30 d) | 9.2 ms |
| POST /api/compare (3 sites, new date) | 216.1 ms |

## Browser

- Planner ready (site bundle loaded, mission card drawn): 315 ms
- First 3-D terrain frame after that: 46 ms

The time slider and date stepper call `/api/visibility` with a new window each time (about 10 ms);
uncertainty sliders are debounced (220 ms) so one request is sent when the hand stops.
