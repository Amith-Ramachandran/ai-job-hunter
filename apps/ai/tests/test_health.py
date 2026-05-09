"""Smoke tests for the health endpoints.
Keeps the test wiring exercised even before real AI logic exists.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_live_returns_ok() -> None:
    res = client.get("/health/live")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_ready_returns_ok() -> None:
    res = client.get("/health/ready")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
