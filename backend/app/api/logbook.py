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

from app.api.assets import visible_asset
from app.api.auth import AUTH_ON, current_user, optional_user
from app.db import audit, get_db
from app.models import Asset, LogEntry, LogEntryType, ShiftCode

router = APIRouter()


class LogEntryIn(BaseModel):
    log_date: date
    shift: str = "G"                    # M/E/N/G/R
    type: str = "operation"             # operation/observation/defect/handover
    text: str = Field(min_length=3)
    entered_by: str = ""                # ignored on authenticated deployments
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
def add_entry(entry: LogEntryIn, db: Session = Depends(get_db), user=Depends(current_user)):
    asset = None
    if entry.asset_code:
        asset = visible_asset(db, entry.asset_code, user)
    if entry.corrects_id and not db.get(LogEntry, entry.corrects_id):
        raise HTTPException(404, "entry to correct not found")
    # Logged-in deployments: authorship comes from the session, never the form.
    author = user.full_name if AUTH_ON else (entry.entered_by or "unknown")
    obj = LogEntry(
        log_date=entry.log_date, shift=ShiftCode(entry.shift),
        type=LogEntryType(entry.type), text=entry.text,
        entered_by=author, asset=asset, corrects_id=entry.corrects_id,
        line_id=user.line_id,  # NULL = department-wide entry (HQ/admin)
    )
    db.add(obj)
    db.flush()
    audit(db, "log_entry", obj.id, "created",
          detail=f"date={obj.log_date} shift={obj.shift.value}", actor=user.username)
    db.commit()
    db.refresh(obj)
    return _to_out(obj)


@router.get("", response_model=list[LogEntryOut])
def list_entries(log_date: date | None = None, shift: str | None = None,
                 asset_code: str | None = None, entry_type: str | None = None,
                 limit: int = 200, db: Session = Depends(get_db), user=Depends(optional_user)):
    """The day's log, a shift's log, or one asset's complete logged history.
    Line-scoped users read their line's book plus department-wide entries."""
    q = select(LogEntry).order_by(LogEntry.at.desc()).limit(min(limit, 1000))
    if user.line_id is not None:
        q = q.where((LogEntry.line_id == user.line_id) | (LogEntry.line_id.is_(None)))
    if log_date:
        q = q.where(LogEntry.log_date == log_date)
    if shift:
        q = q.where(LogEntry.shift == ShiftCode(shift))
    if entry_type:
        q = q.where(LogEntry.type == LogEntryType(entry_type))
    if asset_code:
        asset = visible_asset(db, asset_code, user)
        q = q.where(LogEntry.asset_id == asset.id)
    return [_to_out(e) for e in db.scalars(q).all()]


# ---- bulk history import: scattered sheet logbooks -> one digital book ----
# The unified Green Line CSV format is the standard for every line:
#   kind,type,group,asset_id,station,location,equipment,start,end,
#   fault_type,details,action_taken,attended_by,reported_by,repercussion
# kind=maintenance rows become append-only log entries; kind=failure rows
# become failure records (rows whose asset is not in the register land as
# defect log entries instead, so nothing is lost). Duplicate-safe by content.

import csv as _csv
import io as _io

from fastapi import Request, Response
from sqlalchemy.exc import SQLAlchemyError

from app.models import Failure, Location

LOG_SAMPLE_CSV = """kind,type,group,asset_id,station,location,equipment,start,end,fault_type,details,action_taken,attended_by,reported_by,repercussion
maintenance,YEARLY MAINTENANCE,HT,B2HB11,Baranagar,TSS/ASS,VCB,2026-01-05,2026-01-05,,Maintenance done,,PS Staff,,
failure,FAILURE,HT,B2HB11,Baranagar,TSS/ASS,VCB,2026-02-10 14:30,2026-02-10 16:05,Communication fault,Failure of operation from SCADA,Card replaced and tested,PS Staff,TPC,Supply fed from standby
"""


@router.get("/import/sample")
def logbook_import_sample():
    """The standard logbook template — maintenance and failure rows, any line."""
    return Response(LOG_SAMPLE_CSV, media_type="text/csv", headers={
        "Content-Disposition": 'attachment; filename="amps-logbook-sample.csv"'})


def _parse_dt(s: str) -> datetime | None:
    s = (s or "").strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


