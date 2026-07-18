"""AMPS domain model — v0.1 skeleton.

Generic maintenance-management entities. No organization-specific data:
every deployment configures its own location tree and asset classes.
"""
from datetime import date, datetime
from enum import Enum

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
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


class Criticality(str, Enum):
    """A = failure hurts safety/service immediately · B = significant · C = tolerable."""
    A = "A"
    B = "B"
    C = "C"


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(120), unique=True, index=True)  # printed on QR tag
    name: Mapped[str] = mapped_column(String(160))
    asset_class_id: Mapped[int] = mapped_column(ForeignKey("asset_classes.id"))
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"))
    make_model: Mapped[str | None] = mapped_column(String(160))
    # Reporting rollup a department thinks in (e.g. "Traction / PS", "Station E&M").
    # Free text so every deployment names its own systems; distinct from asset_class.
    system: Mapped[str | None] = mapped_column(String(80))
    commissioned_on: Mapped[date | None]
    status: Mapped[AssetStatus] = mapped_column(default=AssetStatus.IN_SERVICE)
    criticality: Mapped[Criticality] = mapped_column(default=Criticality.B)

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
    pm_schedule_id: Mapped[int | None] = mapped_column(ForeignKey("pm_schedules.id"))
    type: Mapped[WorkOrderType]
    status: Mapped[WorkOrderStatus] = mapped_column(default=WorkOrderStatus.OPEN)
    title: Mapped[str] = mapped_column(String(200))
    findings: Mapped[str | None] = mapped_column(Text)
    assigned_to: Mapped[str | None] = mapped_column(String(120))
    opened_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    closed_at: Mapped[datetime | None]

    asset: Mapped[Asset] = relationship(back_populates="work_orders")


class ShiftCode(str, Enum):
    """Generic shift codes; each deployment maps them to its own timings."""
    MORNING = "M"
    EVENING = "E"
    NIGHT = "N"
    GENERAL = "G"
    REST = "R"


class RosterPattern(Base):
    """A named weekly duty pattern (baseline or a pre-approved mode).

    Patterns are maintenance-planning objects, not attendance records:
    they tell the PM engine who is on duty in which window, so due work
    can be bundled into shift work packages.
    """
    __tablename__ = "roster_patterns"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    maintenance_window_shifts: Mapped[str] = mapped_column(String(20), default="N")  # csv of ShiftCode values
    is_active: Mapped[bool] = mapped_column(default=False)

    entries: Mapped[list["RosterEntry"]] = relationship(back_populates="pattern")


class RosterEntry(Base):
    """One cell of the weekly grid: person × weekday → shift."""
    __tablename__ = "roster_entries"
    __table_args__ = (UniqueConstraint("pattern_id", "user_id", "weekday"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    pattern_id: Mapped[int] = mapped_column(ForeignKey("roster_patterns.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    weekday: Mapped[int]  # 0 = Monday … 6 = Sunday
    shift: Mapped[ShiftCode]

    pattern: Mapped[RosterPattern] = relationship(back_populates="entries")
    user: Mapped["User"] = relationship()


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
    password_hash: Mapped[str | None] = mapped_column(String(200))
    # Access scope: a SITE location (e.g. a metro line). NULL = all sites (HQ/admin).
    line_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))

    line: Mapped["Location | None"] = relationship()


class LogEntryType(str, Enum):
    # Current taxonomy (2026-07, per the section's practice)
    MAINTENANCE = "maintenance"      # PM work — subtype carries the frequency
    FAILURE = "failure"              # breakdown noted in the book
    RECTIFICATION = "rectification"  # repair/fix work
    GENERAL = "general"              # everything else
    # Legacy values — kept for rows written before the taxonomy change
    OPERATION = "operation"      # switching, isolations, normal ops events
    OBSERVATION = "observation"  # readings, conditions noticed
    DEFECT = "defect"            # something wrong, to become a work order
    HANDOVER = "handover"        # shift handover note


class LogEntry(Base):
    """Digital shift logbook — the running record a section keeps by hand today.

    Entries are append-only (corrections are new entries referencing the old
    one), optionally tied to an asset so the asset's history card can show
    everything ever logged against it.
    """
    __tablename__ = "log_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    log_date: Mapped[date]                     # the duty date the entry belongs to
    shift: Mapped[ShiftCode] = mapped_column(default=ShiftCode.GENERAL)
    type: Mapped[LogEntryType] = mapped_column(default=LogEntryType.GENERAL)
    # maintenance frequency (Monthly / Quarterly / Half-Yearly / Yearly / Special)
    subtype: Mapped[str | None] = mapped_column(String(40))
    # equipment category — the asset class (auto-filled from the asset, editable)
    category: Mapped[str | None] = mapped_column(String(80))
    # Failure rows only: recovery moment and fault classification. `at` is the
    # start; downtime is derived (ended_at − at), never typed. NULL end on a
    # failure entry = still down. Kept on the one ledger rather than a second
    # table so the logbook stays the single source of truth.
    ended_at: Mapped[datetime | None]
    fault_type: Mapped[str | None] = mapped_column(String(120))
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"))
    text: Mapped[str] = mapped_column(Text)
    entered_by: Mapped[str] = mapped_column(String(120), default="unknown")
    corrects_id: Mapped[int | None] = mapped_column(ForeignKey("log_entries.id"))
    # Rectification rows only: the FAILURE entry this work fixes. Distinct from
    # corrects_id, which means "this entry corrects a mis-written entry" —
    # conflating the two would confuse a typo with a repair.
    #
    # State rule: THE LATEST ENTRY DOMINATES. A failure is open until a
    # rectification is logged against it, and the newest rectification carries
    # the recovery time — so a temporary fix followed by a permanent one just
    # works, and a fresh failure on the same asset opens it again.
    rectifies_id: Mapped[int | None] = mapped_column(ForeignKey("log_entries.id"))
    # Which site's (line's) logbook the entry belongs to. NULL = department-wide.
    line_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))

    asset: Mapped["Asset | None"] = relationship()


class Failure(Base):
    """A breakdown record: from the moment an asset fails to its recovery.

    Mirrors how power-supply sections actually log failures on paper:
    start/end time, fault type, what was done, who attended. Downtime is
    derived (end − start), never entered — one source of truth."""
    __tablename__ = "failures"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id"))
    started_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    ended_at: Mapped[datetime | None]
    fault_type: Mapped[str | None] = mapped_column(String(120))  # e.g. "DC earth fault"
    description: Mapped[str] = mapped_column(Text)               # what happened / how noticed
    work_done: Mapped[str | None] = mapped_column(Text)          # rectification, on close
    attended_by: Mapped[str | None] = mapped_column(String(160))
    work_order_id: Mapped[int | None] = mapped_column(ForeignKey("work_orders.id"))

    asset: Mapped[Asset] = relationship()


class AuditLog(Base):
    """Append-only trail of every mutation: the register is only 'the truth'
    if every change is attributable. Written via app.db.audit()."""
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    actor: Mapped[str] = mapped_column(String(60), default="system")  # username once auth lands
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[int]
    action: Mapped[str] = mapped_column(String(40))
    detail: Mapped[str | None] = mapped_column(Text)
