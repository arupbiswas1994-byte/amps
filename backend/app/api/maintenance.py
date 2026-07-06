"""Preventive-maintenance endpoints — v0.2: live due-date engine."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.engine import next_due, overdue_days
from app.models import Asset, PMSchedule

router = APIRouter()


class PMDueItem(BaseModel):
    schedule_id: int
    asset_code: str
    task: str
    next_due: date
    overdue_days: int


def due_query(db: Session, horizon_days: int = 0) -> list[PMDueItem]:
    """All PM items due within `horizon_days` of today (0 = due/overdue now)."""
    today = date.today()
    items: list[PMDueItem] = []
    for sched in db.scalars(select(PMSchedule)).all():
        due = sched.next_due or next_due(sched.frequency.value, sched.last_done)
        if (due - today).days <= horizon_days:
            asset = db.get(Asset, sched.asset_id)
            items.append(PMDueItem(
                schedule_id=sched.id, asset_code=asset.code, task=sched.task,
                next_due=due, overdue_days=overdue_days(due, today),
            ))
    return sorted(items, key=lambda i: i.next_due)


@router.get("/due", response_model=list[PMDueItem])
def due_list(horizon_days: int = 0, db: Session = Depends(get_db)):
    """PM items due/overdue — the daily planning list."""
    return due_query(db, horizon_days)


@router.post("/complete/{schedule_id}", response_model=PMDueItem)
def complete_pm(schedule_id: int, db: Session = Depends(get_db)):
    """Mark a PM task done today; the due date rolls forward by its frequency."""
    sched = db.get(PMSchedule, schedule_id)
    if not sched:
        raise HTTPException(404, "schedule not found")
    sched.last_done = date.today()
    sched.next_due = next_due(sched.frequency.value, sched.last_done)
    db.commit()
    asset = db.get(Asset, sched.asset_id)
    return PMDueItem(
        schedule_id=sched.id, asset_code=asset.code, task=sched.task,
        next_due=sched.next_due, overdue_days=0,
    )
