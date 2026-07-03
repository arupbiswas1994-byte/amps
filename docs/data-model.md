# AMPS Data Model — design notes (v0.1)

## Principles

1. **Location is a tree, not columns.** Organizations differ (plant/shop vs line/depot/substation); a self-referencing `Location` table with a `kind` field adapts to any hierarchy without schema change.
2. **The asset code is the physical contract.** `Asset.code` is what's printed in the QR tag on the equipment. It is unique, human-readable, and never reused.
3. **Schedules generate work; work leaves history.** `PMSchedule` says what *should* happen and when; `WorkOrder` records what *did* happen. Compliance = comparing the two.
4. **Roles, not permissions-per-user.** Four roles cover field reality: admin, supervisor, technician, viewer.

## Entity sketch

```
Location (tree)        AssetClass
     │                     │
     └──────► Asset ◄──────┘
                │
      ┌─────────┴──────────┐
   PMSchedule           WorkOrder
   (planned)            (actual)
```

## Deliberate v0.1 omissions

- Spare-parts/inventory (v1.x)
- Meter readings / condition monitoring (v1.x)
- Document attachments (photos, test reports) (v0.4)
- Multi-tenancy — AMPS is single-organization by design; deploy one instance per org.
