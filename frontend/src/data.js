// Synthetic demo dataset — ALL FICTIONAL, generic industrial examples only.
// Mirrors backend/seed.py; due dates are computed relative to "today" so the
// demo never goes stale. Replaced by the live API when the SQLAlchemy layer
// lands (v0.2).

const day = 86400000
const today = new Date()
const d = (offset) => new Date(today.getTime() + offset * day)

export const LOCATIONS = [
  { name: 'Demo Plant', kind: 'site', parent: null },
  { name: 'Substation-1', kind: 'station', parent: 'Demo Plant' },
  { name: 'Workshop Bay-A', kind: 'bay', parent: 'Demo Plant' },
]

export const ASSETS = [
  { code: 'TRF-0001', name: '33kV/415V Distribution Transformer', cls: 'Transformer', location: 'Substation-1', makeModel: 'GenElec GT-3300 · 2.5 MVA', commissioned: '2019-03-12', status: 'in_service' },
  { code: 'HTP-0001', name: '33kV Incomer Panel', cls: 'HT Panel', location: 'Substation-1', makeModel: 'SwitchCraft VCB-33', commissioned: '2019-03-12', status: 'in_service' },
  { code: 'HTP-0002', name: '33kV Outgoing Feeder Panel', cls: 'HT Panel', location: 'Substation-1', makeModel: 'SwitchCraft VCB-33', commissioned: '2019-03-12', status: 'under_maintenance' },
  { code: 'LTP-0001', name: '415V Main LT Panel', cls: 'LT Panel', location: 'Substation-1', makeModel: 'PowerBoard MDB-4000', commissioned: '2019-04-02', status: 'in_service' },
  { code: 'PLC-0001', name: 'Bay Automation PLC', cls: 'PLC', location: 'Workshop Bay-A', makeModel: 'LogicWorks LX-500', commissioned: '2021-08-19', status: 'in_service' },
  { code: 'MTR-0001', name: '75kW Compressor Motor', cls: 'Motor', location: 'Workshop Bay-A', makeModel: 'DriveMax IE3-75', commissioned: '2020-01-27', status: 'in_service' },
  { code: 'CRN-0001', name: '10T EOT Crane Hoist', cls: 'Crane Hoist', location: 'Workshop Bay-A', makeModel: 'LiftPro EOT-10', commissioned: '2018-11-05', status: 'in_service' },
  { code: 'MTR-0002', name: '22kW Ventilation Fan Motor', cls: 'Motor', location: 'Workshop Bay-A', makeModel: 'DriveMax IE3-22', commissioned: '2020-06-15', status: 'out_of_service' },
]

export const PM_SCHEDULES = [
  { asset: 'TRF-0001', task: 'Oil BDV test', frequency: 'half-yearly', lastDone: d(-170), nextDue: d(12) },
  { asset: 'TRF-0001', task: 'Winding temperature calibration', frequency: 'yearly', lastDone: d(-320), nextDue: d(45) },
  { asset: 'HTP-0001', task: 'Contact resistance check', frequency: 'yearly', lastDone: d(-371), nextDue: d(-6) },
  { asset: 'HTP-0002', task: 'Insulation resistance (IR) test', frequency: 'half-yearly', lastDone: d(-179), nextDue: d(3) },
  { asset: 'LTP-0001', task: 'Thermographic scan', frequency: 'quarterly', lastDone: d(-70), nextDue: d(21) },
  { asset: 'PLC-0001', task: 'Battery & backup verification', frequency: 'quarterly', lastDone: d(-93), nextDue: d(-2) },
  { asset: 'MTR-0001', task: 'Vibration analysis', frequency: 'monthly', lastDone: d(-25), nextDue: d(5) },
  { asset: 'CRN-0001', task: 'Brake & limit-switch inspection', frequency: 'monthly', lastDone: d(-21), nextDue: d(9) },
]

export const WORK_ORDERS = [
  { id: 'WO-104', asset: 'HTP-0002', type: 'inspection', status: 'open', title: 'IR test before re-energizing feeder', openedAt: d(0), closedAt: null, assignedTo: null, findings: null },
  { id: 'WO-103', asset: 'MTR-0002', type: 'breakdown', status: 'assigned', title: 'DE bearing seized — replacement', openedAt: d(-2), closedAt: null, assignedTo: 'Technician A', findings: null },
  { id: 'WO-102', asset: 'CRN-0001', type: 'preventive', status: 'done', title: 'Monthly brake & limit-switch inspection', openedAt: d(-6), closedAt: d(-5), assignedTo: 'Technician B', findings: 'Brake pads within wear limit; LS2 limit switch adjusted.' },
  { id: 'WO-101', asset: 'TRF-0001', type: 'preventive', status: 'verified', title: 'Half-yearly oil BDV test', openedAt: d(-36), closedAt: d(-34), assignedTo: 'Technician A', findings: 'BDV 62 kV — within limits.' },
]

// ---- derived helpers ----

export const fmtDate = (date) =>
  date ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export const daysUntil = (date) => Math.ceil((date - today) / day)

export function dueState(nextDue) {
  const n = daysUntil(nextDue)
  if (n < 0) return { key: 'overdue', label: `Overdue ${-n}d` }
  if (n <= 7) return { key: 'due_soon', label: `Due in ${n}d` }
  return { key: 'ok', label: 'On schedule' }
}

export function kpis() {
  const overdue = PM_SCHEDULES.filter((p) => daysUntil(p.nextDue) < 0).length
  const dueSoon = PM_SCHEDULES.filter((p) => { const n = daysUntil(p.nextDue); return n >= 0 && n <= 7 }).length
  const compliance = Math.round(((PM_SCHEDULES.length - overdue) / PM_SCHEDULES.length) * 100)
  const openWO = WORK_ORDERS.filter((w) => w.status === 'open' || w.status === 'assigned').length
  return { assets: ASSETS.length, compliance, dueSoon, overdue, openWO }
}
