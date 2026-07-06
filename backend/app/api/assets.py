"""Asset register endpoints — v0.2, DB-backed."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Asset, AssetClass, Location, LocationKind

router = APIRouter()


class AssetIn(BaseModel):
    code: str
    name: str
    asset_class: str
    location: str
    make_model: str | None = None


class AssetOut(AssetIn):
    id: int
    status: str = "in_service"


def _to_out(a: Asset) -> AssetOut:
    return AssetOut(
        id=a.id, code=a.code, name=a.name,
        asset_class=a.asset_class.name, location=a.location.name,
        make_model=a.make_model, status=a.status.value,
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
        asset_class=_get_or_create_class(db, asset.asset_class),
        location=_get_or_create_location(db, asset.location),
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _to_out(obj)


@router.get("/{code}", response_model=AssetOut)
def get_asset(code: str, db: Session = Depends(get_db)):
    obj = db.scalar(select(Asset).where(Asset.code == code))
    if not obj:
        raise HTTPException(404, "asset not found")
    return _to_out(obj)
