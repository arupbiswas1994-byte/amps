"""Asset register endpoints — v0.2, DB-backed."""
import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import current_user, optional_user, scope_location_ids
from app.db import audit, get_db
from app.models import Asset, AssetClass, AssetStatus, Criticality, Location, LocationKind, WorkOrder

router = APIRouter()

# Mounted at /api/lines — the landing page's public directory of sites.
lines_router = APIRouter()


class LineOut(BaseModel):
    name: str
    stations: int
    assets: int
    initiator: bool  # the first site registered — where the system began


@lines_router.get("", response_model=list[LineOut])
def list_lines(db: Session = Depends(get_db)):
    """Every SITE in the location tree (e.g. each metro line), with counts.
    Creation order — the first site is the deployment's initiator and leads
    the landing page. Public: this is the walk-up surface."""
    out = []
    sites = db.scalars(select(Location).where(Location.kind == LocationKind.SITE)
                       .order_by(Location.id)).all()
    for i, site in enumerate(sites):
        child_ids = [c.id for c in site.children]
        n_assets = 0
        if child_ids:
            n_assets = len(db.scalars(select(Asset.id).where(Asset.location_id.in_(child_ids))).all())
        out.append(LineOut(name=site.name, stations=len(child_ids),
                           assets=n_assets, initiator=(i == 0)))
    return out


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


def _create_one(db: Session, asset: AssetIn, user) -> Asset:
    """Shared by single create and bulk import — same validation, same audit."""
    if db.scalar(select(Asset).where(Asset.code == asset.code)):
        raise HTTPException(409, f"asset code {asset.code} already exists")
    if user.line_id is not None:
        my_line = db.get(Location, user.line_id).name
        if asset.line and asset.line != my_line:
            raise HTTPException(403, f"your account manages {my_line} only")
        asset.line = my_line  # scoped users always register into their own line
    try:
        crit = Criticality(asset.criticality)
        status = AssetStatus(asset.status)
    except ValueError as e:
        raise HTTPException(422, str(e))
    obj = Asset(
        code=asset.code, name=asset.name, make_model=asset.make_model,
        criticality=crit, system=asset.system, status=status,
        asset_class=_get_or_create_class(db, asset.asset_class),
        location=_get_or_create_location(db, asset.location, asset.line),
    )
    db.add(obj)
    db.flush()
    audit(db, "asset", obj.id, "created", detail=f"code={obj.code}", actor=user.username)
    return obj


@router.post("", response_model=AssetOut, status_code=201)
def create_asset(asset: AssetIn, db: Session = Depends(get_db), user=Depends(current_user)):
    obj = _create_one(db, asset, user)
    db.commit()
    db.refresh(obj)
    return _to_out(obj)


# ---- bulk import: the sheet-to-register bridge -----------------------------
# Every line fills the same CSV (the Green Line format is the standard);
# supervisors download the sample, fill it for their line, upload it back.

SAMPLE_CSV = """code,name,asset_class,location,line,system,make_model,criticality
B2HB11,VCB,33KV SWITCHGEAR,Baranagar,Blue Line,HT · 33kV,"SIEMENS LTD.,INDIA",A
LP-C-01(BARA),Concourse Light Panel,DISTRIBUTION BOARD,Baranagar,Blue Line,LT · LT Panels,,B
AHU-M1(BARA),AHU Unit 1,ECS- AXIAL FLOW FAN,Baranagar,Blue Line,LT · ECS (AC),M/S VOLTAS,B
"""

REQUIRED_COLS = ("code", "name", "asset_class", "location")
OPTIONAL_COLS = ("line", "system", "make_model", "criticality", "status")


@router.get("/import/sample")
def import_sample():
    """The standard register template — one row per asset, any line."""
    return Response(SAMPLE_CSV, media_type="text/csv", headers={
        "Content-Disposition": 'attachment; filename="amps-asset-register-sample.csv"'})


class ImportOut(BaseModel):
    created: int
    skipped: int
    failed: int
    errors: list[str]  # first errors, "line N: reason"


@router.post("/import", response_model=ImportOut)
async def import_csv(request: Request, db: Session = Depends(get_db),
                     user=Depends(current_user)):
    """Bulk-register assets from a CSV in the standard format.
    Existing codes are skipped, so repeat uploads are safe."""
    text = (await request.body()).decode("utf-8-sig", errors="replace")
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise HTTPException(422, "the CSV has no data rows")
    missing = [c for c in REQUIRED_COLS if c not in (rows[0].keys() or [])]
    if missing:
        raise HTTPException(422, f"missing required columns: {', '.join(missing)}")

    created = skipped = failed = 0
    errors: list[str] = []
    for n, raw in enumerate(rows, start=2):
        fields = {k: (raw.get(k) or "").strip()
                  for k in REQUIRED_COLS + OPTIONAL_COLS if (raw.get(k) or "").strip()}
        empty = [c for c in REQUIRED_COLS if c not in fields]
        if empty:
            failed += 1
            if len(errors) < 20:
                errors.append(f"line {n}: empty required field(s): {', '.join(empty)}")
            continue
        try:
            _create_one(db, AssetIn(**fields), user)
            created += 1
        except HTTPException as e:
            if e.status_code == 409:
                skipped += 1
            else:
                failed += 1
                if len(errors) < 20:
                    errors.append(f"line {n}: {e.detail}")
        except ValidationError as e:
            failed += 1
            if len(errors) < 20:
                errors.append(f"line {n}: {e.errors()[0].get('msg', 'invalid row')}")
    db.commit()
    return ImportOut(created=created, skipped=skipped, failed=failed, errors=errors)


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