class LogImportOut(BaseModel):
    log_entries: int
    failures: int
    skipped: int
    failed: int
    errors: list[str]


@router.post("/import", response_model=LogImportOut)
async def import_history(request: Request, db: Session = Depends(get_db),
                         user=Depends(current_user)):
    text = (await request.body()).decode("utf-8-sig", errors="replace")
    rows = list(_csv.DictReader(_io.StringIO(text)))
    if not rows or "details" not in rows[0] or "start" not in rows[0]:
        raise HTTPException(422, "expected the standard logbook CSV "
                                 "(see /api/logbook/import/sample)")

    # preload once: register codes and already-imported content keys
    assets = {a.code: a for a in db.scalars(select(Asset)).all()}
    have_logs = {(str(e[0]), e[1] or '', e[2]) for e in
                 db.execute(select(LogEntry.log_date, Asset.code, LogEntry.text)
                            .outerjoin(Asset, LogEntry.asset_id == Asset.id)).all()}
    have_fails = {(f[0], f[1] and f[1].isoformat()) for f in
                  db.execute(select(Failure.asset_id, Failure.started_at)).all()}

    n_logs = n_fails = skipped = failed = 0
    errors: list[str] = []
    batch = 0
    for n, r in enumerate(rows, start=2):
        get = lambda k: (r.get(k) or "").strip()
        start = _parse_dt(get("start")) or _parse_dt(get("end"))
        if not start:
            failed += 1
            if len(errors) < 20:
                errors.append(f"line {n}: no usable date")
            continue
        details = get("details") or get("fault_type") or get("type") or "entry"
        asset = assets.get(get("asset_id"))
        is_failure = get("kind").lower() == "failure"
        try:
            if is_failure and asset:
                key = (asset.id, start.isoformat())
                if key in have_fails:
                    skipped += 1
                    continue
                have_fails.add(key)
                end = _parse_dt(get("end"))
                if end and end < start:  # day/month-swapped source cells
                    end = None
                desc = details
                for label, col in (("reported by", "reported_by"),
                                   ("repercussion", "repercussion")):
                    if get(col):
                        desc += f" · {label}: {get(col)}"
                if not end:
                    desc += " · [historical import — end time not recorded]"
                db.add(Failure(
                    asset_id=asset.id, started_at=start, ended_at=end or start,
                    fault_type=get("fault_type")[:120] or None, description=desc,
                    work_done=get("action_taken") or None,
                    attended_by=get("attended_by")[:160] or None))
                n_fails += 1
            else:
                bits = [details]
                if get("fault_type"): bits.append(f"fault: {get('fault_type')}")
                if get("action_taken"): bits.append(f"action: {get('action_taken')}")
                if get("equipment"): bits.append(f"equipment: {get('equipment')}")
                if not asset and get("asset_id"): bits.append(f"asset: {get('asset_id')}")
                if not asset and get("station"): bits.append(f"at: {get('station')} {get('location')}".strip())
                typ = get("type") or get("kind") or "entry"
                body_text = f"[{typ}] " + " · ".join(bits)
                key = (start.date().isoformat(), asset.code if asset else '', body_text)
                if key in have_logs:
                    skipped += 1
                    continue
                have_logs.add(key)
                line_id = (asset.location.parent_id if asset and asset.location
                           else None) or user.line_id
                db.add(LogEntry(
                    at=start, log_date=start.date(), shift=ShiftCode.GENERAL,
                    type=LogEntryType.DEFECT if is_failure else LogEntryType.OPERATION,
                    text=body_text, entered_by=(get("attended_by") or "imported record")[:120],
                    asset=asset, line_id=line_id))
                n_logs += 1
            batch += 1
            if batch >= 500:
                db.commit()
                batch = 0
        except (SQLAlchemyError, ValueError) as e:
            db.rollback()
            batch = 0
            failed += 1
            if len(errors) < 20:
                errors.append(f"line {n}: {type(e).__name__}: {str(e)[:120]}")
    db.commit()
    audit(db, "log_entry", 0, "history-import",
          detail=f"logs={n_logs} failures={n_fails} skipped={skipped} failed={failed}",
          actor=user.username)
    db.commit()
    return LogImportOut(log_entries=n_logs, failures=n_fails,
                        skipped=skipped, failed=failed, errors=errors)
