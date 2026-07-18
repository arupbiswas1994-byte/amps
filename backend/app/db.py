"""Database layer — PostgreSQL in production, SQLite fallback for instant demo.

Set DATABASE_URL (e.g. postgresql+psycopg2://user:pass@host/amps); without it
the app runs on a local SQLite file so the demo works out of the box.
"""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./amps.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False)


def init_db():
    Base.metadata.create_all(engine)
    _migrate(engine)


def _migrate(engine):
    """Additive micro-migrations for databases created before a column existed.
    create_all() only creates missing tables, never missing columns."""
    from sqlalchemy import inspect, text

    wanted = {
        "assets": {"system": "VARCHAR(80)"},
        "users": {"password_hash": "VARCHAR(200)", "line_id": "INTEGER"},
        "log_entries": {"line_id": "INTEGER", "subtype": "VARCHAR(40)", "category": "VARCHAR(80)",
                        "ended_at": "TIMESTAMP", "fault_type": "VARCHAR(120)",
                        "rectifies_id": "INTEGER", "attended_by": "VARCHAR(200)"},
    }
    # widen columns that real-world data outgrew (no-op where already wide;
    # SQLite ignores VARCHAR lengths so this only matters on Postgres).
    # Committed in its own transaction BEFORE any inspection — the inspector
    # opens a second connection, which would block on the ALTER's lock.
    if engine.dialect.name == "postgresql":
        widen = {("assets", "code"): "VARCHAR(120)"}
        with engine.begin() as conn:
            for (table, col), ddl in widen.items():
                conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {col} TYPE {ddl}"))
        # the 2026-07 logbook taxonomy: native enum needs the new labels
        # (each in its own autocommitting statement; IF NOT EXISTS = rerun-safe)
        for val in ("MAINTENANCE", "FAILURE", "RECTIFICATION", "GENERAL"):
            with engine.begin() as conn:
                conn.execute(text(
                    f"ALTER TYPE logentrytype ADD VALUE IF NOT EXISTS '{val}'"))

    insp = inspect(engine)
    with engine.begin() as conn:
        for table, columns in wanted.items():
            have = {c["name"] for c in insp.get_columns(table)}
            for col, ddl in columns.items():
                if col not in have:
                    # quote — some column names (e.g. "group") are reserved words
                    conn.execute(text(f'ALTER TABLE {table} ADD COLUMN "{col}" {ddl}'))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def audit(db, entity, entity_id, action, detail=None, actor="system"):
    """Append an audit-trail row inside the caller's transaction
    (committed/rolled back together with the change it records)."""
    from app.models import AuditLog

    db.add(AuditLog(entity=entity, entity_id=entity_id, action=action,
                    detail=detail, actor=actor))
