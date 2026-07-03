"""Preventive-maintenance endpoints — v0.1 skeleton."""
from datetime import date

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class PMDueItem(BaseModel):
    asset_code: str
    task: str
    next_due: date
    overdue_days: int


@router.get("/due", response_model=list[PMDueItem])
def due_list():
    """PM items due/overdue — the daily planning list. Skeleton returns empty."""
    return []
