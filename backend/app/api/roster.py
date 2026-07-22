"""Duty-roster endpoints — roster ↔ maintenance linkage.

The roster here is a MAINTENANCE-PLANNING object, not an attendance system
(attendance/payroll stays with the organization's HR tools). What this module
does:

  1. Analyse a weekly shift pattern: per-day per-shift headcount, uncovered
     shift-slots, and staffing inside the designated maintenance windows.
  2. Bundle due PM items into a shift work package: "this window, this crew,
     this list" — printable before the shift starts.

Both endpoints are live in v0.2: coverage is pure computation
(app.engine.compute_coverage), the work package joins the active roster
pattern with the PM due list.
"""
from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import current_user
from app.db import get_db
from app.engine import WEEKDAYS, compute_coverage
from app.models import RosterEntry, RosterPattern

router = APIRouter()


class PatternGrid(BaseModel):
    """A weekly pattern: one row per person, 7 shift codes (M/E/N/G/R)."""
    name: str = Field(examples=["Balanced baseline"])
    maintenance_window_shifts: list[str] = Field(
        default=["N"],
        description="Shift codes treated as maintenance windows (e.g. night blocks).",
    )
    rows: dict[str, list[str]] = Field(
        description="person → exactly 7 shift codes, Monday first.",
        examples=[{"Supervisor A": ["G", "G", "M", "E", "N", "R", "G"]}],
    )


class DayCoverage(BaseModel):
    day: str
    counts: dict[str, int]           # shift code → headcount
    uncovered: list[str]             # duty shifts with zero headcount
    maintenance_window_staff: int    # headcount inside the window shifts


class CoverageReport(BaseModel):
    pattern: str
    days: list[DayCoverage]
    uncovered_slots_per_week: int
    verdict: str


@router.post("/coverage", response_model=CoverageReport)
def analyse_coverage(grid: PatternGrid):
    """Live coverage analysis of a weekly pattern.

    The number that should be zero in any defensible roster is
    `uncovered_slots_per_week`: day×shift cells where no one is on duty.
    """
    per_day, total_uncovered = compute_coverage(grid.rows, grid.maintenance_window_shifts)
    days = [
        DayCoverage(day=name, counts=counts, uncovered=uncovered, maintenance_window_staff=staff)
        for name, counts, uncovered, staff in per_day
    ]
    verdict = (
        "every shift covered every day"
        if total_uncovered == 0
        else f"{total_uncovered} uncovered shift-slot(s) per week — pattern needs rework"
    )
    return CoverageReport(
        pattern=grid.name,
        days=days,
        uncovered_slots_per_week=total_uncovered,
        verdict=verdict,
    )


class ShiftWorkPackage(BaseModel):
    """Due PM items bundled for one maintenance window, with the rostered crew."""
    for_date: date
    shift: str
    crew: list[str]
    items: list  # PMDueItem list (from the maintenance module)


@router.get("/work-package", response_model=ShiftWorkPackage)
def shift_work_package(for_date: date, shift: str = "N", db: Session = Depends(get_db), user=Depends(current_user)):
    """The roster↔maintenance join: PM items due by `for_date`, bundled for the
    given shift window, addressed to whoever the ACTIVE pattern rosters there —
    the printable 'this window, this crew, this list' package."""
    from app.api.maintenance import due_query  # local import avoids a cycle

    crew: list[str] = []
    pattern = db.scalar(select(RosterPattern).where(RosterPattern.is_active))
    if pattern:
        entries = db.scalars(
            select(RosterEntry).where(
                RosterEntry.pattern_id == pattern.id,
                RosterEntry.weekday == for_date.weekday(),
                RosterEntry.shift == shift,
            )
        ).all()
        crew = [e.user.full_name for e in entries]
    horizon = max(0, (for_date - date.today()).days)
    return ShiftWorkPackage(
        for_date=for_date, shift=shift, crew=crew, items=due_query(db, horizon)
    )
