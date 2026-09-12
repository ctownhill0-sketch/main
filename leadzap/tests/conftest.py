"""Shared pytest fixtures. Ensures leadzap/ is importable regardless of
the directory pytest is invoked from, and gives every test an isolated,
throwaway SQLite database -- never the real leadzap.db."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

import db as db_module


@pytest.fixture
def db(tmp_path, monkeypatch):
    """The real db module, pointed at a fresh temp-file database for
    this test only. Yields the module itself so tests read naturally:
    db.upsert_lead(...), db.get_leads(), etc."""
    db_path = str(tmp_path / "test_leadzap.db")
    monkeypatch.setattr(db_module, "DB_PATH", db_path)
    db_module.init_db()
    yield db_module
