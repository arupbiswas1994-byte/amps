"""Asset register endpoints — v0.2, DB-backed."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import current_user, optional_user, scope_location_ids
from app.db import audit, get_db
from app.models import Asset, AssetClass, AssetStatus, Criticality, Location, LocationKind, WorkOrder

router = APIRouter()


class AssetIn(BaseModel):
    code: str
    name: str
    asset_class: str
    location: str
    make_model: str | None = None
    criticality: str = "B"  # A / B / C
    system: str | None = None  # reporting rollup, e.g. "Traction / PS"
    status: str = "in_service"
    line: str | None = None  # parent site in the location tree, e.g. "Green Line"


class AssetOut(AssetIn):
    id: int


def _to_out(a: Asset) -> AssetOut:
    return AssetOut(
        id=a.id, code=a.code, name=a.name,
        asset_class=a.asset_class.name, location=a.location.name,
        make_model=a.make_model, status=a.status.value,
        criticality=a.criticality.value, system=a.system,
        line=a.location.parent.name if a.location.parent else None,
    )


def _get_or_create_class(db: Session, name: str) -> AssetClass:
    obj = db.scalar(select(AssetClass).where(AssetClass.name == name))
    if not obj:
        obj = AssetClass(name=name)
        db.add(obj)
        db.flush()
    return obj


def _get_or_create_location(db: Session, name: str, line: str | None = None) -> Location:
    obj = db.scalar(select(Location).where(Location.name == name))
    if not obj:
        obj = Location(name=name, kind=LocationKind.STATION)
        db.add(obj)
        db.flush()
    if line and obj.parent is None:
        site = db.scalar(select(Location).where(Location.name == line))
        if not site:
            site = Location(name=line, kind=LocationKind.SITE)
            db.add(site)
            db.flush()
        obj.parent_id = site.id
        db.flush()
    return obj


def visible_asset(db: Session, code: str, user) -> Asset:
    """The asset, if it exists inside the user's scope — else 404 (unscoped
    users see everything). Shared by every router that references assets."""
    obj = db.scalar(select(Asset).where(Asset.code == code))
    scope = scope_location_ids(db, user)
    if not obj or (scope is not None and obj.location_id not in scope):
        raise HTTPException(404, "asset not found")
    return obj


@router.get("", response_model=list[AssetOut])
def list_assets(db: Session = Depends(get_db), user=Depends(optional_user)):
    q = select(Asset)
    scope = scope_location_ids(db, user)
    if scope is not None:
        q = q.where(Asset.location_id.in_(scope))
    return [_to_out(a) for a in db.scalars(q).all()]


@router.post("", response_model=AssetOut, status_code=201)
def create_asset(asset: AssetIn, db: Session = Depends(get_db), user=Depends(current_user)):
    if db.scalar(select(Asset).where(Asset.code == asset.code)):
        raise HTTPException(409, f"asset code {asset.code} already exists")
    if user.line_id is not None:
        my_line = db.get(Location, user.line_id).name
        if asset.line and asset.line != my_line:
            raise HTTPException(403, f"your account manages {my_line} only")
        asset.line = my_line  # scoped users always register into their own line
    obj = Asset(
        code=asset.code, name=asset.name, make_model=asset.make_model,
        criticality=Criticality(asset.criticality),
        system=asset.system, status=AssetStatus(asset.status),
        asset_class=_get_or_create_class(db, asset.asset_class),
        location=_get_or_create_location(db, asset.location, asset.line),
    )
    db.add(obj)
    db.flush()
    audit(db, "asset", obj.id, "created", detail=f"code={obj.code}", actor=user.username)
    db.commit()
    db.refresh(obj)
    return _to_out(obj)


@router.get("/{code}", response_model=AssetOut)
def get_asset(code: str, db: Session = Depends(get_db), user=Depends(optional_user)):
    return _to_out(visible_asset(db, code, user))


class HistoryItem(BaseModel):
    work_order_id: int
    type: str
    status: str
    title: str
    findings: str | None
    done_by: str | None
    closed_at: str | None


@router.get("/{code}/history", response_model=list[HistoryItem])
def asset_history(code: str, db: Session = Depends(get_db), user=Depends(optional_user)):
    """The asset's history card — every work order, newest first.
    This is the screen a supervisor opens after scanning the QR tag."""
    obj = visible_asset(db, code, user)
    orders = db.scalars(
        select(WorkOrder).where(WorkOrder.asset_id == obj.id)
        .order_by(WorkOrder.opened_at.desc())
    ).all()
    return [HistoryItem(
        work_order_id=w.id, type=w.type.value, status=w.status.value,
        title=w.title, findings=w.findings, done_by=w.assigned_to,
        closed_at=w.closed_at.isoformat() if w.closed_at else None,
    ) for w in orders]
