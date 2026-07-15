/* Failures & recovery — live module on /api/failures.

   The breakdown discipline a power-supply section runs on: report the failure
   the moment it happens, close it on recovery with what was done and by whom.
   Downtime is derived from the timestamps — never typed in, never fudged.

   API base: same-origin by default; split-host builds set VITE_AMPS_API. */
import { useEffect, useState } from 'react'
import { useLiveAssets } from './api.js'

const API = import.meta.env.VITE_AMPS_API ?? ''

const fmt = (ts) => new Date(ts).toLocaleString(undefined, {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
})

export default function LiveFailures() {
  const { assets } = useLiveAssets()
  const [rows, setRows] = useState([])
  const [stats, setStats] = useState(null)
  const [apiOk, setApiOk] = useState(null)
  const [busy, setBusy] = useState(false)
  // report form
  const [assetCode, setAssetCode] = useState('')
  const [faultType, setFaultType] = useState('')
  const [desc, setDesc] = useState('')
  // close form (one open at a time)
  const [closing, setClosing] = useState(null) // failure id
  const [workDone, setWorkDone] = useState('')
  const [attendedBy, setAttendedBy] = useState('')

  const load = async () => {
    try {
      const [list, st] = await Promise.all([
        fetch(`${API}/api/failures`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json() }),
        fetch(`${API}/api/failures/stats`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json() }),
      ])
      setRows(list)
      setStats(st)
      setApiOk(true)
    } catch {
      setApiOk(false)
    }
  }
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const report = async (e) => {
    e.preventDefault()
    if (!assetCode || !desc.trim() || busy) return
    setBusy(true)
    try {
      const res = await fetch(`${API}/api/failures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_code: assetCode, description: desc.trim(),
          fault_type: faultType.trim() || null,
        }),
      })
      if (!res.ok) throw new Error(res.status)
      setDesc(''); setFaultType('')
      await load()
    } catch { setApiOk(false) } finally { setBusy(false) }
  }

  const close = async (e) => {
    e.preventDefault()
    if (!workDone.trim() || busy) return
    setBusy(true)
    try {
      const res = await fetch(`${API}/api/failures/${closing}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_done: workDone.trim(), attended_by: attendedBy.trim() || null }),
      })
      if (!res.ok) throw new Error(res.status)
      setClosing(null); setWorkDone(''); setAttendedBy('')
      await load()
    } catch { setApiOk(false) } finally { setBusy(false) }
  }

  return (
    <>
      <div className="page-head">
        <h1>Failures &amp; recovery</h1>
        <span className={`chip ${apiOk ? 'live-ok' : 'live-off'}`}><span className="dot" />{apiOk ? 'Live API' : 'API offline'}</span>
      </div>
      <p className="dim page-sub">
        Report a breakdown when it happens; close it on recovery. Downtime and
        restore times are computed from the record — the numbers write themselves.
      </p>

      {apiOk === false && (
        <div className="card offline-note">
          <p className="dim">The AMPS API is not reachable — failures will come back with it.</p>
        </div>
      )}

      {stats && (
        <div className="kpis">
          <div className="tile"><div className="v">{stats.count}</div><div className="k">Failures — last {stats.window_days} days</div></div>
          <div className={stats.ongoing ? 'tile alert' : 'tile'}><div className="v">{stats.ongoing}</div><div className="k">Ongoing now</div></div>
          <div className="tile"><div className="v">{stats.downtime_hrs}</div><div className="k">Downtime hours</div></div>
          <div className="tile"><div className="v">{stats.mttr_hrs ?? '—'}</div><div className="k">Mean time to restore (h)</div></div>
        </div>
      )}

      <form className="log-form card" onSubmit={report}>
        <select value={assetCode} onChange={(e) => setAssetCode(e.target.value)} aria-label="Asset" required>
          <option value="">Failed asset…</option>
          {assets.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
        </select>
        <input value={faultType} onChange={(e) => setFaultType(e.target.value)}
               placeholder="Fault type (optional)" className="log-author" maxLength={60} />
        <input value={desc} onChange={(e) => setDesc(e.target.value)}
               placeholder="What happened — symptoms, how it was noticed…" />
        <button className="btn" type="submit" disabled={busy || apiOk === false || !assetCode || !desc.trim()}>
          {busy ? 'Reporting…' : 'Report failure'}
        </button>
      </form>

      <div className="card">
        {rows.length === 0 && <p className="dim" style={{ margin: 0 }}>No failures recorded{apiOk ? '' : ' (API offline)'}.</p>}
        {rows.map((f) => (
          <div className="log-entry" key={f.id}>
            <div className="log-meta">
              <span className="code">{f.asset_code}</span>
              <span className="t">{f.asset_name}</span>
              {f.fault_type && <span className="chip"><span className="dot" />{f.fault_type}</span>}
              {f.ended_at
                ? <span className="chip d-ok"><span className="dot" />Recovered · {f.downtime_hrs}h down</span>
                : <span className="chip d-overdue"><span className="dot" />Ongoing</span>}
              <span className="dim dt">{fmt(f.started_at)}{f.ended_at ? ` → ${fmt(f.ended_at)}` : ''}</span>
            </div>
            <div className="log-text">{f.description}</div>
            {f.work_done && (
              <div className="log-text dim">Work done: {f.work_done}{f.attended_by ? ` — ${f.attended_by}` : ''}</div>
            )}
            {!f.ended_at && closing !== f.id && (
              <button className="mini-btn" type="button" onClick={() => setClosing(f.id)}>Close — recovered</button>
            )}
            {closing === f.id && (
              <form className="log-form" onSubmit={close}>
                <input value={workDone} onChange={(e) => setWorkDone(e.target.value)}
                       placeholder="Work done to restore…" autoFocus />
                <input value={attendedBy} onChange={(e) => setAttendedBy(e.target.value)}
                       placeholder="Attended by…" className="log-author" maxLength={60} />
                <button className="btn" type="submit" disabled={busy || !workDone.trim()}>Confirm recovery</button>
                <button className="btn muted" type="button" onClick={() => setClosing(null)}>Cancel</button>
              </form>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
