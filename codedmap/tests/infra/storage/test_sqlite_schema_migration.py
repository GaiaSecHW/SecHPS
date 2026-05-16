"""
Tests for GAP-5: SqliteDatabase schema migration for legacy databases.

When a pre-existing SQLite database (e.g., from a gzip import) is opened,
_init_db_schema() must detect missing columns (semantic_slot, semantic_value)
and add them via ALTER TABLE, so that INSERT with 7 columns succeeds.
"""

import sqlite3
import pytest

from codedmap.infra.storage.driver_sqlite.store import SqliteDatabase


def _create_legacy_db(db_path: str):
    """
    Create a legacy 5-column edges DB that lacks semantic_slot / semantic_value.
    This simulates a database created before the semantic columns were added.
    """
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE nodes (
            id INTEGER PRIMARY KEY,
            label TEXT NOT NULL,
            properties TEXT
        )
    """)
    conn.execute("CREATE INDEX idx_nodes_label ON nodes(label)")
    conn.execute("""
        CREATE TABLE edges (
            src INTEGER NOT NULL,
            dst INTEGER NOT NULL,
            type TEXT NOT NULL,
            properties TEXT,
            created_by TEXT DEFAULT 'static',
            UNIQUE(src, dst, type)
        )
    """)
    conn.execute("CREATE INDEX idx_edges_src_type ON edges(src, type)")
    conn.execute("CREATE INDEX idx_edges_dst_type ON edges(dst, type)")
    conn.execute("CREATE INDEX idx_edges_cleanup ON edges(created_by, type)")

    # Insert some legacy data
    conn.execute("INSERT INTO nodes (id, label, properties) VALUES (1, 'METHOD', '{\"name\": \"main\"}')")
    conn.execute("INSERT INTO nodes (id, label, properties) VALUES (2, 'METHOD', '{\"name\": \"helper\"}')")
    conn.execute("INSERT INTO edges (src, dst, type, properties, created_by) VALUES (1, 2, 'CALL', NULL, 'static')")
    conn.commit()
    conn.close()


def test_migration_adds_semantic_columns_to_legacy_db(tmp_path):
    """Opening a legacy DB should auto-add semantic_slot and semantic_value columns."""
    db_path = str(tmp_path / "legacy.db")
    _create_legacy_db(db_path)

    # Verify the legacy DB lacks the columns
    conn = sqlite3.connect(db_path)
    cursor = conn.execute("PRAGMA table_info(edges)")
    columns_before = {row[1] for row in cursor.fetchall()}
    conn.close()
    assert "semantic_slot" not in columns_before
    assert "semantic_value" not in columns_before

    # Opening with SqliteDatabase should trigger migration
    db = SqliteDatabase(db_path)

    # Verify columns now exist
    conn = sqlite3.connect(db_path)
    cursor = conn.execute("PRAGMA table_info(edges)")
    columns_after = {row[1] for row in cursor.fetchall()}
    conn.close()
    assert "semantic_slot" in columns_after
    assert "semantic_value" in columns_after


def test_migrated_db_accepts_7_column_insert(tmp_path):
    """After migration, INSERT with 7 columns (including semantic_slot/value) should work."""
    db_path = str(tmp_path / "legacy2.db")
    _create_legacy_db(db_path)

    # Trigger migration
    db = SqliteDatabase(db_path)

    # Insert an edge with 7 columns (the format used by merge_graph)
    conn = db.get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            "INSERT OR IGNORE INTO edges (src, dst, type, properties, created_by, semantic_slot, semantic_value) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (1, 2, "DDG", '{"variable": "x"}', "static", "variable", "x"),
        )
        conn.commit()

        # Verify the edge was inserted
        row = conn.execute(
            "SELECT src, dst, type, semantic_slot, semantic_value FROM edges WHERE type='DDG'"
        ).fetchone()
        assert row is not None
        assert row["src"] == 1
        assert row["dst"] == 2
        assert row["semantic_slot"] == "variable"
        assert row["semantic_value"] == "x"
    finally:
        conn.close()


def test_legacy_data_preserved_after_migration(tmp_path):
    """Migration should preserve existing rows — new columns get NULL for old rows."""
    db_path = str(tmp_path / "legacy3.db")
    _create_legacy_db(db_path)

    db = SqliteDatabase(db_path)

    conn = db.get_connection()
    try:
        row = conn.execute(
            "SELECT src, dst, type, semantic_slot, semantic_value FROM edges WHERE type='CALL'"
        ).fetchone()
        assert row is not None
        assert row["src"] == 1
        assert row["dst"] == 2
        assert row["semantic_slot"] is None
        assert row["semantic_value"] is None
    finally:
        conn.close()


def test_migration_is_idempotent(tmp_path):
    """Opening the same DB twice should not fail — migration is a no-op the second time."""
    db_path = str(tmp_path / "legacy4.db")
    _create_legacy_db(db_path)

    # First open — triggers migration
    db1 = SqliteDatabase(db_path)
    # Second open — should detect columns already exist, no error
    db2 = SqliteDatabase(db_path)

    conn = db2.get_connection()
    try:
        cursor = conn.execute("PRAGMA table_info(edges)")
        columns = {row[1] for row in cursor.fetchall()}
        assert "semantic_slot" in columns
        assert "semantic_value" in columns
    finally:
        conn.close()


def test_fresh_db_has_semantic_columns(tmp_path):
    """A brand-new DB (no legacy tables) should have semantic columns from the start."""
    db_path = str(tmp_path / "fresh.db")
    db = SqliteDatabase(db_path)

    conn = db.get_connection()
    try:
        cursor = conn.execute("PRAGMA table_info(edges)")
        columns = {row[1] for row in cursor.fetchall()}
        assert "semantic_slot" in columns
        assert "semantic_value" in columns
    finally:
        conn.close()
