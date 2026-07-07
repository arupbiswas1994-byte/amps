/* Duty roster v2 — one story, live analysis, presets (upstream issue #4).

   The page tells one narrative top-to-bottom: pick a doctrine preset (landing
   on a realistically broken one), watch the live coverage analysis as you fix
   it cell by cell, then build the shift work package — with its crew source
   declared (server's ACTIVE pattern vs the sandbox grid above).

   API base: same-origin by default (the deploy/k8s ingress serves frontend
   and backend on one host). Demo hosting builds with VITE_AMPS_API set. */
import { useEffect, useRef, useState } from 'react'

const API = import.meta.env.VITE_AMPS_API ?? ''

const SHIFT_CODES = ['M', 'E', 'N', 'G', 'R']
const DUTY_SHIFTS = ['M', 'E', 'N', 'G']
const SHIFT_LABEL = { M: 'Morning', E: 'Evening', N: 'Night', G: 'General', R: 'Rest' }
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MAX_CREW = 12

/* Pattern presets — the module's doctrine as one-click stories.
   Names are deliberately unambiguous fiction (synthetic-data rule). */
const PRESETS = {
  'day-heavy': {
    label: 'Day-heavy (typical)',
    blurb: 'Everyone works days — evenings and nights are left uncovered. Fix it.',
    rows: {
      'Crew A': ['M', 'M', 'M', 'M', 'M', 'R', 'M'],
      'Crew B': ['M', 'M', 'E', 'M', 'M', 'G', 'R'],
      'Crew C': ['G', 'G', 'G', 'G', 'M', 'R', 'G'],
      'Crew D': ['M', 'G', 'M', 'M', 'E', 'M', 'M'],
      'Crew E': ['E', 'E', 'R', 'E', 'R', 'M', 'E'],
    },
  },
  balanced: {
    label: 'Balanced baseline',
    blurb: 'Every duty shift covered, every day of the week.',
    rows: {
      'Crew A': ['M', 'M', 'M', 'M', 'M', 'M', 'R'],
      'Crew B': ['E', 'E', 'E', 'E', 'E', 'E', 'R'],
      'Crew C': ['N', 'N', 'N', 'N', 'N', 'N', 'R'],
      'Crew D': ['G', 'G', 'G', 'G', 'G', 'G', 'R'],
      'Crew E': ['R', 'M', 'E', 'N', 'G', 'R', 'M'],
      'Crew F': ['N', 'E', 'R', 'E', 'M', 'G', 'E'],
      'Crew G': ['E', 'R', 'N', 'M', 'N', 'R', 'N'],
      'Crew H': ['G', 'N', 'E', 'R', 'M', 'E', 'G'],
    },
  },
  'maint-window': {
    label: 'Maintenance-window enforced',
    blurb: 'Balanced — plus doubled evening/night crews on Tue & Thu block days.',
    rows: {
      'Crew A': ['M', 'M', 'M', 'M', 'M', 'M', 'R'],
      'Crew B': ['E', 'E', 'E', 'E', 'E', 'E', 'R'],
      'Crew C': ['N', 'N', 'N', 'N', 'N', 'N', 'R'],
      'Crew D': ['G', 'G', 'G', 'G', 'G', 'G', 'R'],
      'Crew E': ['R', 'N', 'M', 'N', 'E', 'R', 'M'],
      'Crew F': ['N', 'E', 'R', 'E', 'M', 'G', 'E'],
      'Crew G': ['E', 'R', 'N', 'M', 'N', 'R', 'N'],
      'Crew H': ['G', 'N', 'E', 'G', 'M', 'E', 'G'],
    },
  },
}

const today = () => new Date().toISOString().slice(0, 10)
/* Monday-first weekday index for a yyyy-mm-dd date (grid arrays are Mon-first). */
const mondayIndex = (iso) => (new Date(iso + 'T00:00:00').getDay() + 6) % 7

function LiveBadge({ ok }) {
  return (
    <span className={`chip ${ok ? 'live-ok' : 'live-off'}`}>
      <span className="dot" />{ok ? 'Live API' : 'API offline'}
    </span>
  )
}

