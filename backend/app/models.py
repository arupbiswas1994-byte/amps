"""AMPS domain model — v0.1 skeleton.

Generic maintenance-management entities. No organization-specific data:
every deployment configures its own location tree and asset classes.
"""
from datetime import date, datetime
from enum import Enum

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class LocationKind(str, Enum):
    SITE = "site"          # e.g. a plant, a metro line
    SECTION = "section"    # e.g. a depot, a zone
    STATION = "station"    # e.g. a substation, a bay group
    BAY = "bay"            # smallest addressable slot


class Location(Base):
    """Self-referencing tree: Site → Section → Station → Bay."""
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[LocationKind]
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))

    parent: Mapped["Location | None"] = relationship(remote_side=[id], back_populates="children")
    children: Mapped[list["Location"]] = relationship(back_populates="parent")
    assets: Mapped[list["Asset"]] = relationship(back_populates="location")


class AssetClass(Base):
    """e.g. Transformer, HT Panel, LT Panel, PLC, Motor, Crane Hoist."""
    __tablename__ = "asset_classes"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str | None] = mapped_column(Text)


class AssetStatus(str, Enum):
    IN_SERVICE = "in_service"
    UNDER_MAINTENANCE = "under_maintenance"
    OUT_OF_SERVICE = "out_of_service"
    DECOMMISSIONED = "decommissioned"


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(60), unique=True, index=True)  # printed on QR tag
    name: Mapped[str] = mapped_column(String(160))
    asset_class_id: Mapped[int] = mapped_column(ForeignKey("asset_classes.id"))
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"))
    make_model: Mapped[str | None] = mapped_column(String(160))
    commissioned_on: Mapped[date | None]
    status: Mapped[AssetStatus] = mapped_column(default=AssetStatus.IN_SERVICE)

    asset_class: Mapped[AssetClass] = relationship()
    location: Mapped[Location] = relationship(back_populates="assets")
    pm_schedules: Mapped[list["PMSchedule"]] = relationship(back_populates="asset")
    work_orders: Mapped[list["WorkOrder"]] = relationship(back_populates="asset")


class PMFrequency(str, Enum):
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    HALF_YEARLY = "half_yearly"
    YEARLY = "yearly"


class PMSchedule(Base):
    """Preventive-maintenance schedule attached to an asset."""
    __tablename__ = "pm_schedules"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id"))
    task: Mapped[str] = mapped_column(String(200))
    frequency: Mapped[PMFrequency]
    last_done: Mapped[date | None]
    next_due: Mapped[date | None]

    asset: Mapped[Asset] = relationship(back_populates="pm_schedules")


class WorkOrderStatus(str, Enum):
    OPEN = "open"
    ASSIGNED = "assigned"
    DONE = "done"
    VERIFIED = "verified"
    CANCELLED = "cancelled"


class WorkOrderType(str, Enum):
    PREVENTIVE = "preventive"
    BREAKDOWN = "breakdown"
    INSPECTION = "inspection"


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id"))
    type: Mapped[WorkOrderType]
    status: Mapped[WorkOrderStatus] = mapped_column(default=WorkOrderStatus.OPEN)
    title: Mapped[str] = mapped_column(String(200))
    findings: Mapped[str | None] = mapped_column(Text)
    assigned_to: Mapped[str | None] = mapped_column(String(120))
    opened_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    closed_at: Mapped[datetime | None]

    asset: Mapped[Asset] = relationship(back_populates="work_orders")


class UserRole(str, Enum):
    ADMIN = "admin"
    SUPERVISOR = "supervisor"
    TECHNICIAN = "technician"
    VIEWER = "viewer"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(60), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[UserRole] = mapped_column(default=UserRole.VIEWER)
