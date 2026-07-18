"""Digital shift logbook — v0.3.

Replaces the paper/spreadsheet running log a section keeps per shift.
Design rules:
  * APPEND-ONLY: entries are never edited or deleted. A mistake is corrected
    by a new entry with `corrects_id` pointing at the old one — exactly the
    discipline of a bound paper logbook, kept enforceable by software.
  * Optionally tied to an asset (by code), so scanning a QR tag can show
    everything ever logged against that equipment.
"""
from datetime import date, datetime, timedelta

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
    log_date: date                      # the ruler date — backdating is normal
    shift: str = "G"                    # M/E/N/G (R retired from the book)
    type: str = "general"               # maintenance/failure/rectification/general
    subtype: str | None = None          # maintenance frequency (Monthly … Special)
    category: str | None = None         # asset class (auto-filled from the asset)
    time: str | None = None             # optional HH:MM — a single moment, no start/end
    text: str = Field(min_length=3)
    entered_by: str = ""                # ignored on authenticated deployments
    attended_by: str | None = None      # the crew that actually did the work
    asset_code: str | None = None
    corrects_id: int | None = None
    # failure rows only: when supply/equipment came back, and the fault class.
    # Omitted (or null) on an open breakdown — downtime stays uncomputed.
    end_date: date | None = None
    end_time: str | None = None
    fault_type: str | None = None
    # rectification rows: the failure entry this work fixes
    rectifies_id: int | None = None
    # Fast path for the common case — a failure written up after it was fixed.
    # Carries a whole second entry (its own date/time/shift/author narrative)
    # so one submit files two immutable rows instead of forcing two trips.
    rectification: "LogEntryIn | None" = None


class LogEntryOut(BaseModel):
    id: int
    at: datetime
    log_date: date
    shift: str
    type: str
    subtype: str | None
    category: str | None
    text: str
    entered_by: str
    attended_by: str | None
    asset_code: str | None
    asset_name: str | None
    corrects_id: int | None
    rectifies_id: int | None
    ended_at: datetime | None
    fault_type: str | None
    down_hours: float | None


def _recovery_map(db: Session, entries: list[LogEntry]) -> dict[int, datetime]:
    """failure id -> recovery moment, taken from its LATEST rectification.

    The latest entry dominates: a temporary fix followed by a permanent one
    resolves to the permanent one. Derived at read time so the failure entry
    itself is never rewritten — the book stays append-only."""
    ids = [e.id for e in entries if e.type == LogEntryType.FAILURE]
    if not ids:
        return {}
    rows = db.scalars(
        select(LogEntry).where(LogEntry.rectifies_id.in_(ids))
        .order_by(LogEntry.at, LogEntry.id)
    ).all()
    return {r.rectifies_id: r.at for r in rows}   # later rows overwrite earlier


def _down_hours(e: LogEntry, recovered: datetime | None = None) -> float | None:
    """Downtime in hours, derived from the two timestamps.

    None means "not measurable", which is NOT the same as zero. Most imported
    history carries a failure date with no clock time, so start and end land
    on the same instant — that is a missing measurement, not an instant
    recovery, and averaging it in would flatter the MTTR into meaninglessness.
    Entries logged with real times measure properly.
    """
    end = e.ended_at or recovered
    if e.type != LogEntryType.FAILURE or not end or not e.at:
        return None
    hrs = (end - e.at).total_seconds() / 3600
    return round(hrs, 2) if hrs > 0 else None


def _to_out(e: LogEntry, recovered: datetime | None = None) -> LogEntryOut:
    return LogEntryOut(
        id=e.id, at=e.at, log_date=e.log_date, shift=e.shift.value,
        type=e.type.value, subtype=e.subtype, category=e.category, text=e.text,
        entered_by=e.entered_by, attended_by=e.attended_by,
        asset_code=e.asset.code if e.asset else None,
        asset_name=e.asset.name if e.asset else None, corrects_id=e.corrects_id,
        rectifies_id=e.rectifies_id,
        ended_at=e.ended_at or recovered, fault_type=e.fault_type,
        down_hours=_down_hours(e, recovered),
    )


def _category_of(asset) -> str | None:
    """The asset's class — the entry's equipment category."""
    if not asset:
        return None
    cls = asset.asset_class.name if asset.asset_class else None
    return cls[:80] if cls else None


