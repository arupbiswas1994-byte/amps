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
import json
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.assets import visible_asset
from app.api.auth import AUTH_ON, current_user, is_anonymous, optional_user
from app.db import audit, get_db
from app.checksheet_templates import templates_for
from app.models import Asset, LogEntry, LogEntryType, Location, LocationKind, ShiftCode

router = APIRouter()


class LogEntryIn(BaseModel):
    log_date: date                      # the ruler date — backdating is normal
    shift: str = "G"                    # M/E/N/G (R retired from the book)
    type: str = "general"               # maintenance/failure/rectification/general
    subtype: str | None = None          # maintenance frequency (Monthly … Special)
    system: str | None = None           # coarse rollup (auto-filled from the asset)
    category: str | None = None         # asset class under the system (optional)
    time: str | None = None             # optional HH:MM — a single moment, no start/end
    text: str = Field(min_length=3)
    entered_by: str = ""                # ignored on authenticated deployments
    attended_by: str | None = None      # the crew that actually did the work
    consumables: str | None = None      # spares/materials consumed (free text)
    # a filled structured checksheet: {template, name, results:[{label,status,reading}]}
    checksheet: dict | None = None
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
    system: str | None
    category: str | None
    text: str
    entered_by: str
    attended_by: str | None
    asset_code: str | None
    asset_name: str | None
    corrects_id: int | None
    rectifies_id: int | None
    # for a RECTIFICATION: the master failure it closes.
    # for a FAILURE resolved by one: the rectification that closed it.
    # both drive the read-only "linked entry" sub-form on the edit screen.
    rectifies: "EntryRef | None" = None
    resolved_by: "EntryRef | None" = None
    # a failure that has been acknowledged (demand raised / mail sent) but not
    # yet fixed — carries the acknowledgement entry; the failure stays "amber"
    acknowledged_by: "EntryRef | None" = None
    # a failure with a job card raised to the OEM/dept — carries it; "yellow".
    # The job card is closed by a later rectification (then state -> resolved).
    job_card_by: "EntryRef | None" = None
    # failure lifecycle: open | acknowledged | job_card | resolved (None for non-failures)
    state: str | None = None
    ended_at: datetime | None
    fault_type: str | None
    consumables: str | None
    # a filled structured checksheet attached to this entry, if any
    checksheet: dict | None = None
    down_hours: float | None


class EntryRef(BaseModel):
    id: int
    log_date: date
    at: datetime
    fault_type: str | None
    text: str
    asset_code: str | None
    attended_by: str | None
    consumables: str | None
    via_job_card: bool = False
    checksheet: dict | None = None


def _response_map(db: Session, entries: list[LogEntry],
                  etype: "LogEntryType") -> dict[int, LogEntry]:
    """failure HEAD id -> its LATEST linked response of `etype`.

    A response (rectification OR acknowledgement) points at the failure it was
    logged against via rectifies_id; editing that failure appends a correction
    (a new head), so the response's target may be a superseded entry. We follow
    the correction chain: the head failure inherits the response pointed at any
    entry in its own history. Latest response dominates. Read-time only — the
    book stays append-only.

    A RECTIFICATION resolves the failure; an ACKNOWLEDGEMENT only notes it
    (demand raised, mail sent) and leaves it amber/open."""
    heads = [e for e in entries if e.type == LogEntryType.FAILURE]
    if not heads:
        return {}
    # map every failure entry id -> its current head, by walking corrects_id back
    # from each head through the whole failure correction ancestry.
    id_to_head = {}
    for h in heads:
        cur = h
        seen = set()
        while cur is not None and cur.id not in seen:
            id_to_head[cur.id] = h.id
            seen.add(cur.id)
            cur = db.get(LogEntry, cur.corrects_id) if cur.corrects_id else None
    rows = db.scalars(
        select(LogEntry).where(LogEntry.rectifies_id.in_(id_to_head.keys()),
                               LogEntry.type == etype)
        .order_by(LogEntry.at, LogEntry.id)
    ).all()
    out = {}
    for r in rows:                 # later rows overwrite earlier (latest dominates)
        out[id_to_head[r.rectifies_id]] = r
    return out


def _drop_superseded(db: Session, rows: list[LogEntry]) -> list[LogEntry]:
    """Keep only current HEAD entries — an edit appends a correction that
    supersedes the old row, so a superseded failure must not be counted (it is
    the same breakdown as its head, and its responses map onto the head)."""
    superseded = set(db.scalars(
        select(LogEntry.corrects_id).where(LogEntry.corrects_id.is_not(None))).all())
    return [e for e in rows if e.id not in superseded]


def _recovery_map(db: Session, entries: list[LogEntry]) -> dict[int, LogEntry]:
    """failure HEAD id -> its latest RECTIFICATION (the entry that resolves it)."""
    return _response_map(db, entries, LogEntryType.RECTIFICATION)


