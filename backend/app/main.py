"""AMPS API — v0.1 skeleton."""
from fastapi import FastAPI

from app.api import assets, maintenance, qr

app = FastAPI(
    title="AMPS — Asset Maintenance & Preventive Scheduling",
    description="Open-source maintenance management for electrical & industrial assets.",
    version="0.1.0",
    contact={"name": "Arup Biswas"},
    license_info={"name": "MIT"},
)

app.include_router(assets.router, prefix="/api/assets", tags=["assets"])
app.include_router(maintenance.router, prefix="/api/maintenance", tags=["maintenance"])
app.include_router(qr.router, prefix="/api/qr", tags=["qr"])


@app.get("/")
def root():
    return {"app": "AMPS", "version": "0.1.0", "status": "skeleton"}
