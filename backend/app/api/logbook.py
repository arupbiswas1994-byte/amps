# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""Digital shift logbook — v0.3.

Replaces the paper/spreadsheet running log a section keeps per shift.
Design rules:
  * APPEND-ONLY: entries are never edited or deleted. A mistake is corrected
    by a new entry with `corrects_id` pointing at the old one — exactly the
    discipline of a bound paper logbook, kept enforceable by software.
  * Optionally tied to an asset (by code), so scanning a QR tag can show
    everything ever logged against that equipment.
"""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import audit, get_db
from app.models import Asset, LogEntry, LogEntryType, ShiftCode

router = APIRouter()


class LogEntryIn(BaseModel):
    log_date: date
    shift: str = "G"                    # M/E/N/G/R
    type: str = "operation"             # operation/observation/defect/handover
    text: str = Field(min_length=3)
    entered_by: str
    asset_code: str | None = None
    corrects_id: int | None = None


class LogEntryOut(BaseModel):
    id: int
    at: datetime
    log_date: date
    shift: str
    type: str
    text: str
    entered_by: str
    asset_code: str | None
    corrects_id: int | None


def _to_out(e: LogEntry) -> LogEntryOut:
    return LogEntryOut(
        id=e.id, at=e.at, log_date=e.log_date, shift=e.shift.value,
        type=e.type.value, text=e.text, entered_by=e.entered_by,
        asset_code=e.asset.code if e.asset else None, corrects_id=e.corrects_id,
    )


@router.post("", response_model=LogEntryOut, status_code=201)
def add_entry(entry: LogEntryIn, db: Session = Depends(get_db)):
    asset = None
    if entry.asset_code:
        asset = db.scalar(select(Asset).where(Asset.code == entry.asset_code))
        if not asset:
            raise HTTPException(404, f"asset {entry.asset_code} not found")
    if entry.corrects_id and not db.get(LogEntry, entry.corrects_id):
        raise HTTPException(404, "entry to correct not found")
    obj = LogEntry(
        log_date=entry.log_date, shift=ShiftCode(entry.shift),
        type=LogEntryType(entry.type), text=entry.text,
        entered_by=entry.entered_by, asset=asset, corrects_id=entry.corrects_id,
    )
    db.add(obj)
    db.flush()
    audit(db, "log_entry", obj.id, "created",
          detail=f"date={obj.log_date} shift={obj.shift.value}", actor=entry.entered_by)
    db.commit()
    db.refresh(obj)
    return _to_out(obj)


@router.get("", response_model=list[LogEntryOut])
def list_entries(log_date: date | None = None, shift: str | None = None,
                 asset_code: str | None = None, entry_type: str | None = None,
                 limit: int = 200, db: Session = Depends(get_db)):
    """The day's log, a shift's log, or one asset's complete logged history."""
    q = select(LogEntry).order_by(LogEntry.at.desc()).limit(min(limit, 1000))
    if log_date:
        q = q.where(LogEntry.log_date == log_date)
    if shift:
        q = q.where(LogEntry.shift == ShiftCode(shift))
    if entry_type:
        q = q.where(LogEntry.type == LogEntryType(entry_type))
    if asset_code:
        asset = db.scalar(select(Asset).where(Asset.code == asset_code))
        if not asset:
            raise HTTPException(404, f"asset {asset_code} not found")
        q = q.where(LogEntry.asset_id == asset.id)
    return [_to_out(e) for e in db.scalars(q).all()]