@router.post("", response_model=LogEntryOut, status_code=201)
def add_entry(entry: LogEntryIn, db: Session = Depends(get_db), user=Depends(current_user)):
    obj = _create_entry(db, entry, user)
    # A failure logged as already-rectified files BOTH rows in one transaction:
    # a half-written breakdown (failure with no fix, or a fix with no failure)
    # is worse than either outcome, so they commit together or not at all.
    rect = None
    if entry.rectification:
        if obj.type != LogEntryType.FAILURE:
            raise HTTPException(422, "only a failure entry can carry a rectification")
        rect_in = entry.rectification.model_copy(update={
            "type": "rectification",
            # the fix belongs to the same equipment even when the form omits it
            "asset_code": entry.rectification.asset_code or entry.asset_code,
            "rectification": None,
        })
        rect = _create_entry(db, rect_in, user, rectifies=obj)
        if rect.at < obj.at:
            raise HTTPException(422, "rectification cannot precede the failure")
    db.commit()
    db.refresh(obj)
    return _to_out(obj, rect.at if rect else None)


def _create_entry(db: Session, entry: LogEntryIn, user, rectifies: LogEntry | None = None) -> LogEntry:
    """Build and stage one log entry. Staged, not committed — the caller owns
    the transaction so a failure and its rectification land together."""
    asset = None
    if entry.asset_code:
        asset = visible_asset(db, entry.asset_code, user)
    if entry.corrects_id and not db.get(LogEntry, entry.corrects_id):
        raise HTTPException(404, "entry to correct not found")
    etype = LogEntryType(entry.type)
    # an explicit rectifies_id lets an OPEN failure be closed later, which the
    # two-row form cannot reach — that entry already exists by then
    target = rectifies
    if target is None and entry.rectifies_id is not None:
        target = db.get(LogEntry, entry.rectifies_id)
        if target is None:
            raise HTTPException(404, "failure to rectify not found")
        if target.type != LogEntryType.FAILURE:
            raise HTTPException(422, "only a failure entry can be rectified")
    if target is not None and etype != LogEntryType.RECTIFICATION:
        raise HTTPException(422, "only a rectification entry can rectify a failure")
    # One date, optional time. `at` anchors the entry to its ruler date so a
    # backdated entry files under its day, not under "now"; midnight = no time
    # given (the UI hides 00:00).
    when = None
    if entry.time:
        try:
            when = datetime.strptime(entry.time, "%H:%M").time()
        except ValueError:
            raise HTTPException(422, "time must be HH:MM")
    at = datetime.combine(entry.log_date, when) if when else datetime.combine(entry.log_date, datetime.min.time())
    # Logged-in deployments: authorship comes from the session, never the form.
    author = user.full_name if AUTH_ON else (entry.entered_by or "unknown")
    # category: explicit choice wins; else the asset's class
    category = (entry.category or "").strip()[:80] or _category_of(asset)
    # maintenance is a night-shift job — enforce it regardless of client
    shift = ShiftCode.NIGHT if etype == LogEntryType.MAINTENANCE else ShiftCode(entry.shift)
    # Recovery moment: failure rows only, and never before the start.
    ended_at = None
    if etype == LogEntryType.FAILURE and entry.end_date:
        end_t = None
        if entry.end_time:
            try:
                end_t = datetime.strptime(entry.end_time, "%H:%M").time()
            except ValueError:
                raise HTTPException(422, "end_time must be HH:MM")
        ended_at = datetime.combine(entry.end_date, end_t or datetime.min.time())
        if ended_at < at:
            raise HTTPException(422, "recovery time cannot precede the failure")
    obj = LogEntry(
        at=at, log_date=entry.log_date, shift=shift,
        type=etype, subtype=(entry.subtype or None),
        category=(category or None), text=entry.text,
        ended_at=ended_at,
        fault_type=((entry.fault_type or "").strip()[:120] or None
                    if etype == LogEntryType.FAILURE else None),
        entered_by=author,
        attended_by=((entry.attended_by or "").strip()[:200] or None),
        asset=asset, corrects_id=entry.corrects_id,
        line_id=user.line_id,  # NULL = department-wide entry (HQ/admin)
    )
    db.add(obj)
    db.flush()
    if target is not None:
        obj.rectifies_id = target.id
        db.flush()
    audit(db, "log_entry", obj.id, "created",
          detail=f"date={obj.log_date} shift={obj.shift.value}"
                 + (f" rectifies={target.id}" if target else ""), actor=user.username)
    return obj


