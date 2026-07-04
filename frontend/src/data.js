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

export const SPECS = {
  'TRF-0001': [['Rating', '2.5 MVA'], ['Voltage ratio', '33 / 0.415 kV'], ['Vector group', 'Dyn11'], ['Cooling', 'ONAN'], ['% impedance', '6.2%'], ['Oil quantity', '1850 L'], ['Tap range', '±5% in 2.5% steps']],
  'HTP-0001': [['Type', 'VCB, indoor'], ['Rated current', '1250 A'], ['Breaking capacity', '25 kA / 3 s'], ['O/C pickup', '110% In'], ['E/F pickup', '20% In'], ['Control supply', '110 V DC']],
  'HTP-0002': [['Type', 'VCB, indoor'], ['Rated current', '800 A'], ['Breaking capacity', '25 kA / 3 s'], ['O/C pickup', '105% In'], ['Control supply', '110 V DC']],
  'LTP-0001': [['Busbar rating', '4000 A'], ['Short-circuit rating', '50 kA / 1 s'], ['Incomer', 'ACB 4000 A EDO'], ['Outgoing feeders', '12']],
  'PLC-0001': [['CPU', 'LX-500 series'], ['I/O count', '128 DI / 64 DO / 32 AI'], ['Backup', 'UPS 1 kVA, 30 min'], ['Comm', 'Modbus TCP + RS-485']],
  'MTR-0001': [['Rating', '75 kW / 100 HP'], ['Speed', '2960 RPM'], ['FLC', '132 A @ 415 V'], ['Frame', '280M'], ['Bearings', 'DE 6320-C3 / NDE 6316-C3']],
  'CRN-0001': [['SWL', '10 T'], ['Span', '18 m'], ['Hoist motor', '15 kW'], ['LT / CT speed', '20 / 15 m/min'], ['Brake', 'EM disc, 2×']],
  'MTR-0002': [['Rating', '22 kW / 30 HP'], ['Speed', '1470 RPM'], ['FLC', '41 A @ 415 V'], ['Frame', '180L'], ['Bearings', 'DE 6312-C3 / NDE 6310-C3']],
}

const hrs = 3600000
const t = (dOff, h) => new Date(today.getTime() + dOff * day + (h - today.getHours()) * hrs)

export const LOG_ENTRIES = [
  { ts: t(0, 9), shift: 'A', author: 'S. Kumar', text: '33kV incomer load 42 A, all feeders normal. HTP-0002 kept isolated for IR test (WO-104).' },
  { ts: t(-1, 22), shift: 'C', author: 'A. Sen', text: 'Night round normal. Substation-1 battery charger float 122 V. Handover: nil pending.' },
  { ts: t(-1, 16), shift: 'B', author: 'R. Das', text: 'MTR-0002 replacement bearing followed up with stores — expected in 3 days (PR-2026-015). Bay ventilation running on standby fan.' },
  { ts: t(-1, 9), shift: 'A', author: 'S. Kumar', text: 'DG set test run 15 min — voltage/frequency OK. Diesel level 78%.' },
  { ts: t(-2, 21), shift: 'C', author: 'A. Sen', text: 'Workshop Bay-A lighting circuit MCB tripped once, reset, holding. To observe.' },
  { ts: t(-2, 14), shift: 'B', author: 'R. Das', text: 'MTR-0002 abnormal noise reported by operator → isolated, breakdown WO-103 raised, DE bearing found seized.' },
  { ts: t(-2, 9), shift: 'A', author: 'S. Kumar', text: 'Monthly brake inspection on CRN-0001 completed (WO-102). Brake pads within limit, LS2 adjusted.' },
]

export const PROCUREMENTS = [
  { id: 'PR-2026-016', item: 'VCB spring-charge motor (spare)', qty: '1 no.', asset: 'HTP-0001', stage: 'draft', requested: d(-1), cost: '—', note: 'Recommended spare per OEM list; none in stock.' },
  { id: 'PR-2026-015', item: 'DE bearing 6312-C3 for 22 kW ventilation fan motor', qty: '2 nos.', asset: 'MTR-0002', stage: 'proposed', requested: d(-2), cost: '₹ 18,400 (est.)', note: 'Against breakdown WO-103; one for replacement, one for stock.', failure: 'F-02' },
  { id: 'PR-2026-014', item: 'Transformer oil, EHV grade — 200 L drums', qty: '2 drums', asset: 'TRF-0001', stage: 'ordered', requested: d(-18), cost: '₹ 52,000', note: 'Top-up + reserve ahead of half-yearly filtration.' },
  { id: 'PR-2026-013', item: 'SMF batteries 12 V / 26 Ah for PLC UPS', qty: '4 nos.', asset: 'PLC-0001', stage: 'received', requested: d(-32), cost: '₹ 14,800', note: 'Replaced after UPS battery failure (F-03).' },
  { id: 'PR-2026-012', item: 'Crane hoist brake pad set', qty: '2 sets', asset: 'CRN-0001', stage: 'approved', requested: d(-40), cost: '₹ 9,600', note: 'Preventive replacement stock for monthly inspections.' },
]

