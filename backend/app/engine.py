# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""AMPS pure computation engines — framework-free and unit-testable.

Everything here is plain Python (no FastAPI/SQLAlchemy imports) so the
core logic can be tested and reused anywhere: API, CLI, batch jobs.
"""
from datetime import date, timedelta

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DUTY_SHIFTS = ["M", "E", "N", "G"]  # R (rest) is never a coverage slot

FREQUENCY_DAYS = {
    "weekly": 7,
    "monthly": 30,
    "quarterly": 91,
    "half_yearly": 182,
    "yearly": 365,
}


# ---------------- preventive-maintenance engine ----------------

def next_due(frequency, last_done):
    """Next due date for a PM task: last_done + frequency interval.
    If never done, it is due immediately (today)."""
    if last_done is None:
        return date.today()
    return last_done + timedelta(days=FREQUENCY_DAYS[frequency])


def overdue_days(due, today=None):
    """Days overdue (0 if not yet due)."""
    today = today or date.today()
    return max(0, (today - due).days)


CRITICALITY_WEIGHT = {"A": 3, "B": 2, "C": 1}


def priority_score(criticality, overdue):
    """Maintenance triage is criticality x overdue, not date order alone:
    an overdue check on a critical asset outranks a very-overdue check on a
    tolerable one. Score = weight x (1 + days overdue)."""
    return CRITICALITY_WEIGHT.get(criticality, 2) * (1 + overdue)


# ---------------- roster coverage engine ----------------

def compute_coverage(rows, window_shifts):
    """Coverage analysis of a weekly duty pattern.

    rows: {person: [7 shift codes, Monday first]}
    window_shifts: shift codes counted as the maintenance window.
    Returns (per_day, total_uncovered); per_day items are
    (day_name, counts, uncovered, window_staff).
    The number that should be zero in any defensible roster is
    total_uncovered: day x shift cells where no one is on duty.
    """
    per_day = []
    total_uncovered = 0
    for d in range(7):
        counts = {s: 0 for s in DUTY_SHIFTS}
        for shifts in rows.values():
            if d < len(shifts) and shifts[d] in counts:
                counts[shifts[d]] += 1
        uncovered = [s for s, n in counts.items() if n == 0]
        total_uncovered += len(uncovered)
        window_staff = sum(counts.get(s, 0) for s in window_shifts)
        per_day.append((WEEKDAYS[d], counts, uncovered, window_staff))
    return per_day, total_uncovered