def _ack_map(db: Session, entries: list[LogEntry]) -> dict[int, LogEntry]:
    """failure HEAD id -> its latest ACKNOWLEDGEMENT (noted, not yet resolved)."""
    return _response_map(db, entries, LogEntryType.ACKNOWLEDGEMENT)


def _jobcard_map(db: Session, entries: list[LogEntry]) -> dict[int, LogEntry]:
    """failure HEAD id -> its latest JOB_CARD (raised to OEM, not yet closed)."""
    return _response_map(db, entries, LogEntryType.JOB_CARD)


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


def _load_checksheet(raw: str | None) -> dict | None:
    """Parse the stored checksheet JSON; tolerate legacy/bad rows as None."""
    if not raw:
        return None
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) and v.get("results") else None
    except (ValueError, TypeError):
        return None


def _dump_checksheet(cs: dict | None) -> str | None:
    """Serialise a filled checksheet to JSON, keeping only the fields we store."""
    if not cs or not isinstance(cs, dict):
        return None
    results = [
        {"label": str(r.get("label", ""))[:120],
         "status": (r.get("status") or "na"),
         "reading": (str(r.get("reading"))[:60] if r.get("reading") not in (None, "") else None)}
        for r in (cs.get("results") or []) if r.get("label")
    ]
    if not results:
        return None
    return json.dumps({"template": str(cs.get("template", ""))[:80] or None,
                       "name": str(cs.get("name", ""))[:120] or None,
                       "results": results}, ensure_ascii=False)


def _ref(x: LogEntry | None) -> "EntryRef | None":
    if x is None:
        return None
    return EntryRef(id=x.id, log_date=x.log_date, at=x.at, fault_type=x.fault_type,
                    text=x.text, asset_code=x.asset.code if x.asset else None,
                    attended_by=x.attended_by, consumables=x.consumables,
                    via_job_card=bool(x.via_job_card),
                    checksheet=_load_checksheet(x.checksheet))


def _to_out(e: LogEntry, resolver: LogEntry | None = None,
            master: LogEntry | None = None,
            acker: LogEntry | None = None,
            jobcard: LogEntry | None = None) -> LogEntryOut:
    recovered = resolver.at if resolver else None
    # lifecycle only applies to a failure head, by dominance of the response:
    # rectification (resolved) > job card (job_card) > acknowledgement > open
    state = None
    if e.type == LogEntryType.FAILURE:
        state = ("resolved" if resolver else "job_card" if jobcard
                 else "acknowledged" if acker else "open")
    return LogEntryOut(
        id=e.id, at=e.at, log_date=e.log_date, shift=e.shift.value,
        type=e.type.value, subtype=e.subtype, system=e.system, category=e.category, text=e.text,
        entered_by=e.entered_by, attended_by=e.attended_by,
        asset_code=e.asset.code if e.asset else None,
        asset_name=e.asset.name if e.asset else None, corrects_id=e.corrects_id,
        rectifies_id=e.rectifies_id,
        rectifies=_ref(master),        # response → its master failure
        resolved_by=_ref(resolver),    # failure → the rectification that closed it
        acknowledged_by=_ref(acker),   # failure → the acknowledgement noting it
        job_card_by=_ref(jobcard),     # failure → the job card raised for it
        state=state,
        # ONLY a rectification ends a failure; ack/job-card leave it open
        ended_at=e.ended_at or recovered, fault_type=e.fault_type,
        consumables=e.consumables,
        checksheet=_load_checksheet(e.checksheet),
        down_hours=_down_hours(e, recovered),
    )


def _category_of(asset) -> str | None:
    """The asset's class — the entry's equipment category."""
    if not asset:
        return None
    cls = asset.asset_class.name if asset.asset_class else None
    return cls[:80] if cls else None


def _system_of(asset) -> str | None:
    """The asset's system rollup — the entry's coarse equipment tag."""
    return (asset.system[:80] if asset and asset.system else None)


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
    return _to_out(obj, rect if rect else None)


