"""Unit tests for the pure computation engines (no framework required)."""
from datetime import date, timedelta

from app.engine import (
    compute_coverage, next_due, overdue_days, priority_score,
)


def test_next_due_never_done_is_today():
    assert next_due("monthly", None) == date.today()


def test_next_due_rolls_by_frequency():
    last = date(2026, 1, 1)
    assert next_due("weekly", last) == date(2026, 1, 8)
    assert next_due("quarterly", last) == last + timedelta(days=91)


def test_overdue_days():
    today = date(2026, 7, 10)
    assert overdue_days(date(2026, 7, 6), today) == 4
    assert overdue_days(date(2026, 7, 12), today) == 0  # not yet due


def test_priority_criticality_beats_date():
    # critical asset 2 days overdue outranks tolerable asset 5 days overdue
    assert priority_score("A", 2) > priority_score("C", 5)
    # within the same criticality, more overdue = higher
    assert priority_score("B", 5) > priority_score("B", 1)


def test_coverage_balanced_pattern_has_no_men_gaps():
    rows = {
        "S1": ["M", "E", "N", "R", "G", "M", "E"],
        "S2": ["E", "N", "R", "M", "E", "N", "G"],
        "S3": ["N", "M", "E", "N", "M", "R", "N"],
        "T1": ["G", "G", "M", "E", "N", "E", "M"],
    }
    per_day, _ = compute_coverage(rows, ["N"])
    for _, counts, _, window_staff in per_day:
        assert counts["M"] >= 1 and counts["E"] >= 1 and counts["N"] >= 1
        assert window_staff >= 1  # night window always staffed


def test_coverage_flags_all_general_pattern():
    rows = {f"P{i}": ["G"] * 6 + ["R"] for i in range(8)}
    per_day, uncovered = compute_coverage(rows, ["N"])
    # M/E/N empty all 7 days + Sunday G empty (everyone resting) = 22
    assert uncovered == 22
    _, _, sunday_uncovered, _ = per_day[6]
    assert sunday_uncovered == ["M", "E", "N", "G"]  # Sunday fully dark