export const PROC_STAGES = ['draft', 'proposed', 'approved', 'ordered', 'received']

export const SPARES = [
  { code: 'SP-001', name: 'DE bearing 6312-C3', cls: 'Motor', bin: 'Store-1 / R2-B4', qty: 0, min: 2, unit: 'nos.', pr: 'PR-2026-015' },
  { code: 'SP-002', name: 'DE bearing 6320-C3', cls: 'Motor', bin: 'Store-1 / R2-B5', qty: 1, min: 1, unit: 'nos.', pr: null },
  { code: 'SP-003', name: 'VCB spring-charge motor', cls: 'HT Panel', bin: 'Store-1 / R1-A2', qty: 0, min: 1, unit: 'nos.', pr: 'PR-2026-016' },
  { code: 'SP-004', name: 'Crane hoist brake pad set', cls: 'Crane Hoist', bin: 'Store-2 / R4-C1', qty: 2, min: 2, unit: 'sets', pr: 'PR-2026-012' },
  { code: 'SP-005', name: 'SMF battery 12 V / 26 Ah', cls: 'PLC', bin: 'Store-1 / R3-A1', qty: 4, min: 4, unit: 'nos.', pr: null },
  { code: 'SP-006', name: 'HT fuse link 33 kV', cls: 'HT Panel', bin: 'Store-1 / R1-A4', qty: 6, min: 4, unit: 'nos.', pr: null },
  { code: 'SP-007', name: 'PT secondary fuse 2 A', cls: 'LT Panel', bin: 'Store-1 / R1-B1', qty: 3, min: 6, unit: 'nos.', pr: null },
  { code: 'SP-008', name: 'Transformer oil, EHV grade', cls: 'Transformer', bin: 'Oil store', qty: 400, min: 600, unit: 'L', pr: 'PR-2026-014' },
  { code: 'SP-009', name: 'Power contactor 95 A', cls: 'LT Panel', bin: 'Store-1 / R1-B3', qty: 2, min: 1, unit: 'nos.', pr: null },
  { code: 'SP-010', name: 'Hoist limit switch', cls: 'Crane Hoist', bin: 'Store-2 / R4-C2', qty: 1, min: 2, unit: 'nos.', pr: null },
]

export function spareStats() {
  const below = SPARES.filter((s) => s.qty < s.min)
  const covered = below.filter((s) => s.pr).length
  return { items: SPARES.length, below: below.length, uncovered: below.length - covered }
}

export const FAILURES = [
  { id: 'F-02', asset: 'MTR-0002', started: t(-2, 14), restored: null, cause: 'DE bearing seized — abnormal noise, motor isolated', remedy: 'Bearing replacement in progress (WO-103, PR-2026-015)' },
  { id: 'F-03', asset: 'PLC-0001', started: t(-20, 11), restored: t(-20, 12), cause: 'UPS battery failure — PLC halted on supply dip', remedy: 'Batteries replaced (PR-2026-013); auto-restart verified' },
  { id: 'F-01', asset: 'HTP-0002', started: t(-35, 15), restored: t(-35, 18), cause: 'Feeder VCB tripped on over-current', remedy: 'Downstream cable fault isolated; relay reset after inspection' },
  { id: 'F-04', asset: 'CRN-0001', started: t(-48, 10), restored: t(-48, 12), cause: 'Hoist upper limit switch malfunction', remedy: 'LS replaced from stock; travel re-calibrated' },
  { id: 'F-05', asset: 'LTP-0001', started: t(-61, 9), restored: t(-61, 10), cause: 'Bus PT fuse blown — metering lost', remedy: 'Fuse replaced; PT secondary wiring checked' },
  { id: 'F-06', asset: 'TRF-0001', started: t(-75, 8), restored: t(-75, 12), cause: 'Buchholz alarm — precautionary shutdown', remedy: 'Gas sample tested inert; no internal fault; normalized' },
  { id: 'F-07', asset: 'HTP-0001', started: t(-82, 17), restored: t(-82, 18), cause: '33 kV incomer tripped on grid disturbance', remedy: 'Supply restored on grid normalization; relays checked' },
]