def _create_entry(db: Session, entry: LogEntryIn, user, rectifies: LogEntry | None = None) -> LogEntry:
    """Build and stage one log entry. Staged, not committed — the caller owns
    the transaction so a failure and its rectification land together."""
    asset = None
    if entry.asset_code:
        asset = visible_asset(db, entry.asset_code, user)
    if entry.corrects_id is not None:
        target = db.get(LogEntry, entry.corrects_id)
        if not target or (user.line_id is not None and target.line_id not in (user.line_id, None)):
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
    # system + category: explicit choice wins; else inherit from the asset
    system = (entry.system or "").strip()[:80] or _system_of(asset)
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
        system=(system or None), category=(category or None), text=entry.text,
        ended_at=ended_at,
        fault_type=((entry.fault_type or "").strip()[:120] or None
                    if etype == LogEntryType.FAILURE else None),
        entered_by=author,
        attended_by=((entry.attended_by or "").strip()[:200] or None),
        consumables=((entry.consumables or "").strip() or None),
        checksheet=_dump_checksheet(entry.checksheet),
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
                 category: str | None = None, q: str | None = None,
                 date_from: date | None = None, date_to: date | None = None,
                 line: str | None = None,
                 limit: int = 200, offset: int = 0, response: Response = None,
                 db: Session = Depends(get_db), user=Depends(optional_user)):
    """The day's log, a shift's log, or one asset's complete logged history.
    Line-scoped users read their line's book plus department-wide entries.
    date_from/date_to bound the week/month/year views.

    Paged: the total row count comes back in X-Total-Count so the caller can
    say "1-100 of 3,966" instead of silently showing a truncated page — a
    year of this book is thousands of entries."""
    # The bulk ledger is login-only; the QR walk-up (a single asset's log,
    # scoped by asset_code) stays open. Without a scope, an anonymous request
    # could pull the whole 18,000-row operational book — so require a session.
    if asset_code is None and is_anonymous(user):
        raise HTTPException(401, "login required")
    filters = []
    # An edit is a NEW entry that corrects an older one (append-only). The list
    # shows only the latest version of each chain — the entry it superseded is
    # hidden here but still reachable through /versions, WhatsApp-style.
    superseded = select(LogEntry.corrects_id).where(LogEntry.corrects_id.is_not(None))
    filters.append(LogEntry.id.not_in(superseded))
    if user.line_id is not None:
        filters.append((LogEntry.line_id == user.line_id) | (LogEntry.line_id.is_(None)))
    if line and line.strip():
        site = db.scalar(select(Location).where(Location.kind == LocationKind.SITE,
                                                func.lower(Location.name) == line.strip().lower()))
        if site:
            filters.append(LogEntry.line_id == site.id)
    if log_date:
        filters.append(LogEntry.log_date == log_date)
    if date_from:
        filters.append(LogEntry.log_date >= date_from)
    if date_to:
        filters.append(LogEntry.log_date <= date_to)
    if shift:
        filters.append(LogEntry.shift == ShiftCode(shift))
    if entry_type:
        filters.append(LogEntry.type == LogEntryType(entry_type))
    if category:
        filters.append(LogEntry.category == category)
    if q and q.strip():
        # free-text search across the record, crew, fault and system/class —
        # case-insensitive; matches the register's search box behaviour
        like = f"%{q.strip()}%"
        filters.append(
            LogEntry.text.ilike(like) | LogEntry.attended_by.ilike(like)
            | LogEntry.entered_by.ilike(like) | LogEntry.fault_type.ilike(like)
            | LogEntry.system.ilike(like) | LogEntry.category.ilike(like))
    if asset_code:
        asset = visible_asset(db, asset_code, user)
        filters.append(LogEntry.asset_id == asset.id)

    if response is not None:
        total = db.scalar(select(func.count()).select_from(LogEntry).where(*filters))
        response.headers["X-Total-Count"] = str(total)
        response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"

    q = (select(LogEntry).where(*filters)
         .order_by(LogEntry.log_date.desc(), LogEntry.at.desc(), LogEntry.id.desc())
         .offset(max(offset, 0)).limit(min(limit, 1000)))
    rows = db.scalars(q).all()
    rec = _recovery_map(db, rows)
    ack = _ack_map(db, rows)
    jc = _jobcard_map(db, rows)
    # the master failure each response (rectification/ack/job-card) responds to —
    # for the edit sub-form and for grouping a response under its failure
    master_ids = {e.rectifies_id for e in rows if e.rectifies_id}
    masters = {}
    if master_ids:
        masters = {m.id: m for m in db.scalars(
            select(LogEntry).where(LogEntry.id.in_(master_ids))).all()}
    return [_to_out(e, rec.get(e.id), masters.get(e.rectifies_id), ack.get(e.id), jc.get(e.id)) for e in rows]


@router.get("/{entry_id}/versions", response_model=list[LogEntryOut])
def entry_versions(entry_id: int, db: Session = Depends(get_db), user=Depends(current_user)):
    """The full edit trail of one entry, oldest first — the original and every
    correction made to it. Nothing is ever overwritten, so this is the honest
    history behind the 'edited' marker."""
    e = db.get(LogEntry, entry_id)
    if not e or (user.line_id is not None and e.line_id not in (user.line_id, None)):
        raise HTTPException(404, "entry not found")
    # walk up to the original, then forward through every correction
    root = e
    seen = {e.id}
    while root.corrects_id:
        prev = db.get(LogEntry, root.corrects_id)
        if not prev or prev.id in seen:
            break
        seen.add(prev.id); root = prev
    chain = [root]
    cur = root
    while True:
        nxt = db.scalar(select(LogEntry).where(LogEntry.corrects_id == cur.id))
        if not nxt or nxt.id in {c.id for c in chain}:
            break
        chain.append(nxt); cur = nxt
    rec = _recovery_map(db, chain)
    ack = _ack_map(db, chain)
    jc = _jobcard_map(db, chain)
    return [_to_out(x, rec.get(x.id), None, ack.get(x.id), jc.get(x.id)) for x in chain]