@router.get("", response_model=list[LogEntryOut])
def list_entries(log_date: date | None = None, shift: str | None = None,
                 asset_code: str | None = None, entry_type: str | None = None,
                 category: str | None = None,
                 date_from: date | None = None, date_to: date | None = None,
                 limit: int = 200, db: Session = Depends(get_db), user=Depends(optional_user)):
    """The day's log, a shift's log, or one asset's complete logged history.
    Line-scoped users read their line's book plus department-wide entries.
    date_from/date_to bound the week/month/year views."""
    q = select(LogEntry).order_by(LogEntry.log_date.desc(), LogEntry.at.desc(),
                                  LogEntry.id.desc()).limit(min(limit, 1000))
    if user.line_id is not None:
        q = q.where((LogEntry.line_id == user.line_id) | (LogEntry.line_id.is_(None)))
    if log_date:
        q = q.where(LogEntry.log_date == log_date)
    if date_from:
        q = q.where(LogEntry.log_date >= date_from)
    if date_to:
        q = q.where(LogEntry.log_date <= date_to)
    if shift:
        q = q.where(LogEntry.shift == ShiftCode(shift))
    if entry_type:
        q = q.where(LogEntry.type == LogEntryType(entry_type))
    if category:
        q = q.where(LogEntry.category == category)
    if asset_code:
        asset = visible_asset(db, asset_code, user)
        q = q.where(LogEntry.asset_id == asset.id)
    rows = db.scalars(q).all()
    rec = _recovery_map(db, rows)
    return [_to_out(e, rec.get(e.id)) for e in rows]


@router.get("/bounds")
def logbook_bounds(db: Session = Depends(get_db), user=Depends(optional_user)):
    """First and last dates the book actually covers.

    The week/month/year views anchor on the newest recorded date rather than
    on today: imported history can end months back, and anchoring on the
    calendar would open the book on an empty window."""
    from sqlalchemy import func

    q = select(func.min(LogEntry.log_date), func.max(LogEntry.log_date))
    if user.line_id is not None:
        q = q.where((LogEntry.line_id == user.line_id) | (LogEntry.line_id.is_(None)))
    first, last = db.execute(q).one()
    return {"first": first, "last": last}


@router.get("/failure-stats")
def failure_stats(days: int = 90, months: int = 6, db: Session = Depends(get_db),
                  user=Depends(optional_user)):
    """Breakdown KPIs off the one ledger — counts, downtime, MTTR, trend.

    Every figure is derived from failure log entries: nothing is stored
    pre-aggregated, so the tiles can never drift from the book."""
    from collections import Counter

    q = select(LogEntry).where(LogEntry.type == LogEntryType.FAILURE)
    if user.line_id is not None:
        q = q.where((LogEntry.line_id == user.line_id) | (LogEntry.line_id.is_(None)))
    rows = db.scalars(q).all()
    rec = _recovery_map(db, rows)
    def _end(e):
        return e.ended_at or rec.get(e.id)

    today = date.today()
    window = today - timedelta(days=days)
    recent = [e for e in rows if e.log_date >= window]
    closed = [e for e in recent if _end(e) is not None]
    # only entries with real clock times can contribute to a duration figure
    measured = [e for e in recent if _down_hours(e, rec.get(e.id)) is not None]
    down = [_down_hours(e, rec.get(e.id)) for e in measured]
    # A breakdown is only genuinely OPEN if it names an asset and has no
    # recovery. Imported rows whose asset code never matched the register are
    # a data-quality problem, not outstanding work — counting them as open
    # put a permanent red number on the board that no one could ever clear.
    open_now = [e for e in rows if _end(e) is None and e.asset_id is not None]
    unlinked = [e for e in rows if e.asset_id is None]

    # trend: failures per calendar month, oldest first, `months` buckets
    buckets: list[dict] = []
    y, m = today.year, today.month
    keys = []
    for _ in range(months):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    per_month = Counter(e.log_date.strftime("%Y-%m") for e in rows)
    for k in reversed(keys):
        buckets.append({"month": k, "count": per_month.get(k, 0)})

    by_class = Counter((e.category or "Unclassified") for e in recent)
    by_fault = Counter(e.fault_type for e in recent if e.fault_type)
    # repeat offenders: which equipment actually keeps failing
    by_asset = Counter(e.asset.code for e in recent if e.asset)

    return {
        "days": days,
        "total": len(recent),
        "all_time": len(rows),
        "open": len(open_now),
        "unlinked": len(unlinked),
        "downtime_hours": round(sum(down), 1) if down else 0.0,
        "mttr_hours": round(sum(down) / len(down), 2) if down else None,
        "longest_hours": round(max(down), 2) if down else None,
        "closed": len(closed),
        # how many of the closed failures actually carry a measurable duration:
        # the UI needs this to say "based on N records" instead of implying
        # the MTTR speaks for every failure in the window
        "measured": len(measured),
        "unmeasured": len(closed) - len(measured),
        "unclosed_in_window": len(recent) - len(closed),
        "per_month": buckets,
        "by_class": [{"name": k, "count": v} for k, v in by_class.most_common(6)],
        "by_fault": [{"name": k, "count": v} for k, v in by_fault.most_common(6)],
        "by_asset": [{"name": k, "count": v} for k, v in by_asset.most_common(6)],
        "open_items": [
            {"id": e.id, "asset_code": e.asset.code if e.asset else None,
             "log_date": e.log_date, "text": e.text[:160]}
            for e in sorted(open_now, key=lambda x: x.log_date, reverse=True)[:10]
        ],
    }


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

