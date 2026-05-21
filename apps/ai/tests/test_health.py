"""Smoke tests for the health endpoints.

`/health/live` is a pure unit test — no dependencies. `/health/ready` tests
both success and failure paths by mocking the Qdrant client, so CI doesn't
need a real Qdrant container to verify the endpoint logic.
"""

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_live_returns_ok() -> None:
    res = client.get("/health/live")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


@patch("app.routers.health.get_vector_store")
def test_ready_returns_ok_when_qdrant_reachable(mock_get_store: MagicMock) -> None:
    """Happy path — Qdrant responds, so the endpoint returns 200."""
    fake_client = MagicMock()
    fake_client.get_collections = AsyncMock(return_value=None)
    fake_store = MagicMock()
    fake_store._client = fake_client
    mock_get_store.return_value = fake_store

    res = client.get("/health/ready")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


@patch("app.routers.health.get_vector_store")
def test_ready_returns_503_when_qdrant_unreachable(mock_get_store: MagicMock) -> None:
    """Failure path — Qdrant raises, endpoint surfaces 503 with detail."""
    fake_client = MagicMock()
    fake_client.get_collections = AsyncMock(side_effect=ConnectionError("qdrant down"))
    fake_store = MagicMock()
    fake_store._client = fake_client
    mock_get_store.return_value = fake_store

    res = client.get("/health/ready")
    assert res.status_code == 503
    assert res.json()["detail"]["dependency"] == "qdrant"
