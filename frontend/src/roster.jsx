// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arup Biswas and AMPS contributors (binidev)
// AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

/* Duty roster — the first page driven by the LIVE v0.2 API instead of
   synthetic data.js. Talks to /api/roster/* (coverage analysis) and
   /api/maintenance/due via the shift work-package bundler.

   API base: same-origin by default (the deploy/k8s ingress serves frontend
   and backend on one host). Demo hosting builds with VITE_AMPS_API set. */
import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_AMPS_API ?? ''

const SHIFT_CODES = ['M', 'E', 'N', 'G', 'R']
const SHIFT_LABEL = { M: 'Morning', E: 'Evening', N: 'Night', G: 'General', R: 'Rest' }
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const DEMO_PATTERN = {
  'S. Kumar':   ['M', 'M', 'E', 'E', 'N', 'G', 'R'],
  'A. Sheikh':  ['E', 'N', 'M', 'N', 'M', 'R', 'G'],
  'P. Mondal':  ['N', 'E', 'N', 'M', 'E', 'M', 'R'],
  'R. Debnath': ['G', 'R', 'G', 'G', 'R', 'E', 'N'],
}

const today = () => new Date().toISOString().slice(0, 10)

function LiveBadge({ ok }) {
  return (
    <span className={`chip ${ok ? 'live-ok' : 'live-off'}`}>
      <span className="dot" />{ok ? 'Live API' : 'API offline'}
    </span>
  )
}

function ApiOffline() {
  return (
    <div className="card">
      <p className="dim">
        The duty-roster module is computed by the AMPS backend (v0.2) and the API
        is not reachable right now. The rest of the demo keeps working — this
        page will come back with the API.
      </p>
    </div>
  )
}