// Checksheet templates per PM task — items with acceptance limits.
// Filled readings live on the work order (RESULTS below); a task without a
// completed WO renders as a blank sheet to print and fill in the field.
export const CHECKSHEET_TEMPLATES = {
  'Oil BDV test': [
    ['Oil sample drawn from bottom sampling valve', '—'],
    ['Visual check — colour & clarity', 'Clear, no turbidity'],
    ['Breakdown voltage (BDV)', '≥ 50 kV'],
    ['Moisture / crackle test', 'No crackle'],
    ['Sample bottle labelled & retained', '—'],
    ['Oil level in conservator', 'Between marks'],
  ],
  'Brake & limit-switch inspection': [
    ['Brake pad thickness', '≥ 5 mm'],
    ['Brake holding test at rated load', 'No drift'],
    ['LS1 — upper limit trip', 'Trips'],
    ['LS2 — over-hoist backup trip', 'Trips'],
    ['Pendant emergency stop', 'Opens main contactor'],
    ['Hook safety latch', 'Intact'],
  ],
  'Battery & backup verification': [
    ['UPS float voltage', '13.5–13.8 V/battery'],
    ['Backup duration on mains fail', '≥ 15 min'],
    ['Terminals cleaned & greased', '—'],
    ['Mains-fail alarm at SCADA/panel', 'Reports'],
  ],
  'Contact resistance check': [
    ['CRM — R phase', '≤ 50 µΩ'],
    ['CRM — Y phase', '≤ 50 µΩ'],
    ['CRM — B phase', '≤ 50 µΩ'],
    ['Deviation from last measurement', '≤ 20%'],
    ['Joint torque check', 'Per OEM chart'],
  ],
  'Insulation resistance (IR) test': [
    ['IR — HV to earth', '≥ 1000 MΩ'],
    ['IR — HV to LV', '≥ 1000 MΩ'],
    ['IR — LV to earth', '≥ 100 MΩ'],
    ['PI ratio (10 min / 1 min)', '≥ 1.5'],
  ],
}

const GENERIC_CHECKSHEET = [
  ['Visual inspection — no damage / hotspot / abnormal sound', '—'],
  ['Cleaning of equipment & surroundings', '—'],
  ['Fasteners & terminations checked', 'Torque per OEM'],
  ['Safety devices / interlocks functional', 'Operates'],
  ['Readings recorded in log book', '—'],
]

export const checksheetFor = (task) => CHECKSHEET_TEMPLATES[task] ?? GENERIC_CHECKSHEET

// Filled checksheets for completed work orders: readings per template row.
export const CHECKSHEET_RESULTS = {
  'WO-101': {
    task: 'Oil BDV test',
    readings: ['Done', 'Clear', '62 kV', 'No crackle', 'Bottle T-114', 'Normal'],
    doneBy: 'Technician A', checkedBy: 'R. Das (Supervisor)', approvedBy: 'Sr. Engineer (E)',
  },
  'WO-102': {
    task: 'Brake & limit-switch inspection',
    readings: ['7.5 mm', 'No drift', 'Trips OK', 'Trips (adjusted)', 'OK', 'Intact'],
    doneBy: 'Technician B', checkedBy: 'R. Das (Supervisor)', approvedBy: 'Sr. Engineer (E)',
  },
}

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

export const fmtTime = (date) =>
  date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export const durationHrs = (f) =>
  Math.round(((f.restored ?? today) - f.started) / hrs * 10) / 10

export function failureStats() {
  const restored = FAILURES.filter((f) => f.restored)
  const ongoing = FAILURES.length - restored.length
  const downtime = Math.round(FAILURES.reduce((s, f) => s + durationHrs(f), 0))
  const mttr = Math.round(restored.reduce((s, f) => s + durationHrs(f), 0) / restored.length * 10) / 10
  const byClass = {}
  FAILURES.forEach((f) => {
    const cls = ASSETS.find((a) => a.code === f.asset)?.cls ?? '?'
    byClass[cls] = (byClass[cls] ?? 0) + 1
  })
  return { total: FAILURES.length, ongoing, downtime, mttr, byClass }
}

// Project PM occurrences onto a month grid (frequency-stepped from nextDue).
const FREQ_DAYS = { monthly: 30, quarterly: 91, 'half-yearly': 182, yearly: 365 }
export function pmOccurrencesInMonth(year, month) {
  const out = {}
  for (const p of PM_SCHEDULES) {
    let due = new Date(p.nextDue)
    for (let i = 0; i < 24 && due <= new Date(year, month + 1, 1); i++) {
      if (due.getFullYear() === year && due.getMonth() === month) {
        const key = due.getDate()
        ;(out[key] ??= []).push({ ...p, due })
      }
      due = new Date(due.getTime() + FREQ_DAYS[p.frequency] * day)
    }
  }
  return out
}

export function kpis() {
  const overdue = PM_SCHEDULES.filter((p) => daysUntil(p.nextDue) < 0).length
  const dueSoon = PM_SCHEDULES.filter((p) => { const n = daysUntil(p.nextDue); return n >= 0 && n <= 7 }).length
  const compliance = Math.round(((PM_SCHEDULES.length - overdue) / PM_SCHEDULES.length) * 100)
  const openWO = WORK_ORDERS.filter((w) => w.status === 'open' || w.status === 'assigned').length
  return { assets: ASSETS.length, compliance, dueSoon, overdue, openWO }
}