export default function DutyRoster() {
  const [preset, setPreset] = useState('day-heavy')
  const [rows, setRows] = useState(PRESETS['day-heavy'].rows)
  const [windowShifts, setWindowShifts] = useState(['N'])
  const [coverage, setCoverage] = useState(null)
  const [pkgDate, setPkgDate] = useState(today())
  const [pkgShift, setPkgShift] = useState('N')
  const [pkgSource, setPkgSource] = useState('server')   // 'server' | 'sandbox'
  const [pkg, setPkg] = useState(null)
  const [apiOk, setApiOk] = useState(null)
  const [newName, setNewName] = useState('')
  const debounceRef = useRef(null)

  /* Live analysis — no button. The engine is pure computation, so feedback
     must feel instant: debounce ~300ms and re-analyse on every change. */
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/roster/coverage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: PRESETS[preset]?.label ?? 'Custom pattern',
            maintenance_window_shifts: windowShifts,
            rows,
          }),
        })
        if (!res.ok) throw new Error(res.status)
        setCoverage(await res.json())
        setApiOk(true)
      } catch {
        setApiOk(false)
      }
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [rows, windowShifts, preset])

  useEffect(() => {
    if (pkgSource !== 'server') return
    ;(async () => {
      try {
        const res = await fetch(`${API}/api/roster/work-package?for_date=${pkgDate}&shift=${pkgShift}`)
        if (!res.ok) throw new Error(res.status)
        setPkg(await res.json())
        setApiOk(true)
      } catch {
        setApiOk(false)
      }
    })()
  }, [pkgDate, pkgShift, pkgSource])

  const applyPreset = (key) => {
    setPreset(key)
    setRows(PRESETS[key].rows)
  }

  const setCell = (person, day, code) => {
    setPreset('custom')
    setRows((r) => ({ ...r, [person]: r[person].map((c, i) => (i === day ? code : c)) }))
  }

  const addCrew = () => {
    const name = newName.trim()
    if (!name || rows[name] || Object.keys(rows).length >= MAX_CREW) return
    setPreset('custom')
    setRows((r) => ({ ...r, [name]: ['R', 'R', 'R', 'R', 'R', 'R', 'R'] }))
    setNewName('')
  }

  const removeCrew = (person) => {
    setPreset('custom')
    setRows((r) => {
      const { [person]: _, ...rest } = r
      return rest
    })
  }

  const toggleWindow = (code) => {
    setWindowShifts((w) => {
      const next = w.includes(code) ? w.filter((c) => c !== code) : [...w, code]
      if (!next.length) return w              // at least one window shift
      setPkgShift(next[0])                    // package default follows the window
      return next
    })
  }

  /* Sandbox crew: client-side join of the grid for the chosen day/shift. */
  const sandboxCrew = Object.entries(rows)
    .filter(([, codes]) => codes[mondayIndex(pkgDate)] === pkgShift)
    .map(([person]) => person)

  const printPkg = () => {
    document.body.classList.add('print-pkg')
    const done = () => { document.body.classList.remove('print-pkg'); window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    window.print()
  }

  const hero = coverage?.uncovered_slots_per_week
  const dayBad = (i) => coverage?.days?.[i]?.uncovered?.length > 0

  return (
    <>
      <div className="page-head pkg-hide">
        <h1>Duty roster</h1>
        <LiveBadge ok={apiOk === true} />
      </div>
      <p className="dim page-sub pkg-hide">
        Pick a pattern doctrine, watch coverage react as you edit, then build the
        printable shift work package — computed live by the AMPS backend.
      </p>

      {apiOk === false && (
        <div className="card offline-note pkg-hide">
          <p className="dim">
            The AMPS API is not reachable — the sandbox grid and presets below stay
            fully editable; the analysis and work-package sections will come back
            with the API.
          </p>
        </div>
      )}

      <div className="preset-bar pkg-hide" role="group" aria-label="Pattern presets">
        {Object.entries(PRESETS).map(([key, p]) => (
          <button key={key} className={`btn preset ${preset === key ? 'active' : ''}`}
                  title={p.blurb} onClick={() => applyPreset(key)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className={`hero-cov pkg-hide ${apiOk === false ? 'is-dim' : hero === 0 ? 'ok' : 'bad'}`}>
        <span className="hero-num">{apiOk === false ? '—' : hero ?? '…'}</span>
        <span className="hero-cap">uncovered shift-slots / week <b>(target 0)</b></span>
      </div>

      <h2 className="pkg-hide">Weekly pattern <span className="dim h-sub">sandbox — edits analyse live</span></h2>
      <div className="card tbl-wrap pkg-hide">
        <table className="roster-grid">
          <thead>
            <tr>
              <th>Crew</th>
              {DAYS.map((d, i) => (
                <th key={d} className={dayBad(i) ? 'day-bad' : ''}>{d}</th>
              ))}
              <th aria-label="remove" />
            </tr>
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
                <td className="crew-rm">
                  <button className="rm-btn" aria-label={`Remove ${person}`}
                          onClick={() => removeCrew(person)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="crew-add">
          <input value={newName} placeholder="New crew name…" maxLength={24}
                 onChange={(e) => setNewName(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && addCrew()} />
          <button className="btn" disabled={!newName.trim() || Object.keys(rows).length >= MAX_CREW}
                  onClick={addCrew}>Add crew</button>
          {Object.keys(rows).length >= MAX_CREW && <span className="dim">crew cap {MAX_CREW}</span>}
        </div>
        <div className="roster-legend dim">
          {SHIFT_CODES.map((s) => <span key={s}><b>{s}</b> {SHIFT_LABEL[s]}</span>)}
        </div>
        <div className="win-toggle">
          <span className="dim">Maintenance-window shifts:</span>
          {DUTY_SHIFTS.map((s) => (
            <button key={s} className={`chip win ${windowShifts.includes(s) ? 'on' : ''}`}
                    aria-pressed={windowShifts.includes(s)} onClick={() => toggleWindow(s)}>
              {s}
            </button>
          ))}
          <span className="dim">— counted in the “Maint-window staff” column and the package default.</span>
        </div>
      </div>

      {coverage && apiOk !== false && (
        <>
          <h2 className="pkg-hide">Coverage — {coverage.pattern}</h2>
          <div className="card tbl-wrap pkg-hide">
            <table>
              <thead>
                <tr><th>Day</th><th>M</th><th>E</th><th>N</th><th>G</th><th>Uncovered</th><th>Maint-window staff</th></tr>
              </thead>
              <tbody>
                {coverage.days.map((d) => (
                  <tr key={d.day}>
                    <td className="code" data-l="Day">{d.day}</td>
                    {DUTY_SHIFTS.map((s) => (
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

      <h2 className="pkg-print-title">Shift work package</h2>
      <div className={`card work-pkg ${apiOk === false ? 'is-dim' : ''}`}>
        <div className="pkg-controls pkg-hide">
          <label>Date <input type="date" value={pkgDate} onChange={(e) => setPkgDate(e.target.value)} /></label>
          <label>Shift <select value={pkgShift} onChange={(e) => setPkgShift(e.target.value)}>
            {DUTY_SHIFTS.map((s) => <option key={s} value={s}>{s} — {SHIFT_LABEL[s]}</option>)}
          </select></label>
          <label className="src-toggle">Crew source
            <select value={pkgSource} onChange={(e) => setPkgSource(e.target.value)}>
              <option value="server">Server’s ACTIVE pattern (seeded demo)</option>
              <option value="sandbox">Sandbox grid above</option>
            </select>
          </label>
          <button className="btn" onClick={printPkg} disabled={apiOk === false}>Print package</button>
        </div>
        <p className="dim src-note">
          {pkgSource === 'server'
            ? 'Crew comes from the server’s ACTIVE pattern (seeded demo), not the sandbox grid above.'
            : `Crew joined client-side from the sandbox grid — ${DAYS[mondayIndex(pkgDate)]} · ${SHIFT_LABEL[pkgShift]} shift.`}
        </p>
        <div className="sect">
          <h3>Rostered crew — {pkgDate} · {SHIFT_LABEL[pkgShift]}</h3>
          {pkgSource === 'sandbox'
            ? (sandboxCrew.length
                ? <p>{sandboxCrew.join(' · ')}</p>
                : <p className="dim">No crew on this slot in the sandbox grid.</p>)
            : (pkg?.crew?.length
                ? <p>{pkg.crew.join(' · ')}</p>
                : <p className="dim">No crew rostered for this slot in the seeded pattern.</p>)}
        </div>
        <div className="sect tbl-wrap">
          <h3>PM items due</h3>
          {apiOk === false ? <p className="dim">Needs the API.</p> : pkg?.items?.length ? (
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
      </div>
    </>
  )
}
