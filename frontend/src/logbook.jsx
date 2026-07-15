/* Digital shift logbook — the v0.3 module, live on /api/logbook.

   Replaces the earlier local-state demo page: entries now persist through the
   backend's append-only log (a mistake is corrected by a NEW entry pointing at
   the old one — the bound-paper-logbook discipline, enforced by software).

   API base: same-origin by default; demo hosting builds with VITE_AMPS_API. */
import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_AMPS_API ?? ''

const SHIFT_LABEL = { M: 'Morning', E: 'Evening', N: 'Night', G: 'General', R: 'Rest' }
const ENTRY_TYPES = ['operation', 'observation', 'defect', 'handover']
const today = () => new Date().toISOString().slice(0, 10)

const fmtDate = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

function LiveBadge({ ok }) {
  return (
    <span className={`chip ${ok ? 'live-ok' : 'live-off'}`}>
      <span className="dot" />{ok ? 'Live API' : 'API offline'}
    </span>
  )
}

export default function LogBook() {
  const [entries, setEntries] = useState([])
  const [fDate, setFDate] = useState('')          // '' = all dates
  const [fShift, setFShift] = useState('')        // '' = all shifts
  const [apiOk, setApiOk] = useState(null)
  const [busy, setBusy] = useState(false)
  // add-entry form
  const [text, setText] = useState('')
  const [shift, setShift] = useState('M')
  const [type, setType] = useState('operation')
  const [author, setAuthor] = useState('demo.visitor')

  const load = async () => {
    try {
      const q = new URLSearchParams()
      if (fDate) q.set('log_date', fDate)
      if (fShift) q.set('shift', fShift)
      const res = await fetch(`${API}/api/logbook?${q}`)
      if (!res.ok) throw new Error(res.status)
      setEntries(await res.json())
      setApiOk(true)
    } catch {
      setApiOk(false)
    }
  }

  useEffect(() => { load() }, [fDate, fShift])  // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (e) => {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const res = await fetch(`${API}/api/logbook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_date: today(), shift, type,
          text: text.trim(), entered_by: author.trim() || 'demo.visitor',
        }),
      })
      if (!res.ok) throw new Error(res.status)
      setText('')
      await load()
    } catch {
      setApiOk(false)
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

      <form className="log-form card" onSubmit={add}>
        <select value={shift} onChange={(e) => setShift(e.target.value)} aria-label="Shift">
          {Object.keys(SHIFT_LABEL).map((s) => <option key={s} value={s}>{s} — {SHIFT_LABEL[s]}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Entry type">
          {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={author} onChange={(e) => setAuthor(e.target.value)}
               aria-label="Entered by" placeholder="Entered by…" className="log-author" maxLength={40} />
        <input value={text} onChange={(e) => setText(e.target.value)}
               placeholder="New log entry — readings, events, handover notes…" />
        <button className="btn" type="submit" disabled={busy || apiOk === false || !text.trim()}>
          {busy ? 'Adding…' : 'Add entry'}
        </button>
      </form>

      <div className="log-filters">
        <label className="dim">Date <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} /></label>
        <label className="dim">Shift <select value={fShift} onChange={(e) => setFShift(e.target.value)}>
          <option value="">All</option>
          {Object.keys(SHIFT_LABEL).map((s) => <option key={s} value={s}>{s} — {SHIFT_LABEL[s]}</option>)}
        </select></label>
        {(fDate || fShift) && (
          <button className="btn" onClick={() => { setFDate(''); setFShift('') }}>Clear filters</button>
        )}
      </div>

      {Object.entries(byDay).map(([day, list]) => (
        <div key={day} className="log-day">
          <h3 className="log-date dt">{fmtDate(day)}</h3>
          <div className="card">
            {list.map((en) => (
              <div className="log-entry" key={en.id}>
                <div className="log-meta">
                  <span className="dt">{fmtTime(en.at)}</span>
                  <span className="chip"><span className="dot" />{en.shift} · {SHIFT_LABEL[en.shift]}</span>
                  <span className={`chip ${en.type === 'defect' ? 'd-overdue' : ''}`}><span className="dot" />{en.type}</span>
                  <span className="dim">{en.entered_by}</span>
                  {en.asset_code && <span className="code">{en.asset_code}</span>}
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
