# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Preventive-maintenance endpoints — v0.2.1: history-preserving, priority-ranked."""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import audit, get_db
from app.engine import next_due, overdue_days, priority_score
from app.models import Asset, PMSchedule, WorkOrder, WorkOrderStatus, WorkOrderType

router = APIRouter()


class PMDueItem(BaseModel):
    schedule_id: int
    asset_code: str
    criticality: str
    task: str
    next_due: date
    overdue_days: int
    priority: int


def due_query(db: Session, horizon_days: int = 0) -> list[PMDueItem]:
    """All PM items due within `horizon_days` of today (0 = due/overdue now),
    ranked by criticality-weighted priority, not date alone."""
    today = date.today()
    items: list[PMDueItem] = []
    for sched in db.scalars(select(PMSchedule)).all():
        due = sched.next_due or next_due(sched.frequency.value, sched.last_done)
        if (due - today).days <= horizon_days:
            asset = db.get(Asset, sched.asset_id)
            od = overdue_days(due, today)
            items.append(PMDueItem(
                schedule_id=sched.id, asset_code=asset.code,
                criticality=asset.criticality.value, task=sched.task,
                next_due=due, overdue_days=od,
                priority=priority_score(asset.criticality.value, od),
            ))
    return sorted(items, key=lambda i: -i.priority)


@router.get("/due", response_model=list[PMDueItem])
def due_list(horizon_days: int = 0, db: Session = Depends(get_db)):
    """PM items due/overdue — the daily planning list, highest priority first."""
    return due_query(db, horizon_days)


class PMCompletion(BaseModel):
    done_by: str | None = None
    findings: str | None = None


class PMCompleted(BaseModel):
    schedule_id: int
    work_order_id: int
    asset_code: str
    task: str
    next_due: date


@router.post("/complete/{schedule_id}", response_model=PMCompleted)
def complete_pm(schedule_id: int, completion: PMCompletion | None = None,
                db: Session = Depends(get_db)):
    """Mark a PM task done today. Creates a closed preventive WORK ORDER —
    the asset's history record of who did what and what was found — and
    rolls the due date forward by the task's frequency."""
    sched = db.get(PMSchedule, schedule_id)
    if not sched:
        raise HTTPException(404, "schedule not found")
    completion = completion or PMCompletion()
    now = datetime.utcnow()
    wo = WorkOrder(
        asset_id=sched.asset_id, pm_schedule_id=sched.id,
        type=WorkOrderType.PREVENTIVE, status=WorkOrderStatus.DONE,
        title=f"PM: {sched.task}", findings=completion.findings,
        assigned_to=completion.done_by, opened_at=now, closed_at=now,
    )
    db.add(wo)
    sched.last_done = date.today()
    sched.next_due = next_due(sched.frequency.value, sched.last_done)
    db.flush()
    audit(db, "pm_schedule", sched.id, "completed",
          detail=f"work_order={wo.id}; next_due={sched.next_due}",
          actor=completion.done_by or "system")
    db.commit()
    asset = db.get(Asset, sched.asset_id)
    return PMCompleted(schedule_id=sched.id, work_order_id=wo.id,
                       asset_code=asset.code, task=sched.task,
                       next_due=sched.next_due)
