"""AMPS API — v0.2: DB-backed (PostgreSQL, SQLite fallback for instant demo)."""
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import assets, maintenance, qr, roster
from app.db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="AMPS — Asset Maintenance & Preventive Scheduling",
    description="Open-source maintenance management for electrical & industrial assets.",
    version="0.2.0",
    contact={"name": "Arup Biswas"},
    license_info={"name": "MIT"},
    lifespan=lifespan,
)

app.include_router(assets.router, prefix="/api/assets", tags=["assets"])
app.include_router(maintenance.router, prefix="/api/maintenance", tags=["maintenance"])
app.include_router(qr.router, prefix="/api/qr", tags=["qr"])
app.include_router(roster.router, prefix="/api/roster", tags=["roster"])


@app.get("/")
def root():
    return {"app": "AMPS", "version": "0.2.0", "status": "db-backed"}
