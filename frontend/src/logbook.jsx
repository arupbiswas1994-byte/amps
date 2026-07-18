/* Digital shift logbook — the v0.3 module, live on /api/logbook.

   Replaces the earlier local-state demo page: entries now persist through the
   backend's append-only log (a mistake is corrected by a NEW entry pointing at
   the old one — the bound-paper-logbook discipline, enforced by software).

   API base: same-origin by default; demo hosting builds with VITE_AMPS_API. */
import { useEffect, useState } from 'react'
import { useMe } from './api.js'

const API = import.meta.env.VITE_AMPS_API ?? ''

const SHIFT_LABEL = { M: 'Morning', E: 'Evening', N: 'Night', G: 'General', R: 'Rest' }
const ENTRY_SHIFTS = ['M', 'E', 'N', 'G']  // R = roster-only, never a log shift
const ENTRY_TYPES = ['maintenance', 'failure', 'rectification', 'general']
const MAINT_SUBTYPES = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly', 'Special']
/* local-calendar ISO — toISOString() is UTC and shifts IST dates a day back */
const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => isoLocal(new Date())
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return isoLocal(d)
}

const fmtDate = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/* bulk history import: the unified sheet-logbook CSV (Green Line standard) —
   maintenance rows become log entries, failure rows become failure records */
function HistoryImportBar() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const onFile = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setResult(null)
    try {
      const r = await fetch(`${API}/api/logbook/import`, {
        method: 'POST', headers: { 'Content-Type': 'text/csv' },
        body: await file.text(),
      })
      const body = await r.json().catch(() => null)
      setResult(r.ok ? body : { error: body?.detail || `HTTP ${r.status}` })
    } catch (err) {
      setResult({ error: String(err) })
    }
    setBusy(false)
  }
  return (
    <div className="import-bar">
      <a className="btn ghost" href={`${API}/api/logbook/import/sample`} download>⬇ Sample CSV</a>
      <label className={`btn ghost${busy ? ' disabled' : ''}`}>
        {busy ? 'Importing…' : '⬆ Import history CSV'}
        <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} hidden />
      </label>
      {result && (result.error
        ? <span className="import-msg err">{result.error}</span>
        : <span className="import-msg">
            {result.log_entries} log entries · {result.failures} failures · {result.skipped} skipped · {result.failed} failed
            {result.errors?.length ? ` — ${result.errors[0]}` : ''}
          </span>)}
    </div>
  )
}

function LiveBadge({ ok }) {
  return (
    <span className={`chip ${ok ? 'live-ok' : 'live-off'}`}>
      <span className="dot" />{ok ? 'Live API' : 'API offline'}
    </span>
  )
}

/* the date ruler — one strip picks the day for BOTH writing and reading.
   Back-dating an entry = tap its day (or the picker for anything older). */
function DateRuler({ value, onChange, days = 10 }) {
  const t = today()
  const strip = Array.from({ length: days }, (_, i) => addDays(t, i - (days - 1)))
  const fmt = (iso) => {
    const d = new Date(iso + 'T00:00:00')
    return { dow: d.toLocaleDateString(undefined, { weekday: 'short' }), day: d.getDate() }
  }
  const inStrip = strip.includes(value)
  return (
    <div className="date-ruler" role="tablist" aria-label="Log date">
      <input type="date" className={`ruler-pick${!inStrip && value ? ' active' : ''}`}
             value={value} max={t} onChange={(e) => e.target.value && onChange(e.target.value)}
             aria-label="Older date" />
      {strip.map((iso) => {
        const { dow, day } = fmt(iso)
        return (
          <button key={iso} type="button"
                  className={`ruler-day${iso === value ? ' active' : ''}${iso === t ? ' today' : ''}`}
                  onClick={() => onChange(iso)}>
            <span className="rd-dow">{iso === t ? 'Today' : dow}</span>
            <span className="rd-num">{day}</span>
          </button>
        )
      })}
    </div>
  )
}