class RectificationIn(BaseModel):
    date: date
    time: str | None = None
    text: str = ""
    fault_type: str | None = None
    attended_by: str | None = None
    consumables: str | None = None
    via_job_card: bool = False   # the fix was carried out by the agency under a job card
    checksheet: dict | None = None  # a structured checksheet for the fix / job card


class ResolutionIn(BaseModel):
    """The FULL desired response state of a failure, reconciled in one call.

    Two independent axes:
    - `acknowledged` (a checkbox flag) + its `ack` note — noted / demand raised.
    - `progress`: open | job_card | rectified — how far the FIX has got, with its
      `detail`. RECTIFIED is terminal: it resolves the failure and clears the
      acknowledgement (a fixed failure needs no ack)."""
    acknowledged: bool = False
    ack: RectificationIn | None = None
    progress: str = "open"                 # open | job_card | rectified
    detail: RectificationIn | None = None


_RESP_PREFIX = {
    LogEntryType.RECTIFICATION: ("[RECTIFICATION] ", "Rectified"),
    LogEntryType.ACKNOWLEDGEMENT: ("[ACKNOWLEDGEMENT] ", "Acknowledged"),
    LogEntryType.JOB_CARD: ("[JOB CARD] ", "Job card issued"),
}


def _scope_ok(user, e: LogEntry) -> bool:
    return user.line_id is None or e.line_id in (user.line_id, None)


def _at_of(fail: LogEntry, r: "RectificationIn") -> datetime:
    when = None
    if r.time:
        try:
            when = datetime.strptime(r.time, "%H:%M").time()
        except ValueError:
            raise HTTPException(422, "time must be HH:MM")
    at = datetime.combine(r.date, when or datetime.min.time())
    if at < fail.at:
        raise HTTPException(422, "the response cannot precede the failure")
    return at


@router.put("/{failure_id}/resolution", response_model=LogEntryOut)
def set_resolution(failure_id: int, body: ResolutionIn,
                   db: Session = Depends(get_db), user=Depends(current_user)):
    """Reconcile a failure's whole response state from the two-axis edit form.

    Acknowledged is an independent flag; progress (open/job_card/rectified) is the
    fix axis. The failure head never carries ended_at — resolution lives on the
    linked rectification. Dominance rectification > job_card > acknowledgement >
    open still derives the displayed state."""
    fail = db.get(LogEntry, failure_id)
    if not fail or fail.type != LogEntryType.FAILURE or not _scope_ok(user, fail):
        raise HTTPException(404, "failure not found")
    if body.progress not in ("open", "job_card", "rectified"):
        raise HTTPException(422, f"unknown progress '{body.progress}'")
    linked = db.scalars(
        select(LogEntry).where(LogEntry.rectifies_id == fail.id)
        .order_by(LogEntry.at.desc(), LogEntry.id.desc())).all()
    by_type = {t: [e for e in linked if e.type == t] for t in (
        LogEntryType.RECTIFICATION, LogEntryType.JOB_CARD, LogEntryType.ACKNOWLEDGEMENT)}

    def _clear(t):
        for e in by_type[t]:
            db.delete(e)
        by_type[t] = []

    def _upsert(t, r: "RectificationIn"):
        is_rect = t == LogEntryType.RECTIFICATION
        prefix, default_text = _RESP_PREFIX[t]
        at = _at_of(fail, r)
        text = prefix + (r.text.strip() or default_text)
        existing = by_type[t]
        if existing:
            resp = existing[0]
            resp.at, resp.log_date, resp.text = at, r.date, text
            resp.fault_type = (r.fault_type or fail.fault_type)
            resp.attended_by = r.attended_by or None
            resp.consumables = (r.consumables or None) if is_rect else None
            resp.via_job_card = bool(r.via_job_card) if is_rect else None
            resp.checksheet = _dump_checksheet(r.checksheet)
            for extra in existing[1:]:
                db.delete(extra)
        else:
            db.add(LogEntry(
                at=at, log_date=r.date, shift=ShiftCode.GENERAL, type=t,
                system=fail.system, category=fail.category,
                fault_type=(r.fault_type or fail.fault_type), text=text,
                entered_by=user.username, attended_by=r.attended_by or None,
                consumables=(r.consumables or None) if is_rect else None,
                via_job_card=bool(r.via_job_card) if is_rect else None,
                checksheet=_dump_checksheet(r.checksheet),
                rectifies_id=fail.id, asset_id=fail.asset_id, line_id=fail.line_id))

    # The three response logs are INDEPENDENT and coexist as history — a failure
    # acknowledged then rectified keeps BOTH the acknowledgement and the fix. Each
    # axis is reconciled on its own; the displayed state is by dominance
    # (rectified > job_card > acknowledged > open). We never convert one log into
    # another. Progress carries the JOB CARD and RECTIFICATION logs cumulatively:
    #   open      → neither
    #   job_card  → the job card (fix not yet done)
    #   rectified → the rectification (a job card raised earlier is kept)
    # Acknowledgement is fully independent of progress.
    if body.acknowledged:
        if not body.ack:
            raise HTTPException(422, "an acknowledgement needs its note")
        _upsert(LogEntryType.ACKNOWLEDGEMENT, body.ack)
    else:
        _clear(LogEntryType.ACKNOWLEDGEMENT)

    if body.progress == "rectified":
        if not body.detail:
            raise HTTPException(422, "a rectified failure needs the fix detail")
        _upsert(LogEntryType.RECTIFICATION, body.detail)
        # keep any job card raised earlier — it is real history, not superseded
    elif body.progress == "job_card":
        if not body.detail:
            raise HTTPException(422, "a job card needs its detail")
        _upsert(LogEntryType.JOB_CARD, body.detail)
        _clear(LogEntryType.RECTIFICATION)
    else:  # open — nothing progressed
        _clear(LogEntryType.RECTIFICATION)
        _clear(LogEntryType.JOB_CARD)

    db.flush()
    audit(db, "log_entry", fail.id, "response-set",
          detail=f"ack={body.acknowledged} progress={body.progress}", actor=user.username)
    db.commit(); db.refresh(fail)
    rec = _recovery_map(db, [fail]); ack = _ack_map(db, [fail]); jc = _jobcard_map(db, [fail])
    return _to_out(fail, rec.get(fail.id), None, ack.get(fail.id), jc.get(fail.id))


