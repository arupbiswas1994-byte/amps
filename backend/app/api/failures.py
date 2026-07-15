"""Failure & recovery endpoints — report a breakdown, close it on recovery,
read the log and the numbers management asks for (count, ongoing, downtime, MTTR)."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import audit, get_db
from app.models import Asset, Failure

router = APIRouter()


class FailureIn(BaseModel):
    asset_code: str
    description: str
    fault_type: str | None = None
    started_at: datetime | None = None  # omitted = now


class FailureClose(BaseModel):
    work_done: str
    attended_by: str | None = None
    ended_at: datetime | None = None  # omitted = now


class FailureOut(BaseModel):
    id: int
    asset_code: str
    asset_name: str
    started_at: datetime
    ended_at: datetime | None
    fault_type: str | None
    description: str
    work_done: str | None
    attended_by: str | None
    downtime_hrs: float | None  # None while ongoing


def _to_out(f: Failure) -> FailureOut:
    downtime = None
    if f.ended_at:
        downtime = round((f.ended_at - f.started_at).total_seconds() / 3600, 1)
    return FailureOut(
        id=f.id, asset_code=f.asset.code, asset_name=f.asset.name,
        started_at=f.started_at, ended_at=f.ended_at, fault_type=f.fault_type,
        description=f.description, work_done=f.work_done,
        attended_by=f.attended_by, downtime_hrs=downtime,
    )


@router.get("", response_model=list[FailureOut])
def list_failures(asset_code: str | None = None, open_only: bool = False,
                  db: Session = Depends(get_db)):
    q = select(Failure).order_by(Failure.started_at.desc())
    if asset_code:
        asset = db.scalar(select(Asset).where(Asset.code == asset_code))
        if not asset:
            raise HTTPException(404, "asset not found")
        q = q.where(Failure.asset_id == asset.id)
    if open_only:
        q = q.where(Failure.ended_at.is_(None))
    return [_to_out(f) for f in db.scalars(q).all()]


@router.post("", response_model=FailureOut, status_code=201)
def report_failure(body: FailureIn, db: Session = Depends(get_db)):
    asset = db.scalar(select(Asset).where(Asset.code == body.asset_code))
    if not asset:
        raise HTTPException(404, f"asset {body.asset_code} not found")
    f = Failure(
        asset_id=asset.id, description=body.description,
        fault_type=body.fault_type,
        started_at=body.started_at or datetime.utcnow(),
    )
    db.add(f)
    db.flush()
    audit(db, "failure", f.id, "reported", detail=f"asset={asset.code}")
    db.commit()
    db.refresh(f)
    return _to_out(f)


@router.post("/{failure_id}/close", response_model=FailureOut)
def close_failure(failure_id: int, body: FailureClose, db: Session = Depends(get_db)):
    f = db.get(Failure, failure_id)
    if not f:
        raise HTTPException(404, "failure not found")
    if f.ended_at:
        raise HTTPException(409, "failure already closed")
    ended = body.ended_at or datetime.utcnow()
    if ended < f.started_at:
        raise HTTPException(422, "recovery cannot precede the failure start")
    f.ended_at = ended
    f.work_done = body.work_done
    f.attended_by = body.attended_by
    audit(db, "failure", f.id, "closed", detail=f"downtime={(ended - f.started_at)}")
    db.commit()
    db.refresh(f)
    return _to_out(f)


class FailureStats(BaseModel):
    window_days: int
    count: int
    ongoing: int
    downtime_hrs: float
    mttr_hrs: float | None  # mean time to restore, closed failures only


@router.get("/stats", response_model=FailureStats)
def failure_stats(window_days: int = 90, db: Session = Depends(get_db)):
    since = datetime.utcnow() - timedelta(days=window_days)
    rows = db.scalars(select(Failure).where(Failure.started_at >= since)).all()
    ongoing = [f for f in rows if f.ended_at is None]
    closed = [f for f in rows if f.ended_at is not None]
    downtime = sum((f.ended_at - f.started_at).total_seconds() for f in closed) / 3600
    mttr = round(downtime / len(closed), 1) if closed else None
    return FailureStats(
        window_days=window_days, count=len(rows), ongoing=len(ongoing),
        downtime_hrs=round(downtime, 1), mttr_hrs=mttr,
    )
