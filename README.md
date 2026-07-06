# ⚡ AMPS — Asset Maintenance & Preventive Scheduling

**An open-source maintenance management suite for electrical and industrial assets** — asset registers, QR-based identification, preventive-maintenance scheduling and work-order tracking, built for multi-site, multi-user field environments.

> Born from years of hands-on electrical maintenance practice — EOT crane maintenance in heavy industry, and traction-power / power-supply asset management in metro rail systems — AMPS encodes the record-keeping and planning discipline that field maintenance actually needs, and that spreadsheets cannot deliver at organizational scale.

**Author:** Arup Biswas · Electrical Engineer (industrial & metro-rail maintenance) · License: [MIT](LICENSE)

---

## Why AMPS exists

Maintenance departments everywhere run on scattered spreadsheets: one file per site, no single source of truth, no concurrency, no audit trail, no reliable roll-up reporting. Every transfer of personnel breaks the system; every audit is a scramble.

AMPS replaces that with a **single centralized system**:

| Problem with spreadsheets | AMPS answer |
|---|---|
| One file per site/line, endless reconciliation | One database, hierarchical locations (Site → Section → Station → Bay) |
| No idea which asset is which in the field | **QR tag on every asset** — scan to open its record & history |
| Maintenance schedules tracked by memory | **Preventive-maintenance engine** — due/overdue tracking, escalation |
| Anyone can silently edit anything | Role-based access + full audit trail |
| No management visibility | Dashboards: compliance %, overdue items, per-site roll-ups |

## Feature roadmap

- [x] Domain model: locations, asset classes, assets, PM schedules, work orders *(v0.1 skeleton)*
- [x] REST API skeleton (FastAPI) with QR-code generation per asset
- [ ] Preventive-maintenance due-date engine & calendar view
- [ ] Work-order lifecycle (open → assigned → done → verified)
- [ ] React front-end: asset browser, scan-to-view, PM dashboard
- [ ] Role-based auth (admin / supervisor / technician / viewer)
- [ ] Reports: compliance, downtime, asset history export
- [ ] Mobile-friendly field mode (scan, update, photo attach)
- [ ] Asset hierarchy & criticality: site → system → equipment tree with A/B/C criticality classes, so PM effort concentrates where failure hurts most
- [ ] Failure-code taxonomy: every breakdown classified once against a standard code set — analysable forever (root-cause trends, repeat-failure detection)
- [ ] Reliability analytics: MTBF / MTTR per asset class, availability % with planned-vs-unplanned outage separation
- [ ] Statutory / mandatory-test compliance alarms: overdue inspections (e.g. protection relays, earthing, batteries) flagged automatically — zero-miss, audit-ready register
- [ ] Maintenance-window work packages: due PMs auto-bundled per available window (night blocks, shutdowns), printable as a shift-ready package
- [ ] High-availability deployment profile: multi-node cluster (N hot + cold standby) with automated backups and restore drills
- [ ] AI maintenance assistant (LangChain): natural-language queries over the asset base — "which assets are overdue?", "what did we find last time on TRF-0001?"

## Architecture

```
 ┌────────────┐     REST/JSON      ┌──────────────┐      SQL       ┌────────────┐
 │  React UI  │  ◄──────────────►  │ FastAPI      │ ◄────────────► │ PostgreSQL │
 │  (Vite)    │                    │ Python 3.11+ │                │            │
 └────────────┘                    └──────────────┘                └────────────┘
       ▲                                  │
       │  QR scan (any phone camera)      │ qrcode generation per asset
       └──────────────────────────────────┘
```

- **Backend:** Python / FastAPI / SQLAlchemy / Alembic
- **Database:** PostgreSQL
- **Frontend:** React (Vite)
- **Deployment:** Docker Compose (single server + static IP is enough for a whole organization)

## Data model (v0.1)

```
Location (self-referencing tree: Site → Section → Station → Bay)
  └── Asset (code, class, make/model, commissioning date, status, QR)
        ├── PMSchedule (task, frequency, last_done, next_due)
        └── WorkOrder (type, status, assigned_to, findings, closed_at)
AssetClass (e.g. Transformer, HT Panel, LT Panel, PLC, Motor, Crane Hoist)
User (role: admin / supervisor / technician / viewer)
```

All sample data in this repository is **synthetic** — generic industrial asset examples for demonstration only.

## Quickstart (development)

```bash
docker compose up -d db          # PostgreSQL
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload    # API on :8000, docs at /docs
cd ../frontend && npm install && npm run dev   # UI on :5173
python backend/seed.py           # load synthetic demo data
```

## Philosophy

1. **The register is the truth.** If it isn't in the system, it didn't happen.
2. **Field-first.** A technician with a phone and a QR sticker is the primary user, not the office PC.
3. **Boring technology, dependable records.** Postgres + Python + React — maintainable for a decade.
4. **Generic core, configured instances.** AMPS ships with no organization-specific data; every deployment is a configuration, not a fork.

## Contributors & hosting

AMPS is authored and maintained by **Arup Biswas**. The **binidev team** (an open-source contributor group) contributes to the project and operates the public demo hosting (k3s). Design contributions: Nilanjan (binidev). Contributions via fork + pull request are welcome — all sample deployments must use synthetic data only.

## License

MIT © 2026 Arup Biswas — see [LICENSE](LICENSE). Attribution required on all copies.
