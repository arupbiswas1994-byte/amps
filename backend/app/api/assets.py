"""Asset register endpoints — v0.2, DB-backed."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import audit, get_db
from app.models import Asset, AssetClass, Criticality, Location, LocationKind, WorkOrder

router = APIRouter()


class AssetIn(BaseModel):
    code: str
    name: str
    asset_class: str
    location: str
    make_model: str | None = None
    criticality: str = "B"  # A / B / C


class AssetOut(AssetIn):
    id: int
    status: str = "in_service"


def _to_out(a: Asset) -> AssetOut:
    return AssetOut(
        id=a.id, code=a.code, name=a.name,
        asset_class=a.asset_class.name, location=a.location.name,
        make_model=a.make_model, status=a.status.value,
        criticality=a.criticality.value,
    )


def _get_or_create_class(db: Session, name: str) -> AssetClass:
    obj = db.scalar(select(AssetClass).where(AssetClass.name == name))
    if not obj:
        obj = AssetClass(name=name)
        db.add(obj)
        db.flush()
    return obj


def _get_or_create_location(db: Session, name: str) -> Location:
    obj = db.scalar(select(Location).where(Location.name == name))
    if not obj:
        obj = Location(name=name, kind=LocationKind.STATION)
        db.add(obj)
        db.flush()
    return obj


@router.get("", response_model=list[AssetOut])
def list_assets(db: Session = Depends(get_db)):
    return [_to_out(a) for a in db.scalars(select(Asset)).all()]


@router.post("", response_model=AssetOut, status_code=201)
def create_asset(asset: AssetIn, db: Session = Depends(get_db)):
    if db.scalar(select(Asset).where(Asset.code == asset.code)):
        raise HTTPException(409, f"asset code {asset.code} already exists")
    obj = Asset(
        code=asset.code, name=asset.name, make_model=asset.make_model,
        criticality=Criticality(asset.criticality),
        asset_class=_get_or_create_class(db, asset.asset_class),
        location=_get_or_create_location(db, asset.location),
    )
    db.add(obj)
    db.flush()
    audit(db, "asset", obj.id, "created", detail=f"code={obj.code}")
    db.commit()
    db.refresh(obj)
    return _to_out(obj)


@router.get("/{code}", response_model=AssetOut)
def get_asset(code: str, db: Session = Depends(get_db)):
    obj = db.scalar(select(Asset).where(Asset.code == code))
    if not obj:
        raise HTTPException(404, "asset not found")
    return _to_out(obj)


class HistoryItem(BaseModel):
    work_order_id: int
    type: str
    status: str
    title: str
    findings: str | None
    done_by: str | None
    closed_at: str | None


@router.get("/{code}/history", response_model=list[HistoryItem])
def asset_history(code: str, db: Session = Depends(get_db)):
    """The asset's history card — every work order, newest first.
    This is the screen a supervisor opens after scanning the QR tag."""
    obj = db.scalar(select(Asset).where(Asset.code == code))
    if not obj:
        raise HTTPException(404, "asset not found")
    orders = db.scalars(
        select(WorkOrder).where(WorkOrder.asset_id == obj.id)
        .order_by(WorkOrder.opened_at.desc())
    ).all()
    return [HistoryItem(
        work_order_id=w.id, type=w.type.value, status=w.status.value,
        title=w.title, findings=w.findings, done_by=w.assigned_to,
        closed_at=w.closed_at.isoformat() if w.closed_at else None,
    ) for w in orders]