@router.get("/bounds")
def logbook_bounds(db: Session = Depends(get_db), user=Depends(current_user)):
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
def failure_stats(days: int = 90, months: int = 6, line: str | None = None,
                  db: Session = Depends(get_db), user=Depends(optional_user)):
    """Breakdown KPIs off the one ledger — counts, downtime, MTTR, trend.

    Public (walk-up) surface: the aggregate figures and charts are open, but the
    detailed open-item list (fault text, crew) is only returned when signed in.
    Every figure is derived from failure log entries: nothing is stored
    pre-aggregated, so the tiles can never drift from the book."""
    from collections import Counter

    q = select(LogEntry).where(LogEntry.type == LogEntryType.FAILURE)
    if user.line_id is not None:
        q = q.where((LogEntry.line_id == user.line_id) | (LogEntry.line_id.is_(None)))
    # optional public line filter: the walk-up failures board scopes to one line
    # so each line shows its own KPIs instead of the network total. Ignored when
    # it names a line the caller isn't already scoped to nothing.
    if line and line.strip():
        site = db.scalar(select(Location).where(Location.kind == LocationKind.SITE,
                                                func.lower(Location.name) == line.strip().lower()))
        if site:
            q = q.where(LogEntry.line_id == site.id)
    rows = _drop_superseded(db, db.scalars(q).all())   # count current heads only
    rec = _recovery_map(db, rows)
    ack = _ack_map(db, rows)
    jc = _jobcard_map(db, rows)
    recov_at = lambda e: (rec[e.id].at if e.id in rec else None)
    def _end(e):
        return e.ended_at or recov_at(e)

    today = date.today()
    window = today - timedelta(days=days)
    recent = [e for e in rows if e.log_date >= window]
    closed = [e for e in recent if _end(e) is not None]
    # only entries with real clock times can contribute to a duration figure
    measured = [e for e in recent if _down_hours(e, recov_at(e)) is not None]
    down = [_down_hours(e, recov_at(e)) for e in measured]
    # A breakdown still NEEDS ATTENTION when it names an asset and has no
    # rectification. Imported rows whose asset code never matched the register
    # are a data-quality problem, not outstanding work, so they are excluded.
    # Among the outstanding, by dominance: job card (yellow) > acknowledged
    # (amber) > open (red).
    outstanding = [e for e in rows if _end(e) is None and e.asset_id is not None]
    job_carded = [e for e in outstanding if e.id in jc]
    acknowledged = [e for e in outstanding if e.id not in jc and e.id in ack]
    open_now = [e for e in outstanding if e.id not in jc and e.id not in ack]
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
    # open breakdowns per line — the walk-up "all lines at a glance" board needs
    # a per-line open count; it is an aggregate number (no fault text/crew), so
    # it stays public. Line = the asset's parent site in the location tree.
    def _line_of(e):
        loc = e.asset.location if e.asset else None
        return (loc.parent.name if loc and loc.parent else None)
    # per-line breakdown counts both still-needs-attention states (open + ack)
    by_line_open = Counter(ln for ln in (_line_of(e) for e in outstanding) if ln)

    return {
        "days": days,
        "total": len(recent),
        "all_time": len(rows),
        "open": len(open_now),
        "acknowledged": len(acknowledged),
        "job_card": len(job_carded),
        "outstanding": len(outstanding),
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
        # public per-line open count for the all-lines landing board
        "by_line_open": {k: v for k, v in by_line_open.items()},
        # the detailed open list (fault text, crew) is signed-in only; a public
        # walk-up sees the aggregate figures and charts, not the row detail.
        "open_items": ([] if is_anonymous(user) else [
            {"id": e.id, "asset_code": e.asset.code if e.asset else None,
             "log_date": e.log_date, "text": e.text[:160]}
            for e in sorted(open_now, key=lambda x: x.log_date, reverse=True)[:10]
        ]),
    }


