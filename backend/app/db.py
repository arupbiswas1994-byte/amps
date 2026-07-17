# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

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
