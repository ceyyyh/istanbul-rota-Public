import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
FIXTURES = ROOT / "tests" / "fixtures"


class FakeHttp:
    """URL → yanıt eşlemesiyle ağ kullanmayan Http yerine geçer."""

    def __init__(self, routes: dict):
        self.routes = routes
        self.calls: list[str] = []
        self.request_count = 0

    def _lookup(self, url):
        self.calls.append(url)
        if url in self.routes:
            v = self.routes[url]
        else:
            m = [k for k in self.routes if url.startswith(k)]
            if not m:
                from isilan.http import HttpError
                raise HttpError(url, 404)
            v = self.routes[max(m, key=len)]
        return v() if callable(v) else v

    def get(self, url, **kw):
        v = self._lookup(url)
        return v if isinstance(v, str) else json.dumps(v)

    text = get

    def get_json(self, url, **kw):
        v = self._lookup(url)
        return json.loads(v) if isinstance(v, str) else v

    def post_json(self, url, payload=None, **kw):
        return self.get_json(url)


@pytest.fixture
def fake_http():
    return FakeHttp