@router.get("/open-failures-by-asset")
def open_failures_by_asset(db: Session = Depends(get_db), user=Depends(optional_user)):
    """{asset_code: {open, ack, jobcard, acknowledged, rectified, failure_id,
    failure_date}} — a public aggregate (counts only, no fault text/crew) so the
    register can flag faulty assets and offer quick acknowledge/rectify actions.

    A failure is OUTSTANDING until a RECTIFICATION closes it — acknowledgement
    and job card are independent flags that do NOT resolve it. So each asset
    reports two flags: `acknowledged` (some outstanding failure has an ack or
    job card) and — always false here since resolved ones are excluded —
    `rectified`. `failure_id`/`failure_date` point at the latest outstanding
    failure so a quick action can deep-link straight to it.
    Line-scoped like the rest of the failures surface."""
    q = select(LogEntry).where(LogEntry.type == LogEntryType.FAILURE)
    if user.line_id is not None:
        q = q.where((LogEntry.line_id == user.line_id) | (LogEntry.line_id.is_(None)))
    rows = _drop_superseded(db, db.scalars(q).all())   # current heads only
    rec = _recovery_map(db, rows)
    ack = _ack_map(db, rows)
    jc = _jobcard_map(db, rows)
    out: dict[str, dict] = {}
    for e in rows:
        if e.asset is None or e.ended_at is not None or e.id in rec:
            continue  # no asset, or resolved -> not outstanding
        slot = out.setdefault(e.asset.code, {
            "open": 0, "ack": 0, "jobcard": 0, "acknowledged": False,
            "rectified": False, "failure_id": None, "failure_date": None})
        is_ack, is_jc = e.id in ack, e.id in jc
        slot["jobcard" if is_jc else "ack" if is_ack else "open"] += 1
        if is_ack or is_jc:
            slot["acknowledged"] = True
        # keep the most recent outstanding failure for the deep-link target
        if slot["failure_date"] is None or e.log_date >= slot["failure_date"]:
            slot["failure_id"] = e.id
            slot["failure_date"] = e.log_date
    return out


# ---- bulk history import: scattered sheet logbooks -> one digital book ----
# One row = one entry, dated by a single `date`. Columns:
#   kind,date,type,group,asset_id,station,location,equipment,fault_type,
#   details,action_taken,consumables,attended_by,resolved_on,
#   closes_failure_ref,reported_by,repercussion
# kind is one of: maintenance | failure | rectification | general.
#  - maintenance takes its cycle from the type word (advances the schedule).
#  - failure: fill `resolved_on` once restored (blank = still open) + fault_type.
#    A failure never self-resolves — if resolved_on is given, its `action_taken`
#    is filed as a SEPARATE rectification that closes it (two-part everywhere).
#  - rectification: `closes_failure_ref` links it to the failure it fixes
#    ("ASSET@YYYY-MM-DD", "ASSET", "YYYY-MM-DD", or a failure id). If it matches
#    no open failure (or is blank), the rectification stands on its own — a
#    proactive/suo-moto fix or modification, recorded but not closing anything.
# `start`/`end` are still accepted as aliases for date/resolved_on (older sheets).
# Rows whose asset isn't in the register still import (the code is kept in the
# text). Duplicate-safe by content.

import csv as _csv
import io as _io

from fastapi import Request, Response
from sqlalchemy.exc import SQLAlchemyError

