"""Browser journeys (Instructions §42) against a running server: python tasks.py dev (or set PENUMBRA_URL)."""
import os
from pathlib import Path
from urllib.parse import urlparse

import pytest

BASE = os.environ.get("PENUMBRA_URL", "http://127.0.0.1:4173")
SHOTS = Path(__file__).resolve().parents[2] / "screenshots" / "e2e"


@pytest.fixture(scope="session")
def browser():
    from playwright.sync_api import sync_playwright
    try:
        import urllib.request
        urllib.request.urlopen(BASE + "/api/health", timeout=5)
    except Exception:  # noqa: BLE001
        pytest.skip(f"no Penumbra server at {BASE} (start it with: python tasks.py dev)")
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        yield b
        b.close()


class Session:
    def __init__(self, page):
        self.page = page
        self.errors: list[str] = []
        self.external: list[str] = []
        host = urlparse(BASE).hostname
        page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: self.errors.append(str(e)))
        page.on("request", lambda r: self.external.append(r.url) if urlparse(r.url).hostname not in (host, None) and not r.url.startswith("data:") else None)

    def shot(self, name: str):
        SHOTS.mkdir(parents=True, exist_ok=True)
        vp = self.page.viewport_size
        self.page.screenshot(path=str(SHOTS / f"{name}_{vp['width']}x{vp['height']}.png"), timeout=120000)


@pytest.fixture
def session(browser, request):
    size = getattr(request, "param", (1920, 1080))
    page = browser.new_page(viewport={"width": size[0], "height": size[1]})
    s = Session(page)
    yield s
    page.close()
    assert not s.errors, f"browser errors: {s.errors[:5]}"
    assert not s.external, f"requests left the local machine: {s.external[:5]}"
