"""Test configuration — runs before any test module is imported.

Sets dummy values for required env vars so pydantic-settings can construct
`Settings()` at app-import time. Real values from .env or the shell take
precedence (setdefault only fills gaps).

Why this exists: app.main imports app.config which instantiates Settings()
at module-load. Required fields (OPENAI_API_KEY) would block test collection
if not present. Production keeps the strict validation — that's the right
default for fail-fast.
"""

import os

os.environ.setdefault("OPENAI_API_KEY", "test-key-for-collection-only")
