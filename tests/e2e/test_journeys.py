"""Journeys A-C (Instructions §42) plus the responsive screenshots of §43."""
import re

import pytest

from .conftest import BASE


def pct(text: str) -> float:
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*%", text)
    assert m, f"no percentage in {text!r}"
    return float(m.group(1))


def test_journey_a_connecting_ridge(session):
    pg = session.page
    pg.goto(f"{BASE}/?mode=planner&site=cr1")
    pg.wait_for_selector(".pn-insp__kpis", timeout=90000)
    pg.wait_for_timeout(2500)
    assert "connecting ridge" in pg.inner_text(".pn-insp__title").lower()
    session.shot("A1_site")
    # choose a date: one day later
    before = pg.inner_text(".pn-hdr__date b")
    pg.click("button[aria-label='One day later']")
    pg.wait_for_function("(b) => document.querySelector('.pn-hdr__date b').innerText !== b", arg=before)
    # landing uncertainty +-100 m
    if pg.get_attribute(".pn-switch", "aria-checked") != "true":
        pg.click(".pn-switch")
    pg.wait_for_function("() => /\\d/.test(document.querySelectorAll('.pn-kpi__value')[1]?.innerText || '')", timeout=60000)
    nominal = pct(pg.inner_text(".pn-kpi:nth-child(1) .pn-kpi__value"))
    p10 = pct(pg.inner_text(".pn-kpi:nth-child(2) .pn-kpi__value"))
    assert 0 < p10 <= nominal <= 100
    session.shot("A2_uncertainty")
    # find robust aim
    pg.click(".pn-insp__foot button")
    pg.wait_for_selector(".pn-reveal.is-in", timeout=60000)
    res = pg.inner_text(".pn-robust__result")
    nums = [float(x) for x in re.findall(r"(\d+(?:\.\d+)?)%", res)]
    bright_nom, bright_pq, rob_nom, rob_pq = nums[:4]
    assert rob_pq >= bright_pq and bright_nom >= rob_nom
    assert "not necessarily the safest" in res.lower()  # the reveal line is set in uppercase display type
    session.shot("A3_robust_aim")
    # inspect the timeline: the bands are drawn across the plot (not squeezed into a corner)
    assert pg.locator(".pn-cal__rows rect").count() > 10
    plot_w = pg.evaluate("() => document.querySelector('.pn-cal__rows').getBoundingClientRect().width")
    assert plot_w > 600
    # the skyline view
    pg.click(".pn-views__tabs [role=tab]:has-text('Skyline')")
    pg.wait_for_selector(".pn-sky canvas, .pn-pano", timeout=60000)
    pg.wait_for_timeout(2500)
    session.shot("A4_skyline")


def test_journey_b_simple_shackleton(session):
    pg = session.page
    pg.goto(f"{BASE}/?mode=simple&site=shk")
    pg.wait_for_selector(".pn-simple__card", timeout=90000)
    pg.wait_for_function("() => /\\d+%/.test(document.querySelector('.pn-simple__facts')?.innerText || '') && !/Searching/.test(document.querySelector('.pn-simple__rec')?.innerText || 'Searching')", timeout=60000)
    card = pg.inner_text(".pn-simple__card")
    assert "Shackleton" in card or "SHACKLETON" in card
    assert "Earth geometrically visible" in card
    assert re.search(r"m grid-", pg.inner_text(".pn-simple__rec"))  # recommended aim as an offset
    pg.wait_for_selector(".pn-t3d canvas", timeout=90000)
    pg.wait_for_timeout(2500)
    session.shot("B1_simple_shackleton")


def test_journey_c_compare(session):
    pg = session.page
    pg.goto(f"{BASE}/?mode=planner&site=cr1&view=compare")
    pg.wait_for_selector(".pn-rank li", timeout=120000)
    first = pg.inner_text(".pn-compare__body")
    assert pg.locator(".pn-rank li").count() >= 2
    pg.wait_for_timeout(1500)
    session.shot("C1_compare")
    for _ in range(10):
        pg.click("button[aria-label='One day later']")
    # the comparison is scored on the landing window, so a new date gives new values (and possibly a new order)
    pg.wait_for_function("(t) => document.querySelector('.pn-compare__body')?.innerText !== t && !/computing/.test(document.querySelector('.pn-compare')?.innerText || '')", arg=first, timeout=120000)
    assert pg.locator(".pn-rank li").count() >= 2
    pg.wait_for_timeout(1500)  # dots slide to their new positions
    session.shot("C2_compare_new_date")


@pytest.mark.parametrize("session", [(1440, 900), (834, 1112)], indirect=True)
def test_responsive_screens(session):
    pg = session.page
    for url, name in [("/?mode=planner&site=cr1", "planner"), ("/?mode=simple&site=cr1", "simple"), ("/?mode=planner&site=cr1&view=science", "science")]:
        pg.goto(BASE + url)
        pg.wait_for_selector(".pn-hdr", timeout=90000)
        pg.wait_for_timeout(6000)
        if name != "science":
            pg.wait_for_function("() => document.querySelectorAll('.pn-cal__rows rect').length > 10", timeout=60000)
        session.shot(f"R_{name}")
        overflow = pg.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert overflow <= 1, f"{name}: horizontal overflow {overflow}px"