LOG_SAMPLE_CSV = """kind,date,type,group,asset_id,station,location,equipment,fault_type,details,action_taken,consumables,attended_by,resolved_on,closes_failure_ref,reported_by,repercussion
maintenance,2026-01-05,YEARLY MAINTENANCE,HT,B2HB11,Baranagar,TSS/ASS,VCB,,Maintenance done,,,PS Staff,,,,
failure,2026-02-10 14:30,FAILURE,HT,B2HB11,Baranagar,TSS/ASS,VCB,Communication fault,Failure of operation from SCADA,,,,PS Staff,,,TPC,Supply fed from standby
acknowledgement,2026-02-10 16:00,ACKNOWLEDGEMENT,HT,B2HB11,Baranagar,TSS/ASS,VCB,Communication fault,Comm card not available. Demand raised; mail sent to stores,,,PS Staff,,B2HB11@2026-02-10,,
job_card,2026-02-11 09:00,JOB CARD,HT,B2HB11,Baranagar,TSS/ASS,VCB,Communication fault,Job card issued to M/s Siemens to replace the comm card,,,PS Staff,,B2HB11@2026-02-10,,
rectification,2026-02-12 10:00,RECTIFICATION,HT,B2HB11,Baranagar,TSS/ASS,VCB,Communication fault,Faulty comm card replaced and re-tested,SCADA link verified,1× spare card; 2× PT fuse,PS Staff,2026-02-12 12:30,B2HB11@2026-02-10,,
general,2026-03-01,NOTE,HT,B2HB11,Baranagar,TSS/ASS,VCB,,Panel cleaned and inspected during patrol,,,PS Staff,,,,
"""


@router.get("/import/sample")
def logbook_import_sample():
    """The standard logbook template — maintenance and failure rows, any line."""
    return Response(LOG_SAMPLE_CSV, media_type="text/csv", headers={
        "Content-Disposition": 'attachment; filename="amps-logbook-sample.csv"'})


@router.get("/checksheet-templates")
def checksheet_templates(applies_to: str | None = None, asset_class: str | None = None,
                         subtype: str | None = None, user=Depends(optional_user)):
    """Predefined checksheet templates for a context (kind + asset class + freq).
    A writer picks one when logging maintenance / a job card, then ticks its
    items; the filled result is stored on the entry. Public read (no records)."""
    return templates_for(applies_to, asset_class, subtype)


# the logbook 'kind' cell → entry type; blank/unknown defaults to maintenance
_KIND_TYPE = {
    "maintenance": LogEntryType.MAINTENANCE,
    "failure": LogEntryType.FAILURE,
    "rectification": LogEntryType.RECTIFICATION,
    "acknowledgement": LogEntryType.ACKNOWLEDGEMENT,
    "acknowledgment": LogEntryType.ACKNOWLEDGEMENT,
    "job_card": LogEntryType.JOB_CARD,
    "job card": LogEntryType.JOB_CARD,
    "jobcard": LogEntryType.JOB_CARD,
    "general": LogEntryType.GENERAL,
}


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


def _resolve_failure_ref(db: Session, ref: str, row_asset):
    """Find the OPEN failure a rectification closes, from a sheet reference.

    Accepts: a failure id ('#123' or '123'), 'ASSET@YYYY-MM-DD', 'ASSET',
    or 'YYYY-MM-DD' (asset then taken from the rectification's own row).
    Matches the asset's open failure (ended_at NULL) on that date, else its
    most recent open failure. Returns the LogEntry or None."""
    ref = (ref or "").strip()
    if not ref:
        return None
    # the session is autoflush=False, so a failure added earlier in THIS import
    # isn't queryable until flushed — do it so a failure+fix in one file links.
    db.flush()
    # a bare failure id
    bare = ref.lstrip("#")
    if bare.isdigit():
        f = db.get(LogEntry, int(bare))
        return f if f and f.type == LogEntryType.FAILURE else None
    code, _, date_s = ref.partition("@")
    code = code.strip()
    date_s = date_s.strip()
    # if the left side looks like a date and there's no '@', it IS the date
    if not date_s and _parse_dt(code):
        date_s, code = code, ""
    asset = None
    if code:
        asset = db.scalar(select(Asset).where(Asset.code == code))
    asset = asset or row_asset
    if asset is None:
        return None
    q = (select(LogEntry).where(LogEntry.asset_id == asset.id,
                                LogEntry.type == LogEntryType.FAILURE,
                                LogEntry.ended_at.is_(None))
         .order_by(LogEntry.log_date.desc(), LogEntry.id.desc()))
    open_fails = db.scalars(q).all()
    if not open_fails:
        return None
    d = _parse_dt(date_s)
    if d:
        for f in open_fails:
            if f.log_date == d.date():
                return f
    return open_fails[0]   # latest open failure


class LogImportOut(BaseModel):
    log_entries: int
    failures: int
    skipped: int
    failed: int
    errors: list[str]


