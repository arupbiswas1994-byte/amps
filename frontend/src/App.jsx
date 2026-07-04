import { useEffect, useState } from 'react'
import {
  ASSETS, PM_SCHEDULES, JOB_CARDS, SPECS, LOG_ENTRIES, PROCUREMENTS, PROC_STAGES,
  FAILURES, SPARES, spareStats, checksheetFor, CHECKSHEET_TEMPLATES, CHECKSHEET_RESULTS,
  completedChecksheets, kpis, fmtDate, fmtTime, dueState, durationHrs, failureStats,
  pmOccurrencesInMonth,
} from './data.js'
import QR, { assetUrl } from './qr.jsx'

const STATUS_LABEL = {
  in_service: 'In service',
  under_maintenance: 'Under maintenance',
  out_of_service: 'Out of service',
  decommissioned: 'Decommissioned',
}

const StatusChip = ({ status }) => (
  <span className={`chip s-${status}`}><span className="dot" />{STATUS_LABEL[status]}</span>
)

const DueChip = ({ nextDue }) => {
  const s = dueState(nextDue)
  return <span className={`chip d-${s.key}`}><span className="dot" />{s.label}</span>
}

const cap = (s) => s[0].toUpperCase() + s.slice(1)

const WoChip = ({ status }) => (
  <span className={`chip w-${status}`}><span className="dot" />{cap(status)}</span>
)

const StageChip = ({ stage }) => (
  <span className={`chip p-${stage}`}><span className="dot" />{cap(stage)}</span>
)

/* ---------- dashboard ---------- */

