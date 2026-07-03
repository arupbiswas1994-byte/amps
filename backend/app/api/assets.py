"""Asset register endpoints — v0.1 skeleton (in-memory demo store)."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class AssetIn(BaseModel):
    code: str
    name: str
    asset_class: str
    location: str
    make_model: str | None = None


class AssetOut(AssetIn):
    id: int
    status: str = "in_service"


# Skeleton in-memory store; replaced by PostgreSQL/SQLAlchemy in v0.2
_DEMO: dict[int, AssetOut] = {}
_next_id = 1


@router.get("", response_model=list[AssetOut])
def list_assets():
    return list(_DEMO.values())


@router.post("", response_model=AssetOut, status_code=201)
def create_asset(asset: AssetIn):
    global _next_id
    out = AssetOut(id=_next_id, **asset.model_dump())
    _DEMO[_next_id] = out
    _next_id += 1
    return out


@router.get("/{asset_id}", response_model=AssetOut)
def get_asset(asset_id: int):
    if asset_id not in _DEMO:
        raise HTTPException(404, "asset not found")
    return _DEMO[asset_id]