@router.post("/import", response_model=LogImportOut)
async def import_history(request: Request, line: str | None = None,
                         db: Session = Depends(get_db),
                         user=Depends(current_user)):
    # `line` scopes the whole import to one site (e.g. ?line=Green Line): rows
    # with no matching asset would otherwise land with a NULL line and leak
    # into every coordinator's book, so an asset-less row falls back to this.
    import_line_id = None
    if line and line.strip():
        site = db.scalar(select(Location).where(Location.kind == LocationKind.SITE,
                                                func.lower(Location.name) == line.strip().lower()))
        if not site:
            raise HTTPException(422, f"unknown line '{line}' — no such site")
        import_line_id = site.id
    text = (await request.body()).decode("utf-8-sig", errors="replace")
    rows = list(_csv.DictReader(_io.StringIO(text)))
    if not rows or "details" not in rows[0] or not ({"date", "start"} & set(rows[0])):
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
        getfirst = lambda *ks: next((v for v in (get(k) for k in ks) if v), "")
        # one date per entry ('date'); failures may add a recovery ('resolved_on').
        # 'start'/'end' kept as aliases so the older two-date sheets still import.
        start = _parse_dt(getfirst("date", "start")) or _parse_dt(getfirst("resolved_on", "end"))
        if not start:
            failed += 1
            if len(errors) < 20:
                errors.append(f"line {n}: no usable date")
            continue
        details = get("details") or get("fault_type") or get("type") or "entry"
        asset = assets.get(get("asset_id"))
        etype = _KIND_TYPE.get(get("kind").lower(), LogEntryType.MAINTENANCE)
        is_failure = etype == LogEntryType.FAILURE
        try:
            # a failure never self-resolves: if the row carries a recovery date,
            # the fix (action_taken) is filed as a SEPARATE rectification that
            # closes it, so the two-part model holds everywhere.
            resolved = (_parse_dt(getfirst("resolved_on", "end"))
                        if is_failure else None)
            if resolved and resolved < start:
                resolved = None
            action = get("action_taken")

            bits = [details]
            if get("fault_type"): bits.append(f"fault: {get('fault_type')}")
            # the action belongs to the fix — only fold it into the entry text
            # when there is no separate rectification to carry it
            if action and not (is_failure and resolved): bits.append(f"action: {action}")
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
            # asset's own line first, then the import-wide line, then the
            # importer's line — never NULL for an asset-less row when ?line= is set
            line_id = ((asset.location.parent_id if asset and asset.location else None)
                       or import_line_id or user.line_id)
            # system + category = the asset's rollup + class; category falls
            # back to the CSV group cell when the asset is unmatched
            system = _system_of(asset)
            category = _category_of(asset) or (get("group")[:80] or None)
            # a rectification (kind=rectification) may name the failure it closes
            # via closes_failure_ref ("ASSET@YYYY-MM-DD" / asset / date / id).
            rectifies = None
            if etype == LogEntryType.RECTIFICATION and get("closes_failure_ref"):
                rectifies = _resolve_failure_ref(db, get("closes_failure_ref"), asset)
            # a standalone rectification carries its own recovery time
            end = _parse_dt(getfirst("resolved_on", "end")) if etype == LogEntryType.RECTIFICATION else None
            if end and end < start:
                end = None
            fault = (get("fault_type")[:120] or None) if etype in (LogEntryType.FAILURE, LogEntryType.RECTIFICATION) else None
            attended = (get("attended_by") or "imported record")[:120]
            new = LogEntry(
                at=start, log_date=start.date(),
                shift=ShiftCode.NIGHT if etype == LogEntryType.MAINTENANCE else ShiftCode.GENERAL,
                type=etype,
                subtype=_maint_subtype(get("type")) if etype == LogEntryType.MAINTENANCE else None,
                system=system, category=category,
                ended_at=end,   # failures never self-resolve (see below); rects carry it
                fault_type=fault,
                text=body_text, entered_by=attended,
                attended_by=(get("attended_by")[:200] or None),
                # a failure consumes nothing — spares go on the fix (auto-rect below)
                consumables=(None if is_failure else (get("consumables") or None)),
                rectifies_id=rectifies.id if rectifies else None,
                asset=asset, line_id=line_id)
            db.add(new)
            if is_failure:
                n_fails += 1
            else:
                n_logs += 1
            # auto-pair: a resolved failure gets a rectification that closes it
            if is_failure and resolved:
                db.flush()   # need the failure's id to link the rectification
                rect = LogEntry(
                    at=resolved, log_date=resolved.date(), shift=ShiftCode.GENERAL,
                    type=LogEntryType.RECTIFICATION, system=system, category=category,
                    fault_type=fault,
                    text="[RECTIFICATION] " + (action or "Rectified"),
                    entered_by=attended, attended_by=(get("attended_by")[:200] or None),
                    consumables=(get("consumables") or None),
                    rectifies_id=new.id, asset=asset, line_id=line_id)
                db.add(rect)
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