function Dashboard({ go }) {
  const k = kpis()
  const nextPM = (code) =>
    PM_SCHEDULES.filter((p) => p.asset === code).sort((a, b) => a.nextDue - b.nextDue)[0] ?? null
  return (
    <>
      <div className="kpis">
        <div className="tile"><div className="v">{k.assets}</div><div className="k">Assets registered</div></div>
        <div className="tile"><div className="v">{k.compliance}%</div><div className="k">PM compliance</div></div>
        <div className={k.dueSoon ? 'tile warn' : 'tile'}><div className="v">{k.dueSoon}</div><div className="k">PM due within 7 days</div></div>
        <div className={k.overdue ? 'tile alert' : 'tile'}><div className="v">{k.overdue}</div><div className="k">PM overdue</div></div>
        <div className="tile"><div className="v">{k.openJC}</div><div className="k">Open job cards</div></div>
      </div>

      <h2>Asset register</h2>
      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr><th>Code</th><th>Asset</th><th>Class</th><th>Location</th><th>Status</th><th>Next PM</th><th>PM state</th><th>Records</th></tr>
          </thead>
          <tbody>
            {ASSETS.map((a) => {
              const pm = nextPM(a.code)
              return (
                <tr key={a.code} tabIndex={0} onClick={() => go(`/asset/${a.code}`)}
                    onKeyDown={(e) => e.key === 'Enter' && go(`/asset/${a.code}`)}>
                  <td className="code" data-l="Code">{a.code}</td>
                  <td data-l="Asset">{a.name}</td>
                  <td className="dim" data-l="Class">{a.cls}</td>
                  <td className="dim" data-l="Location">{a.location}</td>
                  <td data-l="Status"><StatusChip status={a.status} /></td>
                  <td className="dim dt" data-l="Next PM">{pm ? fmtDate(pm.nextDue) : '—'}</td>
                  <td data-l="PM state">{pm ? <DueChip nextDue={pm.nextDue} /> : <span className="dim">—</span>}</td>
                  <td data-l="Records">{(() => {
                    const n = completedChecksheets(a.code).length
                    return n ? <span className="rec-count" title={`${n} completed checksheet${n > 1 ? 's' : ''}`}>✓ {n}</span> : <span className="dim">—</span>
                  })()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

    </>
  )
}

/* ---------- asset detail ---------- */

function AssetDetail({ code }) {
  const a = ASSETS.find((x) => x.code === code)
  if (!a) return <p>Asset not found. <a className="crumb" href="#/">← Back to register</a></p>
  const pms = PM_SCHEDULES.filter((p) => p.asset === code)
  const wos = JOB_CARDS.filter((w) => w.asset === code)
  const specs = SPECS[code] ?? []
  return (
    <>
      <a className="crumb" href="#/">← Asset register</a>
      <div className="detail-grid">
        <div className="card">
          <div className="detail-head">
            <h1><span className="code">{a.code}</span> · {a.name}</h1>
            <div className="meta">
              <span><b>{a.cls}</b></span>
              <span>{a.location} · Demo Plant</span>
              <span>{a.makeModel}</span>
              <span>Commissioned <b className="dt">{a.commissioned}</b></span>
              <StatusChip status={a.status} />
            </div>
          </div>

          {specs.length > 0 && (
            <div className="sect">
              <h3>Specifications</h3>
              <dl className="specs">
                {specs.map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
            </div>
          )}

          <div className="sect">
            <h3>Preventive maintenance</h3>
            {pms.length === 0 ? <p className="dim">No PM schedules.</p> : (
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Task</th><th>Frequency</th><th>Last done</th><th>Next due</th><th>State</th><th></th></tr></thead>
                  <tbody>
                    {pms.map((p) => (
                      <tr key={p.task} style={{ cursor: 'default' }}>
                        <td data-l="Task">{p.task}</td>
                        <td className="dim" data-l="Frequency">{p.frequency}</td>
                        <td className="dim dt" data-l="Last done">{fmtDate(p.lastDone)}</td>
                        <td className="dt" data-l="Next due">{fmtDate(p.nextDue)}</td>
                        <td data-l="State"><DueChip nextDue={p.nextDue} /></td>
                        <td className="cs-cell">
                          {(() => {
                            const rec = completedChecksheets(a.code).find((r) => r.task === p.task)
                            return rec
                              ? <a className="mini-btn" href={`#/checksheet/wo/${rec.woId}`}>Record ✓</a>
                              : <a className="mini-btn muted" href={`#/checksheet/pm/${a.code}/${encodeURIComponent(p.task)}`}>Blank sheet</a>
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="sect">
            <h3>Job cards — issued to departments / agencies</h3>
            {wos.length === 0 ? <p className="dim">No job cards.</p> : wos.map((w) => (
              <div className="wo" key={w.id}>
                <div className="row1">
                  <span className="code">{w.id}</span>
                  <span className="t">{w.title}</span>
                  <WoChip status={w.status} />
                  {CHECKSHEET_RESULTS[w.id] && (
                    <a className="mini-btn" href={`#/checksheet/wo/${w.id}`}>Checksheet ✓</a>
                  )}
                </div>
                {w.findings && <div className="findings">{w.findings}</div>}
                <div className="sub">
                  {w.type} · opened {fmtDate(w.openedAt)}
                  {w.closedAt && <> · closed {fmtDate(w.closedAt)}</>}
                  {w.issuedTo && <> · issued to <b>{w.issuedTo}</b></>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card qr-card">
          <QR value={assetUrl(a.code)} size={180} />
          <span className="code">{a.code}</span>
          <div className="hint">Scan with any phone camera to open this asset record in the field.</div>
        </div>
      </div>
    </>
  )
}

/* ---------- monthly planner ---------- */

function Planner() {
  const now = new Date()
  const [ym, setYm] = useState([now.getFullYear(), now.getMonth()])
  const [year, month] = ym
  const occ = pmOccurrencesInMonth(year, month)
  const first = new Date(year, month, 1)
  const startPad = (first.getDay() + 6) % 7 // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = [...Array(startPad).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const monthName = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const isThisMonth = year === now.getFullYear() && month === now.getMonth()
  const shift = (n) => setYm(([y, m]) => { const d2 = new Date(y, m + n, 1); return [d2.getFullYear(), d2.getMonth()] })

  return (
    <>
      <div className="plan-bar">
        <h2 style={{ margin: 0 }}>Maintenance planner</h2>
        <div className="plan-nav">
          <button className="pbtn" onClick={() => shift(-1)} aria-label="Previous month">←</button>
          <span className="plan-month dt">{monthName}</span>
          <button className="pbtn" onClick={() => shift(1)} aria-label="Next month">→</button>
        </div>
      </div>
      <div className="card cal">
        <div className="cal-head">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d2) => <div key={d2}>{d2}</div>)}
        </div>
        <div className="cal-grid">
          {cells.map((dayNum, i) => {
            if (dayNum === null) return <div key={`p${i}`} className="cal-cell pad" />
            const items = occ[dayNum] ?? []
            const isToday = isThisMonth && dayNum === now.getDate()
            return (
              <div key={dayNum} className={`cal-cell${isToday ? ' today' : ''}`}>
                <span className="cal-day dt">{dayNum}</span>
                {items.map((p, j) => {
                  const overdue = p.due < now && !(p.due.toDateString() === now.toDateString())
                  return (
                    <a key={j} href={`#/asset/${p.asset}`} className={`cal-item${overdue ? ' late' : ''}`}
                       title={`${p.asset} — ${p.task} (${p.frequency})`}>
                      <b>{p.asset}</b> <span className="cal-task">{p.task}</span>
                    </a>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <p className="roadmap">Planned dates are projected from each task's frequency. Red = overdue. Click a task to open the asset.</p>
    </>
  )
}

/* ---------- daily log book ---------- */

function LogBook() {
  const [entries, setEntries] = useState(LOG_ENTRIES)
  const [text, setText] = useState('')
  const [shift, setShift] = useState('A')
  const add = (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setEntries([{ ts: new Date(), shift, author: 'Duty Engineer', text: text.trim() }, ...entries])
    setText('')
  }
  const byDay = entries.reduce((m, en) => {
    const k = en.ts.toDateString()
    ;(m[k] ??= []).push(en)
    return m
  }, {})
  return (
    <>
      <h2>Daily log book</h2>
      <form className="log-form card" onSubmit={add}>
        <select value={shift} onChange={(e) => setShift(e.target.value)} aria-label="Shift">
          {['A', 'B', 'C'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <input value={text} onChange={(e) => setText(e.target.value)}
               placeholder="New log entry — readings, events, handover notes…" />
        <button className="btn" type="submit">Add entry</button>
      </form>
      {Object.entries(byDay).map(([dayKey, list]) => (
        <div key={dayKey} className="log-day">
          <h3 className="log-date dt">{fmtDate(new Date(dayKey))}</h3>
          <div className="card">
            {list.map((en, i) => (
              <div className="log-entry" key={i}>
                <div className="log-meta">
                  <span className="dt">{fmtTime(en.ts)}</span>
                  <span className={`chip sh-${en.shift}`}><span className="dot" />Shift {en.shift}</span>
                  <span className="dim">{en.author}</span>
                </div>
                <div className="log-text">{en.text}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="roadmap">Demo note: new entries are not persisted.</p>
    </>
  )
}

/* ---------- failures & recovery ---------- */

function Failures() {
  const s = failureStats()
  const classes = Object.entries(s.byClass).sort((a, b) => b[1] - a[1])
  const max = classes[0]?.[1] ?? 1
  return (
    <>
      <div className="kpis">
        <div className="tile"><div className="v">{s.total}</div><div className="k">Failures — last 90 days</div></div>
        <div className={s.ongoing ? 'tile alert' : 'tile'}><div className="v">{s.ongoing}</div><div className="k">Ongoing breakdowns</div></div>
        <div className="tile"><div className="v">{s.downtime} h</div><div className="k">Total downtime</div></div>
        <div className="tile"><div className="v">{s.mttr} h</div><div className="k">Mean time to recover</div></div>
      </div>

      <h2>Failures by asset class</h2>
      <div className="card bars">
        {classes.map(([cls, n]) => (
          <div className="bar-row" key={cls}>
            <span className="bar-label">{cls}</span>
            <span className="bar-track"><span className="bar-fill" style={{ width: `${(n / max) * 100}%` }} /></span>
            <span className="bar-val dt">{n}</span>
          </div>
        ))}
      </div>

      <h2>Failure &amp; recovery log</h2>
      <div className="card tbl-wrap">
        <table>
          <thead><tr><th>ID</th><th>Asset</th><th>Occurred</th><th>Restored</th><th>Downtime</th><th>State</th><th>Cause → remedy</th></tr></thead>
          <tbody>
            {FAILURES.map((f) => (
              <tr key={f.id} tabIndex={0} onClick={() => { location.hash = `/asset/${f.asset}` }}
                  onKeyDown={(e) => e.key === 'Enter' && (location.hash = `/asset/${f.asset}`)}>
                <td className="code" data-l="ID">{f.id}</td>
                <td className="code" data-l="Asset">{f.asset}</td>
                <td className="dim dt" data-l="Occurred">{fmtDate(f.started)} {fmtTime(f.started)}</td>
                <td className="dim dt" data-l="Restored">{f.restored ? `${fmtDate(f.restored)} ${fmtTime(f.restored)}` : '—'}</td>
                <td className="dt" data-l="Downtime">{durationHrs(f)} h</td>
                <td data-l="State">{f.restored
                  ? <span className="chip w-done"><span className="dot" />Restored</span>
                  : <span className="chip d-overdue"><span className="dot" />Ongoing</span>}</td>
                <td className="wrap-cell" data-l="Cause">{f.cause} <span className="dim">→ {f.remedy}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ---------- spares & stock ---------- */

function Spares() {
  const s = spareStats()
  const prStage = (id) => PROCUREMENTS.find((p) => p.id === id)?.stage
  return (
    <>
      <div className="kpis">
        <div className="tile"><div className="v">{s.items}</div><div className="k">Spare line items</div></div>
        <div className={s.below ? 'tile alert' : 'tile'}><div className="v">{s.below}</div><div className="k">Below minimum stock</div></div>
        <div className={s.uncovered ? 'tile warn' : 'tile'}><div className="v">{s.uncovered}</div><div className="k">Below min, no PR raised</div></div>
      </div>

      <h2>Important spares</h2>
      <div className="card tbl-wrap">
        <table>
          <thead><tr><th>Code</th><th>Spare</th><th>For class</th><th>Store / bin</th><th>Stock</th><th>Min</th><th>Status</th><th>Linked PR</th></tr></thead>
          <tbody>
            {SPARES.map((sp) => {
              const low = sp.qty < sp.min
              return (
                <tr key={sp.code} style={{ cursor: 'default' }} className={low ? 'row-low' : ''}>
                  <td className="code" data-l="Code">{sp.code}</td>
                  <td data-l="Spare">{sp.name}</td>
                  <td className="dim" data-l="For class">{sp.cls}</td>
                  <td className="dim" data-l="Store / bin">{sp.bin}</td>
                  <td className="dt" data-l="Stock"><b>{sp.qty}</b> {sp.unit}</td>
                  <td className="dim dt" data-l="Min">{sp.min} {sp.unit}</td>
                  <td data-l="Status">{low
                    ? <span className="chip d-overdue"><span className="dot" />Below min</span>
                    : <span className="chip w-done"><span className="dot" />In stock</span>}</td>
                  <td data-l="Linked PR">{sp.pr
                    ? <a className="pr-link" href="#/procurement"><span className="code">{sp.pr}</span> <StageChip stage={prStage(sp.pr)} /></a>
                    : <span className="dim">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="roadmap">
        Minimum levels per OEM recommended-spares lists. Items below minimum with no PR are the
        action list — raise a proposal from the Procurement tab.
      </p>
    </>
  )
}

/* ---------- procurement ---------- */

function Procurement() {
  return (
    <>
      <h2>Procurement tracker</h2>
      <div className="card tbl-wrap">
        <table>
          <thead><tr><th>PR no.</th><th>Item</th><th>Qty</th><th>For asset</th><th>Stage</th><th>Est. cost</th><th>Requested</th><th></th></tr></thead>
          <tbody>
            {PROCUREMENTS.map((p) => (
              <tr key={p.id} style={{ cursor: 'default' }}>
                <td className="code" data-l="PR no.">{p.id}</td>
                <td className="wrap-cell" data-l="Item">{p.item}<div className="sub-note">{p.note}</div></td>
                <td className="dim" data-l="Qty">{p.qty}</td>
                <td className="code" data-l="For asset">{p.asset}</td>
                <td data-l="Stage"><StageChip stage={p.stage} /></td>
                <td className="dim dt" data-l="Est. cost">{p.cost}</td>
                <td className="dim dt" data-l="Requested">{fmtDate(p.requested)}</td>
                <td><a className="mini-btn" href={`#/procurement/${p.id}/letter`}>Draft letter</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="stage-legend">
        {PROC_STAGES.map((st) => <StageChip key={st} stage={st} />)}
      </div>
      <p className="roadmap">Tracking + proposal drafting only — approvals and purchase orders stay with the existing office process.</p>
    </>
  )
}

function ProposalLetter({ prId }) {
  const p = PROCUREMENTS.find((x) => x.id === prId)
  if (!p) return <p>Not found. <a className="crumb" href="#/procurement">← Procurement</a></p>
  const a = ASSETS.find((x) => x.code === p.asset)
  const f = p.failure ? FAILURES.find((x) => x.id === p.failure) : null
  return (
    <>
      <div className="sheet-bar">
        <a className="crumb" style={{ margin: 0 }} href="#/procurement">← Procurement</a>
        <button className="btn" onClick={() => window.print()}>Print letter</button>
        <p>Auto-drafted from the asset record — edit after export as needed.</p>
      </div>
      <div className="card letter">
        <p className="l-right dt">Ref: AMPS/{p.id}<br />Date: {fmtDate(new Date())}</p>
        <p>To,<br />The Senior Manager (Procurement)<br />Demo Plant</p>
        <p className="l-sub"><b>Subject: Proposal for procurement of {p.item} — {p.qty}</b></p>
        <p>Respected Sir,</p>
        <p>
          It is proposed to procure <b>{p.item}</b> ({p.qty}) for <b>{p.asset} — {a?.name}</b> installed
          at {a?.location}, Demo Plant.
        </p>
        {f && (
          <p>
            The requirement arises from breakdown <b>{f.id}</b> dated {fmtDate(f.started)} ({f.cause.toLowerCase()}),
            with downtime of {durationHrs(f)} hours{f.restored ? '' : ' and still continuing'}. Early procurement is
            requested to restore normal operation and to hold one unit as critical spare.
          </p>
        )}
        {!f && <p>{p.note} The item is required to maintain preventive-maintenance readiness for this equipment.</p>}
        {p.cost !== '—' && <p>Estimated cost: <b>{p.cost}</b>.</p>}
        <p>Submitted for your kind approval, please.</p>
        <p className="l-sign">Yours faithfully,<br /><br />Maintenance Department<br />Demo Plant</p>
      </div>
    </>
  )
}

/* ---------- maintenance checksheet ---------- */

function Checksheet({ kind, a1, a2 }) {
  const [draft, setDraft] = useState({})
  const setReading = (i, v) => setDraft((d) => ({ ...d, [i]: { ...d[i], v } }))
  const toggleOk = (i) => setDraft((d) => ({ ...d, [i]: { ...d[i], ok: !d[i]?.ok } }))
  // kind 'wo': a1 = WO id (filled) · kind 'pm': a1 = asset code, a2 = task (blank)
  let asset, task, filled = null, wo = null
  if (kind === 'wo') {
    filled = CHECKSHEET_RESULTS[a1]
    wo = JOB_CARDS.find((w) => w.id === a1)
    if (!filled || !wo) return <p>Checksheet not found. <a className="crumb" href="#/">← Register</a></p>
    task = filled.task
    asset = ASSETS.find((x) => x.code === wo.asset)
  } else {
    asset = ASSETS.find((x) => x.code === a1)
    task = decodeURIComponent(a2)
    if (!asset) return <p>Asset not found. <a className="crumb" href="#/">← Register</a></p>
  }
  const items = checksheetFor(task)
  const pm = PM_SCHEDULES.find((p) => p.asset === asset.code && p.task === task)
  const fmtNo = String(Object.keys(CHECKSHEET_TEMPLATES).indexOf(task) + 1 || 0).padStart(2, '0')

  return (
    <>
      <div className="sheet-bar">
        <a className="crumb" style={{ margin: 0 }} href={`#/asset/${asset.code}`}>← {asset.code}</a>
        <button className="btn" onClick={() => window.print()}>Print checksheet</button>
        <p>{filled ? 'Completed record — as verified on the job card.' : 'Blank sheet — print, fill in the field, and file against the job card.'}</p>
      </div>

      <div className="osheet">
        <div className="os-top">
          <div className="os-brand">
            <div className="os-org"><span className="bolt">⚡</span>AMPS</div>
            <div className="os-dept">Maintenance Department<br />Demo Plant</div>
          </div>
          <div className="os-title">
            <div className="os-t1">Preventive Maintenance Checksheet</div>
            <div className="os-t2">{task}</div>
          </div>
          <div className="os-qr">
            <QR value={assetUrl(asset.code)} size={72} />
            <div className="os-qr-cap">Scan for asset history</div>
          </div>
        </div>

        <div className="os-doc">
          <span>Format No.: AMPS/CS-{fmtNo} · Rev 00</span>
          <span>{filled ? <b className="os-locked">Record: COMPLETED · LOCKED 🔒</b> : 'Record: TO BE FILLED'}</span>
          <span>Page 1 of 1</span>
        </div>

        <table className="os-details">
          <tbody>
            <tr>
              <td><label>Asset code</label><b className="code">{asset.code}</b></td>
              <td><label>Asset</label>{asset.name}</td>
              <td><label>Location</label>{asset.location}</td>
              <td><label>Make / model</label>{asset.makeModel}</td>
            </tr>
            <tr>
              <td><label>Frequency</label>{pm ? pm.frequency : '—'}</td>
              <td><label>Job card ref.</label>{filled && wo ? wo.id : ''}</td>
              <td><label>Date of maintenance</label>{filled && wo ? fmtDate(wo.closedAt) : ''}</td>
              <td><label>Next due</label>{pm ? fmtDate(pm.nextDue) : '—'}</td>
            </tr>
          </tbody>
        </table>

        <table className="os-items">
          <thead>
            <tr><th style={{ width: 34 }}>Sl.</th><th>Check item</th><th style={{ width: 160 }}>Acceptance limit</th><th style={{ width: 150 }}>Reading / result</th><th style={{ width: 52 }}>OK</th></tr>
          </thead>
          <tbody>
            {items.map(([item, limit], i) => (
              <tr key={i}>
                <td className="dt os-c">{i + 1}</td>
                <td>{item}</td>
                <td>{limit}</td>
                <td className="dt os-c">{filled
                  ? <b>{filled.readings[i] ?? '—'}</b>
                  : <input className="os-input" value={draft[i]?.v ?? ''} onChange={(e) => setReading(i, e.target.value)} aria-label={`Reading for ${item}`} />}</td>
                <td className="os-c">{filled
                  ? <span className="cs-ok">✓</span>
                  : <button type="button" className={`cs-box${draft[i]?.ok ? ' ticked' : ''}`} onClick={() => toggleOk(i)} aria-label={`Mark ${item} OK`}>{draft[i]?.ok ? '✓' : ''}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="os-remarks">
          <label>Remarks</label>
          {filled && wo?.findings ? <p>{wo.findings}</p> : <><span className="os-rule" /><span className="os-rule" /></>}
        </div>

        <table className="os-signs">
          <tbody>
            <tr>
              <td>
                <span className="os-sign-space">{filled?.doneBy}</span>
                <label>Done by (Technician)</label>
                <span className="os-date">Date: {filled && wo ? fmtDate(wo.closedAt) : '__________'}</span>
              </td>
              <td>
                <span className="os-sign-space">{filled?.checkedBy}</span>
                <label>Checked by (Supervisor)</label>
                <span className="os-date">Date: {filled && wo ? fmtDate(wo.closedAt) : '__________'}</span>
              </td>
              <td>
                <span className="os-sign-space">{filled?.approvedBy}</span>
                <label>Approved by</label>
                <span className="os-date">Date: {filled && wo ? fmtDate(wo.closedAt) : '__________'}</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="os-foot">
          Generated by AMPS — Asset Maintenance &amp; Preventive Scheduling · Format AMPS/CS-{fmtNo} Rev 00
        </div>
      </div>

      {filled ? (
        <p className="roadmap">🔒 This record is locked — verified and approved. Corrections require a fresh job card; the original stays on file.</p>
      ) : (
        <div className="cs-actions">
          <button className="btn muted" type="button" disabled title="Sign-off requires login — coming with user accounts">
            Submit for verification
          </button>
          <span className="roadmap" style={{ margin: 0 }}>Fill digitally here, or print blank and fill at site. Sign-off requires login.</span>
        </div>
      )}
    </>
  )
}

/* ---------- QR tag sheet ---------- */

function TagSheet() {
  return (
    <>
      <div className="sheet-bar">
        <button className="btn" onClick={() => window.print()}>Print tag sheet</button>
        <p>One tag per asset — print, laminate, stick on the equipment. Scanning opens the asset's live record.</p>
      </div>
      <div className="tags">
        {ASSETS.map((a) => (
          <div className="tag" key={a.code}>
            <QR value={assetUrl(a.code)} size={140} />
            <div className="scan-cap">Scan for history</div>
            <div className="nm">{a.name}</div>
            <span className="code">{a.code}</span>
            <div className="org">AMPS · DEMO PLANT</div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ---------- shell + hash router ---------- */

const routeFromHash = () => location.hash.replace(/^#/, '') || '/'

const NAV = [
  ['/', 'Register'],
  ['/planner', 'Planner'],
  ['/log', 'Log book'],
  ['/failures', 'Failures'],
  ['/spares', 'Spares'],
  ['/procurement', 'Procurement'],
  ['/tags', 'QR tags'],
]

export default function App() {
  const [route, setRoute] = useState(routeFromHash)
  useEffect(() => {
    const onHash = () => { setRoute(routeFromHash()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = (r) => { location.hash = r }

  const assetMatch = route.match(/^\/asset\/(.+)$/)
  const letterMatch = route.match(/^\/procurement\/([^/]+)\/letter$/)
  const csMatch = route.match(/^\/checksheet\/(wo|pm)\/([^/]+)(?:\/(.+))?$/)

  return (
    <div className="shell">
      <header className="topbar">
        <a href="#/" className="brand"><span className="bolt">⚡</span>AMPS
          <span className="brand-sub">Asset Maintenance &amp; Preventive Scheduling</span>
        </a>
        <nav className="nav">
          {NAV.map(([path, label]) => (
            <a key={path} href={`#${path}`} className={route === path ? 'active' : ''}>{label}</a>
          ))}
        </nav>
      </header>

      {assetMatch ? <AssetDetail code={assetMatch[1]} />
        : letterMatch ? <ProposalLetter prId={letterMatch[1]} />
        : csMatch ? <Checksheet kind={csMatch[1]} a1={csMatch[2]} a2={csMatch[3]} />
        : route === '/planner' ? <Planner />
        : route === '/log' ? <LogBook />
        : route === '/failures' ? <Failures />
        : route === '/spares' ? <Spares />
        : route === '/procurement' ? <Procurement />
        : route === '/tags' ? <TagSheet />
        : <Dashboard go={go} />}

      <footer className="foot">
        Demonstration environment · synthetic data only · MIT © 2026 Arup Biswas
      </footer>
    </div>
  )
}