LOG_SAMPLE_CSV = """kind,type,group,asset_id,station,location,equipment,start,end,fault_type,details,action_taken,attended_by,reported_by,repercussion
maintenance,YEARLY MAINTENANCE,HT,B2HB11,Baranagar,TSS/ASS,VCB,2026-01-05,2026-01-05,,Maintenance done,,PS Staff,,
failure,FAILURE,HT,B2HB11,Baranagar,TSS/ASS,VCB,2026-02-10 14:30,2026-02-10 16:05,Communication fault,Failure of operation from SCADA,Card replaced and tested,PS Staff,TPC,Supply fed from standby
"""


@router.get("/import/sample")
def logbook_import_sample():
    """The standard logbook template — maintenance and failure rows, any line."""
    return Response(LOG_SAMPLE_CSV, media_type="text/csv", headers={
        "Content-Disposition": 'attachment; filename="amps-logbook-sample.csv"'})


def _maint_subtype(type_text: str) -> str | None:
    """Maintenance frequency from a sheet TYPE cell — 'HALF' before 'YEARLY'."""
    t = (type_text or "").upper()
    if "HALF" in t: return "Half-Yearly"
    if "QUARTER" in t: return "Quarterly"
    if "MONTH" in t: return "Monthly"
    if "YEAR" in t: return "Yearly"
    if "MAINT" in t or "TESTING" in t: return "Special"
    return None


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

    # preload once: register codes and already-imported content keys.
    # ONE ledger — every row (maintenance and failure) becomes a log entry.
    assets = {a.code: a for a in db.scalars(select(Asset)).all()}
    have_logs = {(str(e[0]), e[1] or '', e[2]) for e in
                 db.execute(select(LogEntry.log_date, Asset.code, LogEntry.text)
                            .outerjoin(Asset, LogEntry.asset_id == Asset.id)).all()}

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
            bits = [details]
            if get("fault_type"): bits.append(f"fault: {get('fault_type')}")
            if get("action_taken"): bits.append(f"action: {get('action_taken')}")
            if is_failure and get("reported_by"): bits.append(f"reported by: {get('reported_by')}")
            if is_failure and get("repercussion"): bits.append(f"repercussion: {get('repercussion')}")
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
            # category = the asset's class; fall back to the CSV group cell
            category = _category_of(asset) or (get("group")[:80] or None)
            # maintenance runs on the night shift; failures keep the general marker
            # failures carry their recovery moment so downtime stays derivable
            # (a sheet end that predates the start is a day/month swap — drop it)
            end = _parse_dt(get("end")) if is_failure else None
            if end and end < start:
                end = None
            db.add(LogEntry(
                at=start, log_date=start.date(),
                shift=ShiftCode.GENERAL if is_failure else ShiftCode.NIGHT,
                type=LogEntryType.FAILURE if is_failure else LogEntryType.MAINTENANCE,
                subtype=None if is_failure else _maint_subtype(get("type")),
                category=category,
                ended_at=end,
                fault_type=(get("fault_type")[:120] or None) if is_failure else None,
                text=body_text, entered_by=(get("attended_by") or "imported record")[:120],
                attended_by=(get("attended_by")[:200] or None),
                asset=asset, line_id=line_id))
            if is_failure:
                n_fails += 1
            else:
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