export default function LogBook() {
  const { me, canWrite } = useMe()
  const authOn = me?.auth_enabled
  const [entries, setEntries] = useState([])
  const [logDate, setLogDate] = useState(today())  // the ruler: write + read date
  const [allDates, setAllDates] = useState(false)  // ruler off → full history
  const [fShift, setFShift] = useState('')         // '' = all shifts
  const [fCat, setFCat] = useState('')             // '' = all categories (classes)
  const [fType, setFType] = useState('')           // '' = all types
  const [apiOk, setApiOk] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // add-entry form
  const [text, setText] = useState('')
  const [shift, setShift] = useState('M')
  const [type, setType] = useState('general')
  const [subtype, setSubtype] = useState('Monthly')
  const [category, setCategory] = useState('')     // asset class
  const [tim, setTim] = useState('')               // optional HH:MM
  const [endDate, setEndDate] = useState('')       // failures: recovery date
  const [endTim, setEndTim] = useState('')         // failures: recovery HH:MM
  const [faultType, setFaultType] = useState('')   // failures: fault class
  const [assetCode, setAssetCode] = useState('')   // cross-reference to the register
  const [author, setAuthor] = useState('demo.visitor')
  const [assets, setAssets] = useState([])         // register rows for the datalist

  useEffect(() => {
    fetch(`${API}/api/assets`).then((r) => (r.ok ? r.json() : []))
      .then(setAssets).catch(() => {})
  }, [])
  // distinct asset classes, sorted — the category dropdown's options
  const classes = [...new Set(assets.map((a) => a.asset_class).filter(Boolean))].sort()

  const load = async () => {
    try {
      const q = new URLSearchParams()
      if (!allDates) q.set('log_date', logDate)
      if (fShift) q.set('shift', fShift)
      if (fCat) q.set('category', fCat)
      if (fType) q.set('entry_type', fType)
      if (allDates) q.set('limit', '500')
      const res = await fetch(`${API}/api/logbook?${q}`)
      if (!res.ok) throw new Error(res.status)
      setEntries(await res.json())
      setApiOk(true)
    } catch {
      setApiOk(false)
    }
  }

  useEffect(() => { load() }, [logDate, allDates, fShift, fCat, fType])  // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (e) => {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${API}/api/logbook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_date: logDate, shift, type,
          subtype: type === 'maintenance' ? subtype : null,
          category: category || null,
          time: tim || null,
          end_date: type === 'failure' ? (endDate || null) : null,
          end_time: type === 'failure' ? (endTim || null) : null,
          fault_type: type === 'failure' ? (faultType.trim() || null) : null,
          asset_code: assetCode.trim() || null,
          text: text.trim(), entered_by: author.trim() || 'demo.visitor',
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `HTTP ${res.status}`)
      }
      setText(''); setAssetCode(''); setTim('')
      setEndDate(''); setEndTim(''); setFaultType('')
      setAllDates(false)  // show the day just written to
      await load()
    } catch (ex) {
      setErr(String(ex.message || ex).replace(/^Error: /, ''))
    } finally {
      setBusy(false)
    }
  }

  const byDay = entries.reduce((m, en) => {
    ;(m[en.log_date] ??= []).push(en)
    return m
  }, {})

  return (
    <>
      <div className="page-head">
        <h1>Shift logbook</h1>
        <LiveBadge ok={apiOk === true} />
      </div>
      <p className="dim page-sub">
        The section's running log, digital: append-only entries per date and shift,
        persisted by the AMPS backend (v0.3). Corrections are new entries — nothing
        is ever edited or deleted, exactly like a bound paper logbook.
      </p>

      {apiOk === false && (
        <div className="card offline-note">
          <p className="dim">The AMPS API is not reachable — the logbook will come back with it.</p>
        </div>
      )}

      <DateRuler value={allDates ? '' : logDate}
                 onChange={(d) => { setLogDate(d); setAllDates(false) }} />

      {canWrite ? (
        <form className="log-form card" onSubmit={add}>
          {/* maintenance is always a night-shift job — lock the shift to N */}
          <select value={type === 'maintenance' ? 'N' : shift} disabled={type === 'maintenance'}
                  onChange={(e) => setShift(e.target.value)} aria-label="Shift"
                  title={type === 'maintenance' ? 'Maintenance runs on the night shift' : 'Shift'}>
            {ENTRY_SHIFTS.map((s) => <option key={s} value={s}>{s} — {SHIFT_LABEL[s]}</option>)}
          </select>
          <input value={category} list="asset-classes" placeholder="Asset class…"
                 className="log-cat" aria-label="Asset class / category"
                 onChange={(e) => setCategory(e.target.value)} />
          <datalist id="asset-classes">
            {classes.map((c) => <option key={c} value={c} />)}
          </datalist>
          <select value={type}
                  onChange={(e) => { setType(e.target.value); if (e.target.value === 'maintenance') setShift('N') }}
                  aria-label="Entry type">
            {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
          </select>
          {type === 'maintenance' && (
            <select value={subtype} onChange={(e) => setSubtype(e.target.value)} aria-label="Maintenance frequency">
              {MAINT_SUBTYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {/* A failure needs its fault class and the moment supply came back —
              downtime is derived from the two timestamps, never typed. Leave
              the recovery blank while the breakdown is still open. */}
          {type === 'failure' && (
            <>
              <input value={faultType} onChange={(e) => setFaultType(e.target.value)}
                     placeholder="Fault type…" className="log-cat" aria-label="Fault type"
                     maxLength={120} />
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                     aria-label="Restored on (optional)" title="Restored on — leave blank if still open" />
              <input type="time" value={endTim} onChange={(e) => setEndTim(e.target.value)}
                     aria-label="Restored at (optional)" title="Restored at" className="log-time" />
            </>
          )}
          <input type="time" value={tim} onChange={(e) => setTim(e.target.value)}
                 aria-label="Time (optional)" title="Time (optional)" className="log-time" />
          <input value={assetCode} list="register-codes" placeholder="Asset ID…"
                 className="log-asset" aria-label="Asset code (optional)"
                 onChange={(e) => {
                   const v = e.target.value
                   setAssetCode(v)
                   const hit = assets.find((a) => a.code === v)  // auto-set class from the asset
                   if (hit?.asset_class) setCategory(hit.asset_class)
                 }} />
          <datalist id="register-codes">
            {assets.map((a) => <option key={a.code} value={a.code}>{a.name} · {a.location}</option>)}
          </datalist>
          {!authOn && ( /* signed-in deployments stamp the author from the session */
            <input value={author} onChange={(e) => setAuthor(e.target.value)}
                   aria-label="Entered by" placeholder="Entered by…" className="log-author" maxLength={40} />
          )}
          <input value={text} onChange={(e) => setText(e.target.value)}
                 placeholder={`Log entry for ${fmtDate(logDate)} — work done, readings, events…`} />
          <button className="btn" type="submit" disabled={busy || apiOk === false || !text.trim()}>
            {busy ? 'Adding…' : 'Add entry'}
          </button>
          {err && <span className="import-msg err">{err}</span>}
        </form>
      ) : (
        <p className="dim">Viewing only — sign in with your line account to add entries.</p>
      )}

      {canWrite && <HistoryImportBar />}

      <div className="log-filters">
        <button type="button" className={`btn preset${allDates ? ' active' : ''}`}
                onClick={() => setAllDates(true)}>All dates</button>
        <label className="dim">Class <select value={fCat} onChange={(e) => setFCat(e.target.value)}>
          <option value="">All</option>
          {classes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select></label>
        <label className="dim">Type <select value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="">All</option>
          {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
        </select></label>
        <label className="dim">Shift <select value={fShift} onChange={(e) => setFShift(e.target.value)}>
          <option value="">All</option>
          {ENTRY_SHIFTS.map((s) => <option key={s} value={s}>{s} — {SHIFT_LABEL[s]}</option>)}
        </select></label>
      </div>

      {Object.entries(byDay).map(([day, list]) => (
        <div key={day} className="log-day">
          <h3 className="log-date dt">{fmtDate(day)}</h3>
          <div className="card">
            {list.map((en) => (
              <div className="log-entry" key={en.id}>
                <div className="log-meta">
                  {!en.at.includes('T00:00:00') && <span className="dt">{fmtTime(en.at)}</span>}
                  {en.category && <span className="chip grp"><span className="dot" />{en.category}</span>}
                  <span className="chip"><span className="dot" />{en.shift} · {SHIFT_LABEL[en.shift]}</span>
                  <span className={`chip ${['defect', 'failure'].includes(en.type) ? 'd-overdue' : ''}`}>
                    <span className="dot" />{en.type}{en.subtype ? ` · ${en.subtype}` : ''}
                  </span>
                  <span className="dim">{en.entered_by}</span>
                  {en.asset_code && <a className="code" href={`#/asset/${en.asset_code}`}>{en.asset_code}</a>}
                  {en.corrects_id && <span className="dim">corrects #{en.corrects_id}</span>}
                </div>
                <div className="log-text">{en.text}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {apiOk && !entries.length && <p className="dim">No entries for this filter.</p>}

      <p className="roadmap">
        Entries persist in the demo database (reseeded on each demo restart).
        Synthetic data only — do not log real operational information here.
      </p>
    </>
  )
}