export default function DutyRoster() {
  const [rows, setRows] = useState(DEMO_PATTERN)
  const [coverage, setCoverage] = useState(null)
  const [pkgDate, setPkgDate] = useState(today())
  const [pkgShift, setPkgShift] = useState('M')
  const [pkg, setPkg] = useState(null)
  const [apiOk, setApiOk] = useState(null)
  const [busy, setBusy] = useState(false)

  const analyse = async (r = rows) => {
    setBusy(true)
    try {
      const res = await fetch(`${API}/api/roster/coverage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Demo weekly pattern', rows: r }),
      })
      if (!res.ok) throw new Error(res.status)
      setCoverage(await res.json())
      setApiOk(true)
    } catch {
      setApiOk(false)
    } finally {
      setBusy(false)
    }
  }

  const loadPackage = async (d = pkgDate, s = pkgShift) => {
    try {
      const res = await fetch(`${API}/api/roster/work-package?for_date=${d}&shift=${s}`)
      if (!res.ok) throw new Error(res.status)
      setPkg(await res.json())
      setApiOk(true)
    } catch {
      setApiOk(false)
    }
  }

  useEffect(() => { analyse(); loadPackage() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const setCell = (person, day, code) => {
    const next = { ...rows, [person]: rows[person].map((c, i) => (i === day ? code : c)) }
    setRows(next)
  }

  if (apiOk === false) {
    return (
      <>
        <div className="page-head">
          <h1>Duty roster</h1>
          <LiveBadge ok={false} />
        </div>
        <ApiOffline />
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <h1>Duty roster</h1>
        <LiveBadge ok={apiOk === true} />
      </div>
      <p className="dim page-sub">
        Weekly shift pattern → live coverage analysis and per-shift work packages,
        computed by the AMPS backend (v0.2) — first module running on the real API.
      </p>

      <h2>Weekly pattern</h2>
      <div className="card tbl-wrap">
        <table className="roster-grid">
          <thead>
            <tr><th>Crew</th>{DAYS.map((d) => <th key={d}>{d}</th>)}</tr>
          </thead>
          <tbody>
            {Object.entries(rows).map(([person, codes]) => (
              <tr key={person}>
                <td className="code" data-l="Crew">{person}</td>
                {codes.map((c, i) => (
                  <td key={i} data-l={DAYS[i]}>
                    <select className={`shift-sel sh-${c}`} value={c}
                            aria-label={`${person} ${DAYS[i]}`}
                            onChange={(e) => setCell(person, i, e.target.value)}>
                      {SHIFT_CODES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="roster-legend dim">
          {SHIFT_CODES.map((s) => <span key={s}><b>{s}</b> {SHIFT_LABEL[s]}</span>)}
        </div>
        <button className="btn" disabled={busy} onClick={() => analyse()}>
          {busy ? 'Analysing…' : 'Analyse coverage'}
        </button>
      </div>

      {coverage && (
        <>
          <h2>Coverage — {coverage.pattern}</h2>
          <div className="card tbl-wrap">
            <table>
              <thead>
                <tr><th>Day</th><th>M</th><th>E</th><th>N</th><th>G</th><th>Uncovered</th><th>Maint-window staff</th></tr>
              </thead>
              <tbody>
                {coverage.days.map((d) => (
                  <tr key={d.day}>
                    <td className="code" data-l="Day">{d.day}</td>
                    {['M', 'E', 'N', 'G'].map((s) => (
                      <td key={s} data-l={SHIFT_LABEL[s]} className={d.counts[s] === 0 ? 'cov-zero' : ''}>{d.counts[s]}</td>
                    ))}
                    <td data-l="Uncovered">
                      {d.uncovered.length
                        ? d.uncovered.map((s) => <span key={s} className="chip d-overdue"><span className="dot" />{SHIFT_LABEL[s]}</span>)
                        : <span className="dim">—</span>}
                    </td>
                    <td data-l="Maint-window staff">{d.maintenance_window_staff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {coverage.verdict && <p className={coverage.uncovered_slots_per_week ? 'cov-verdict warn' : 'cov-verdict ok'}>{coverage.verdict}</p>}
          </div>
        </>
      )}

      <h2>Shift work package</h2>
      <div className="card">
        <div className="pkg-controls">
          <label>Date <input type="date" value={pkgDate} onChange={(e) => setPkgDate(e.target.value)} /></label>
          <label>Shift <select value={pkgShift} onChange={(e) => setPkgShift(e.target.value)}>
            {['M', 'E', 'N', 'G'].map((s) => <option key={s} value={s}>{s} — {SHIFT_LABEL[s]}</option>)}
          </select></label>
          <button className="btn" onClick={() => loadPackage()}>Build package</button>
        </div>
        {pkg && (
          <>
            <div className="sect">
              <h3>Rostered crew</h3>
              {pkg.crew?.length
                ? <p>{pkg.crew.join(' · ')}</p>
                : <p className="dim">No crew rostered for this slot in the seeded pattern.</p>}
            </div>
            <div className="sect tbl-wrap">
              <h3>PM items due</h3>
              {pkg.items?.length ? (
                <table>
                  <thead>
                    <tr><th>Asset</th><th>Task</th><th>Criticality</th><th>Next due</th><th>Overdue</th><th>Priority</th></tr>
                  </thead>
                  <tbody>
                    {pkg.items.map((it) => (
                      <tr key={it.schedule_id}>
                        <td className="code" data-l="Asset">{it.asset_code}</td>
                        <td data-l="Task">{it.task}</td>
                        <td data-l="Criticality"><span className={`chip cr-${it.criticality}`}><span className="dot" />{it.criticality}</span></td>
                        <td className="dim dt" data-l="Next due">{it.next_due}</td>
                        <td data-l="Overdue">{it.overdue_days > 0 ? <span className="chip d-overdue"><span className="dot" />{it.overdue_days} d</span> : <span className="dim">—</span>}</td>
                        <td data-l="Priority"><b>{it.priority}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="dim">Nothing due in this window — clean board.</p>}
            </div>
          </>
        )}
      </div>
    </>
  )
}
