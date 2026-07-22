import { useEffect, useState } from 'react'
import {
  ASSETS, PM_SCHEDULES, JOB_CARDS, SPECS, PROCUREMENTS, PROC_STAGES,
  FAILURES, SPARES, spareStats, checksheetFor, CHECKSHEET_TEMPLATES, CHECKSHEET_RESULTS,
  completedChecksheets, kpis, fmtDate, fmtTime, dueState, durationHrs, failureStats,
  failuresByMonth, classCountsAll, downtimeByAsset, recoveryStatus, pmOccurrencesInMonth,
} from './data.js'
import { LIVE, ORG, getJSON, useLiveAssets, useLiveAsset, useMe, apiLogin, apiLogout } from './api.js'
import QR, { assetUrl } from './qr.jsx'
import DutyRoster from './roster.jsx'
import LogBook from './logbook.jsx'

const STATUS_LABEL = {
  in_service: 'In service',
  under_maintenance: 'Under maintenance',
  out_of_service: 'Out of service',
  decommissioned: 'Decommissioned',
}

const StatusChip = ({ status }) => (
  <span className={`chip s-${status}`}><span className="dot" />{STATUS_LABEL[status]}</span>
)

/* the maker's mark — Arup's own signature, the way an artist signs a canvas.
   alt carries the full name so the credit stays in the source and for readers. */
const SignatureMark = () => (
  <img src="/signature.png" className="sig-mark" alt="Arup Biswas" title="Arup Biswas" />
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

/* ---------- dashboard (live) ---------- */

function LiveDashboard({ go, initialLine = null }) {
  const { assets: all, due: dueAll, loading, error } = useLiveAssets()
  const { me } = useMe()
  const [line, setLine] = useState(initialLine)
  useEffect(() => { setLine(initialLine) }, [initialLine])
  const lines = [...new Set(all.map((a) => a.line).filter(Boolean))].sort()
  // each line stands alone — no aggregated all-lines view; default to the
  // signed-in user's own line, else the first registered line
  const effLine = line ?? me?.line ?? lines[0] ?? null
  const assets = effLine ? all.filter((a) => a.line === effLine) : all
  const codes = new Set(assets.map((a) => a.code))
  const due = dueAll.filter((d) => codes.has(d.asset_code))
  const overdue = due.filter((d) => d.overdue_days > 0)
  const dueSoon = due.filter((d) => d.overdue_days <= 0 && daysUntil(d.next_due) <= 7)
  const nextPM = (code) => due.filter((d) => d.asset_code === code)
    .sort((x, y) => x.next_due.localeCompare(y.next_due))[0] ?? null
  const stations = new Set(assets.map((a) => a.location)).size
  if (loading) return <p className="dim">Loading the asset register…</p>
  if (error) return <div className="card offline-note">Backend unreachable — {error}. Check the server and reload.</div>
  return (
    <>
      {!initialLine && lines.length > 1 && (
        <div className="preset-bar" role="tablist" aria-label="Line">
          {lines.map((l) => (
            <button key={l} type="button" className={`btn preset ${effLine === l ? 'active' : ''}`} onClick={() => setLine(l)}>
              <span className="dot" style={{ background: lineColor(l), display: 'inline-block', width: 8, height: 8, borderRadius: 99, marginRight: 6 }} />{l}
            </button>
          ))}
        </div>
      )}
      <div className="kpis">
        <div className="tile"><div className="v">{assets.length}</div><div className="k">Assets registered</div></div>
        <div className="tile"><div className="v">{stations}</div><div className="k">Locations covered</div></div>
        <div className={dueSoon.length ? 'tile warn' : 'tile'}><div className="v">{dueSoon.length}</div><div className="k">PM due within 7 days</div></div>
        <div className={overdue.length ? 'tile alert' : 'tile'}><div className="v">{overdue.length}</div><div className="k">PM overdue</div></div>
      </div>

      <h2>Assets</h2>
      <NewAssetBar defaultLine={effLine} />
      <ImportBar />
      {assets.length === 0 ? (
        <div className="card"><p className="dim" style={{ margin: 0 }}>
          The register is empty. Download the sample CSV above, fill one row per asset
          (the standard register format), and import it back — the register, QR tags and
          asset pages fill in from here.
        </p></div>
      ) : (
        <div className="card tbl-wrap">
          <table>
            <thead>
              <tr><th>Code</th><th>Asset</th><th>Class</th><th>Location</th><th>System</th><th>Status</th><th>Next PM</th><th>PM state</th></tr>
            </thead>
            <tbody>
              {assets.map((a) => {
                const pm = nextPM(a.code)
                return (
                  <tr key={a.code} tabIndex={0} onClick={() => go(`/asset/${a.code}`)}
                      onKeyDown={(e) => e.key === 'Enter' && go(`/asset/${a.code}`)}>
                    <td className="code" data-l="Code">{a.code}</td>
                    <td data-l="Asset">{a.name}</td>
                    <td className="dim" data-l="Class">{a.cls}</td>
                    <td className="dim" data-l="Location">{a.location}</td>
                    <td className="dim" data-l="System">{a.sys ?? '—'}</td>
                    <td data-l="Status"><StatusChip status={a.status} /></td>
                    <td className="dim dt" data-l="Next PM">{pm ? pm.next_due : '—'}</td>
                    <td data-l="PM state">{pm ? <LivePmChip item={pm} /> : <span className="dim">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/* bulk import: download the standard CSV template, upload the filled one.
   The Green Line register format is the base for every line. */
/* Register one asset by hand — the counterpart to bulk CSV import, for the
   asset that arrives after the sheet was filled. Writers only. */
function NewAssetBar({ defaultLine }) {
  const { canWrite } = useMe()
  const [open, setOpen] = useState(false)
  const [flash, setFlash] = useState('')
  if (!canWrite) return null
  return (
    <div className="newasset">
      {!open
        ? <button className="btn ghost" type="button" onClick={() => setOpen(true)}>+ New asset</button>
        : <AssetForm mode="create"
                     initial={defaultLine ? { line: defaultLine, criticality: 'B', status: 'in_service' } : null}
                     onCancel={() => setOpen(false)}
                     onDone={(code) => { setOpen(false); setFlash(`${code} registered.`); location.hash = `/asset/${code}` }} />}
      {flash && <span className="import-msg">{flash}</span>}
    </div>
  )
}

function ImportBar() {
  const { canWrite } = useMe()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  if (!canWrite) return null
  const base = import.meta.env.VITE_AMPS_API ?? ''
  const onFile = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setResult(null)
    try {
      const r = await fetch(`${base}/api/assets/import`, {
        method: 'POST', headers: { 'Content-Type': 'text/csv' },
        body: await file.text(),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok) setResult({ error: body?.detail || `HTTP ${r.status}` })
      else setResult(body)
    } catch (err) {
      setResult({ error: String(err) })
    }
    setBusy(false)
  }
  return (
    <div className="import-bar">
      <a className="btn ghost" href={`${base}/api/assets/import/sample`} download>⬇ Sample CSV</a>
      <label className={`btn ghost${busy ? ' disabled' : ''}`}>
        {busy ? 'Importing…' : '⬆ Import CSV'}
        <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} hidden />
      </label>
      {result && (result.error
        ? <span className="import-msg err">{result.error}</span>
        : <span className="import-msg">
            {result.created} created · {result.skipped} skipped · {result.failed} failed
            {result.errors?.length ? ` — ${result.errors[0]}` : ''}
            {result.created > 0 && <button type="button" className="mini-btn" onClick={() => location.reload()}>Reload register</button>}
          </span>)}
    </div>
  )
}

const daysUntil = (iso) => Math.round((new Date(iso) - new Date()) / 86400000)

/* Lines named after colours get their colour as the chip dot — free for any
   org that names lines that way; everyone else gets a neutral dot. */
const LINE_COLORS = {
  green: '#1c7a44', blue: '#2b5c99', purple: '#5b3fbf', yellow: '#b98a00',
  red: '#a32e2e', orange: '#c2571a', pink: '#b83280', grey: '#52525b', gray: '#52525b',
}
const lineColor = (name) => {
  const word = (name || '').toLowerCase().split(/\s+/).find((w) => LINE_COLORS[w])
  return word ? LINE_COLORS[word] : '#a1a1aa'
}

const LivePmChip = ({ item }) => {
  const s = item.overdue_days > 0
    ? { key: 'overdue', label: `Overdue ${item.overdue_days}d` }
    : daysUntil(item.next_due) <= 7
      ? { key: 'due_soon', label: `Due in ${Math.max(daysUntil(item.next_due), 0)}d` }
      : { key: 'ok', label: 'On schedule' }
  return <span className={`chip d-${s.key}`}><span className="dot" />{s.label}</span>
}

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

      <h2>Assets</h2>
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

/* ---------- asset detail (live) ---------- */

/* One entry row, shared by both history sections. */
function LogRow({ en }) {
  return (
    <div className="wo">
      <div className="row1">
        {en.category && <span className="chip grp"><span className="dot" />{en.category}</span>}
        <span className={`chip ${en.type === 'failure' ? 'd-overdue' : ''}`}>
          <span className="dot" />{en.type}{en.subtype ? ` · ${en.subtype}` : ''}
        </span>
        {en.fault_type && <span className="chip"><span className="dot" />{en.fault_type}</span>}
        <span className="sub dt">{en.log_date}</span>
        {en.down_hours != null && <span className="sub">down <b>{en.down_hours}h</b></span>}
        {en.type === 'failure' && !en.ended_at && <span className="chip d-overdue">still open</span>}
      </div>
      <div className="findings">{en.text}</div>
      {(en.attended_by || en.entered_by) && (
        <div className="sub">by <b>{en.attended_by || en.entered_by}</b>
          {en.attended_by && en.attended_by !== en.entered_by && <> · recorded by {en.entered_by}</>}
        </div>
      )}
    </div>
  )
}

/* Maintenance and failures are the two things a section is judged on, so the
   asset card states them separately rather than as one blended stream — the
   same ledger, split by what the reader came to check. */
/* Long histories are the norm (some assets carry 60+ maintenance entries), and
   a full list would push the failure section off the bottom of the page — the
   very thing that made maintenance look missing before. Show a window, with
   the rest one click away. */
const LOG_WINDOW = 8

function LogList({ rows }) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, LOG_WINDOW)
  return (
    <>
      {shown.map((en) => <LogRow key={en.id} en={en} />)}
      {rows.length > LOG_WINDOW && (
        <button type="button" className="btn preset" onClick={() => setAll(!all)}>
          {all ? `Show latest ${LOG_WINDOW}` : `Show all ${rows.length}`}
        </button>
      )}
    </>
  )
}

function AssetLogSections({ log, staff }) {
  const maint = log.filter((e) => e.type === 'maintenance')
  const allFails = log.filter((e) => e.type === 'failure')
  const other = log.filter((e) => e.type !== 'maintenance' && e.type !== 'failure')
  // A public walk-up (QR scan) sees only settled history — open breakdowns are
  // operational and stay behind sign-in. Staff see them, pulled to the top and
  // marked. The maintenance record is public either way.
  const openFail = allFails.filter((e) => !e.ended_at)
  const resolvedFail = allFails.filter((e) => e.ended_at)
  // only timed entries carry a duration — see _down_hours on the API side
  const timed = resolvedFail.filter((e) => e.down_hours != null)
  const downtime = timed.reduce((s, e) => s + e.down_hours, 0)
  return (
    <>
      {staff && openFail.length > 0 && (
        <div className="sect open-fail-banner">
          <h3>⚠ Open breakdown{openFail.length > 1 ? 's' : ''} — {openFail.length} awaiting recovery</h3>
          <LogList rows={openFail} />
        </div>
      )}

      <div className="sect">
        <h3>
          Maintenance history — {maint.length ? `${maint.length} entr${maint.length === 1 ? 'y' : 'ies'}, newest first` : 'none recorded'}
        </h3>
        {maint.length === 0
          ? <p className="dim">No maintenance logged against this asset yet.</p>
          : <LogList rows={maint} />}
      </div>

      <div className="sect">
        <h3>
          Failure history — {resolvedFail.length
            ? <>{resolvedFail.length} resolved{timed.length > 0 && <> · {downtime.toFixed(1)}h downtime</>}</>
            : 'none recorded'}
          {!staff && openFail.length > 0 && <span className="dim"> · sign in for open breakdowns</span>}
        </h3>
        {resolvedFail.length === 0
          ? <p className="dim">No resolved failures recorded against this asset.</p>
          : <LogList rows={resolvedFail} />}
      </div>

      {other.length > 0 && (
        <div className="sect">
          <h3>Other log entries — notes & rectifications, newest first</h3>
          <LogList rows={other} />
        </div>
      )}
    </>
  )
}

/* The technical-detail editor, shared by "new asset" and "edit asset". A
   create POSTs the whole record; an edit PATCHes only the fields that moved,
   so the audit trail records real changes, not a rewrite of every field. */
const CRITICALITY = ['A', 'B', 'C']
const STATUSES = ['in_service', 'under_maintenance', 'out_of_service', 'decommissioned']

function AssetForm({ initial, mode, onDone, onCancel }) {
  const empty = {
    code: '', name: '', asset_class: '', location: '', line: '',
    system: '', make_model: '', criticality: 'B', status: 'in_service',
    commissioned_on: '',
  }
  // edit maps the full asset view; create starts empty but honours a couple of
  // sensible defaults (the line the register is currently showing)
  const start = mode === 'edit' ? {
    code: initial.code, name: initial.name, asset_class: initial.cls,
    location: initial.location, line: initial.line || '', system: initial.sys || '',
    make_model: initial.makeModel || '', criticality: initial.criticality,
    status: initial.status, commissioned_on: initial.commissionedOn || '',
  } : { ...empty, line: initial?.line || '' }
  const [f, setF] = useState(start)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [classes, setClasses] = useState([])
  useEffect(() => {
    getJSON('/api/assets').then((rows) =>
      setClasses([...new Set(rows.map((r) => r.asset_class).filter(Boolean))].sort())
    ).catch(() => {})
  }, [])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const codeChanged = mode === 'edit' && f.code !== start.code

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr('')
    try {
      const payload = { ...f }
      Object.keys(payload).forEach((k) => { if (payload[k] === '') payload[k] = null })
      const url = mode === 'edit'
        ? `/api/assets/${encodeURIComponent(start.code)}`
        : '/api/assets'
      const res = await fetch(url, {
        method: mode === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.detail || `HTTP ${res.status}`)
      }
      const saved = await res.json()
      onDone(saved.code)
    } catch (ex) {
      setErr(String(ex.message || ex).replace(/^Error: /, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="asset-form card" onSubmit={submit}>
      <datalist id="af-classes">{classes.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="af-grid">
        <label>Code<input value={f.code} onChange={set('code')} required
                          placeholder="printed on the QR tag" /></label>
        <label>Name<input value={f.name} onChange={set('name')} required /></label>
        <label>Asset class<input value={f.asset_class} onChange={set('asset_class')} required
                                 list="af-classes" /></label>
        <label>Location / station<input value={f.location} onChange={set('location')} required /></label>
        <label>Line<input value={f.line} onChange={set('line')} placeholder="e.g. Green Line" /></label>
        <label>System<input value={f.system} onChange={set('system')} placeholder="reporting rollup" /></label>
        <label>Make / model<input value={f.make_model} onChange={set('make_model')} /></label>
        <label>Commissioned on<input type="date" value={f.commissioned_on} onChange={set('commissioned_on')} /></label>
        <label>Criticality<select value={f.criticality} onChange={set('criticality')}>
          {CRITICALITY.map((c) => <option key={c} value={c}>{c}</option>)}
        </select></label>
        <label>Status<select value={f.status} onChange={set('status')}>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select></label>
      </div>
      {codeChanged && (
        <p className="af-warn">Changing the code re-keys the asset — the printed QR tag will need reprinting. History is preserved.</p>
      )}
      <div className="af-actions">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create asset'}
        </button>
        <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
        {err && <span className="import-msg err">{err}</span>}
      </div>
    </form>
  )
}

/* The register's answer to "who changed this, and from what" — the asset's
   audit trail, writers only. */
function AssetAudit({ code }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let alive = true
    getJSON(`/api/assets/${encodeURIComponent(code)}/audit`)
      .then((r) => alive && setRows(r)).catch(() => alive && setRows([]))
    return () => { alive = false }
  }, [code])
  if (!rows || rows.length === 0) return null
  return (
    <div className="sect">
      <h3>Change history — who edited this record</h3>
      {rows.map((r, i) => (
        <div className="wo" key={i}>
          <div className="row1">
            <span className={`chip ${r.action === 'created' ? 'w-done' : ''}`}>
              <span className="dot" />{r.action}
            </span>
            <span className="dim">by <b>{r.actor}</b></span>
            <span className="sub dt">{new Date(r.at).toLocaleString()}</span>
          </div>
          {r.detail && <div className="findings">{r.detail}</div>}
        </div>
      ))}
    </div>
  )
}

function LiveAssetDetail({ code }) {
  const { asset: a, history, log, loading, error, reload } = useLiveAsset(code)
  const { canWrite } = useMe()
  const [editing, setEditing] = useState(false)
  if (loading) return <p className="dim">Loading {code}…</p>
  if (error || !a) {
    return (
      <>
        <a className="crumb" href="#/">← Assets</a>
        <div className="card offline-note">
          {error && !String(error).includes('404')
            ? <>Backend unreachable — {error}.</>
            : <>No asset with code <span className="code">{code}</span> in the register.</>}
        </div>
      </>
    )
  }
  const accent = lineColor(a.line)
  const maint = log.filter((e) => e.type === 'maintenance')
  const resolvedFails = log.filter((e) => e.type === 'failure' && e.ended_at)
  const lastServiced = maint.length ? maint[0].log_date : null
  return (
    <>
      <a className="crumb" href="#/">← Assets</a>
      <div className="asset-passport" style={{ '--line-c': accent }}>
        {/* hero: the asset's identity, health and QR in one glance — the face
            of the QR-scan page a visitor or manager lands on */}
        <div className="card asset-hero">
          <span className="hero-bar" />
          <div className="hero-body">
            <div className="hero-id">
              <span className="hero-code">{a.code}</span>
              <h1 className="hero-name">{a.name}</h1>
              <div className="hero-sub">{a.cls}{a.sys ? ` · ${a.sys}` : ''}</div>
              <div className="hero-loc">
                <span className="ln-dot" style={{ background: accent }} />
                {a.line ? <b>{a.line}</b> : null}{a.line ? ' · ' : ''}{a.location} · {ORG}
              </div>
              <div className="hero-badges">
                <span className={`status-pill s-${a.status}`}><span className="dot" />{STATUS_LABEL[a.status]}</span>
                <span className={`crit-badge c-${a.criticality}`} title="Criticality">Criticality {a.criticality}</span>
                {canWrite && !editing && (
                  <button className="btn ghost sm" type="button" onClick={() => setEditing(true)}>Edit details</button>
                )}
              </div>
            </div>
            <div className="hero-qr">
              <QR value={assetUrl(a.code)} size={148} />
              <div className="hint">Scan to open<br />this record</div>
            </div>
          </div>
        </div>

        {/* the passport facts — one clean labelled grid, not a crammed line */}
        <div className="asset-facts card">
          {[
            ['Location', a.location],
            ['Line', a.line || '—'],
            ['System', a.sys || '—'],
            ['Asset class', a.cls],
            ['Make / model', a.makeModel || '—'],
            ['Commissioned', a.commissionedOn || '—'],
            ['Last serviced', lastServiced || '—'],
            ['Maintenance records', String(maint.length)],
          ].map(([k, v]) => (
            <div className="fact" key={k}>
              <span className="fk">{k}</span>
              <span className="fv">{v}</span>
            </div>
          ))}
        </div>

        {editing && (
          <div className="card"><div className="sect">
            <h3>Edit technical details</h3>
            <AssetForm initial={a} mode="edit"
                       onCancel={() => setEditing(false)}
                       onDone={(newCode) => {
                         setEditing(false)
                         if (newCode !== a.code) location.hash = `/asset/${newCode}`
                         else reload()
                       }} />
          </div></div>
        )}

        <div className="card">
          <AssetLogSections log={log} staff={canWrite} />

          <div className="sect">
            <h3>Work-order history — completed jobs, newest first</h3>
            {history.length === 0 ? <p className="dim">No records yet. Completed job cards and PM work appear here.</p> : history.map((w) => (
              <div className="wo" key={w.work_order_id}>
                <div className="row1">
                  <span className="code">#{w.work_order_id}</span>
                  <span className="t">{w.title}</span>
                  <WoChip status={w.status} />
                </div>
                {w.findings && <div className="findings">{w.findings}</div>}
                <div className="sub">
                  {w.type}
                  {w.done_by && <> · by <b>{w.done_by}</b></>}
                  {w.closed_at && <> · closed <span className="dt">{w.closed_at.slice(0, 10)}</span></>}
                </div>
              </div>
            ))}
          </div>

          {canWrite && <AssetAudit code={a.code} />}
        </div>
      </div>
    </>
  )
}

/* ---------- asset detail ---------- */

function AssetDetail({ code }) {
  const a = ASSETS.find((x) => x.code === code)
  if (!a) return <p>Asset not found. <a className="crumb" href="#/">← Back to assets</a></p>
  const pms = PM_SCHEDULES.filter((p) => p.asset === code)
  const wos = JOB_CARDS.filter((w) => w.asset === code)
  const specs = SPECS[code] ?? []
  return (
    <>
      <a className="crumb" href="#/">← Assets</a>
      <div className="detail-grid">
        <div className="card">
          <div className="detail-head">
            <h1><span className="code">{a.code}</span> · {a.name}</h1>
            <div className="meta">
              <span><b>{a.cls}</b></span>
              <span>{a.location} · {ORG}</span>
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
                  <a className="code jc-link" href={`#/jobcard/${w.id}`}>{w.id}</a>
                  <span className="t">{w.title}</span>
                  <WoChip status={w.status} />
                  <a className="mini-btn muted" href={`#/jobcard/${w.id}`}>Job card</a>
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

const FREQ_BADGE = { monthly: 'M', quarterly: 'Q', 'half-yearly': 'HY', yearly: 'Y' }

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

  // the list a planner opens this page for: overdue work carried forward
  const carried = PM_SCHEDULES
    .map((p) => ({ ...p, over: -Math.ceil((p.nextDue - now) / 86400000) }))
    .filter((p) => p.over > 0)
    .sort((a, b) => b.over - a.over)

  const monthItems = Object.values(occ).flat()
  const busiest = Object.entries(occ).sort((a, b) => b[1].length - a[1].length)[0]

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

      {carried.length > 0 && (
        <div className="plan-carry">
          <span className="plan-carry-t">⚠ Carried forward — overdue</span>
          {carried.map((p) => (
            <a key={p.asset + p.task} href={`#/asset/${p.asset}`} className="plan-carry-item">
              <b className="code">{p.asset}</b> {p.task} <span className="pc-days">{p.over}d</span>
            </a>
          ))}
        </div>
      )}

      <p className="plan-sum">
        <b>{monthItems.length}</b> scheduled task{monthItems.length !== 1 ? 's' : ''} in {monthName.split(' ')[0]}
        {busiest && busiest[1].length > 1 && <> · busiest day <b className="dt">{String(busiest[0]).padStart(2, '0')} {monthName.split(' ')[0]}</b> ({busiest[1].length} tasks)</>}
        {isThisMonth && carried.length > 0 && <> · <span className="pc-red">{carried.length} overdue carried forward</span></>}
      </p>
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
                      <i className="cal-freq">{FREQ_BADGE[p.frequency]}</i> <b>{p.asset}</b> <span className="cal-task">{p.task}</span>
                    </a>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <p className="roadmap">Planned dates are projected from each task's frequency (M / Q / HY / Y). Red = overdue. Click a task to open the asset.</p>
    </>
  )
}

/* ---------- failures & recovery: analysis dashboard ---------- */

function TrendChart({ data }) {
  const W = 560, H = 170, PAD = { t: 18, r: 8, b: 24, l: 8 }
  const max = Math.max(...data.map((m) => m.count), 1)
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const bw = Math.min(34, (iw / data.length) * 0.5)
  const x = (i) => PAD.l + (iw / data.length) * (i + 0.5)
  const y = (v) => PAD.t + ih * (1 - v / max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz" role="img" aria-label="Failures per month">
      {[...Array(max + 1)].map((_, g) => (
        <line key={g} x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} className="viz-grid" />
      ))}
      {data.map((m, i) => (
        <g key={m.label}>
          {m.count > 0 && (
            <>
              <rect x={x(i) - bw / 2} y={y(m.count)} width={bw} height={ih - (y(m.count) - PAD.t) + 0.5}
                    rx={0} className="viz-bar-base" />
              <rect x={x(i) - bw / 2} y={y(m.count)} width={bw} height={Math.min(8, ih * (m.count / max))}
                    rx={4} className="viz-bar-cap" />
              <text x={x(i)} y={y(m.count) - 6} className="viz-val" textAnchor="middle">{m.count}</text>
            </>
          )}
          {m.count === 0 && <circle cx={x(i)} cy={y(0)} r={2} className="viz-zero" />}
          <text x={x(i)} y={H - 6} className="viz-cat" textAnchor="middle">{m.label}</text>
        </g>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="viz-axis" />
    </svg>
  )
}

function HBar({ rows, unit, seq }) {
  const max = rows[0]?.[1] ?? 1
  return (
    <div className="hbars">
      {rows.map(([label, v], i) => (
        <div className="bar-row" key={label}>
          <span className="bar-label" title={label}>{label}</span>
          <span className="bar-track">
            <span className={`bar-fill${seq ? ` seq-${Math.min(3, i)}` : ''}`} style={{ width: `${Math.max((v / max) * 100, 2)}%` }} />
          </span>
          <span className="bar-val dt">{v}{unit}</span>
        </div>
      ))}
    </div>
  )
}

function Failures() {
  const s = failureStats(90)
  const trend = failuresByMonth(6)
  const classes = classCountsAll()
  const downtime = downtimeByAsset().slice(0, 5)
  const rec = recoveryStatus()
  const recPct = Math.round((rec.restored / (rec.restored + rec.ongoing)) * 100)

  // computed insights, not decoration
  const worstClass = classes[0]
  const worstAsset = downtime[0]
  const prev3 = trend.slice(0, 3).reduce((a, m) => a + m.count, 0)
  const last3 = trend.slice(3).reduce((a, m) => a + m.count, 0)
  const dir = last3 < prev3 ? 'down' : last3 > prev3 ? 'up' : 'flat'

  return (
    <>
      <div className="kpis">
        <div className="tile"><div className="v">{s.total}</div><div className="k">Failures — last 90 days</div></div>
        <div className={s.ongoing ? 'tile alert' : 'tile'}><div className="v">{s.ongoing}</div><div className="k">Ongoing breakdowns</div></div>
        <div className="tile"><div className="v">{s.downtime} h</div><div className="k">Downtime — 90 days</div></div>
        <div className="tile"><div className="v">{s.mttr} h</div><div className="k">Mean time to recover</div></div>
        <div className="tile"><div className="v">{recPct}%</div><div className="k">Recovery rate — 6 months</div></div>
      </div>

      <div className="viz-grid2">
        <section className="card viz-card">
          <h2 className="viz-h">Failures per month <span className="viz-note">last 6 months</span></h2>
          <TrendChart data={trend} />
          <p className="viz-insight">
            {dir === 'down' && <>Trend improving — {last3} failures in the last 3 months vs {prev3} in the previous 3.</>}
            {dir === 'up' && <>Trend worsening — {last3} failures in the last 3 months vs {prev3} in the previous 3.</>}
            {dir === 'flat' && <>Steady — {last3} failures in each of the last two quarters.</>}
          </p>
        </section>

        <section className="card viz-card">
          <h2 className="viz-h">Recovery status <span className="viz-note">6 months</span></h2>
          <div className="meter" role="img" aria-label={`${rec.restored} restored, ${rec.ongoing} ongoing`}>
            <span className="meter-fill" style={{ width: `${recPct}%` }} />
          </div>
          <div className="meter-legend">
            <span><span className="lg-dot lg-restored" />Restored · {rec.restored}</span>
            <span><span className="lg-dot lg-ongoing" />Ongoing · {rec.ongoing}</span>
          </div>
          <p className="viz-insight">
            {rec.ongoing === 0
              ? 'All recorded failures stand restored.'
              : `${rec.ongoing} breakdown${rec.ongoing > 1 ? 's' : ''} still open — oldest: ${FAILURES.filter((f) => !f.restored).map((f) => f.asset).join(', ')}.`}
          </p>
        </section>

        <section className="card viz-card">
          <h2 className="viz-h">Failures by system <span className="viz-note">6 months</span></h2>
          <HBar rows={classes} unit="" />
          <p className="viz-insight">{worstClass[0]} leads with {worstClass[1]} failures — focus area for the next PM review.</p>
        </section>

        <section className="card viz-card">
          <h2 className="viz-h">Downtime by asset <span className="viz-note">top 5 · hours</span></h2>
          <HBar rows={downtime} unit=" h" seq />
          <p className="viz-insight">{worstAsset[0]} accounts for {worstAsset[1]} h — the availability bottleneck.</p>
        </section>
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

/* ---------- failures: live KPI surface over the one ledger ---------- */

/* Reads failure entries straight from the logbook — no second table, no
   pre-aggregation. The tiles answer the three questions a section head asks
   at a glance: how often, how long down, and what is still open. */
/* Imported history runs to Feb 2026 while the calendar says July, so a 90-day
   default would open the page on an empty window and read as broken. Default
   to the whole record and let the user narrow. */
const FAIL_PERIODS = [
  ['All time', 36500, 12],
  ['Last 12 months', 365, 12],
  ['Last 90 days', 90, 6],
]

function LiveFailures() {
  const [stats, setStats] = useState(null)
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [cls, setCls] = useState('')
  const [state, setState] = useState('open')   // tab: 'open' | 'resolved'
  const [period, setPeriod] = useState(0)

  const [periodLabel, days, months] = FAIL_PERIODS[period]

  useEffect(() => {
    let alive = true
    setStats(null)
    Promise.all([
      getJSON(`/api/logbook/failure-stats?days=${days}&months=${months}`),
      getJSON('/api/logbook?entry_type=failure&limit=1000'),
    ])
      .then(([s, l]) => { if (alive) { setStats(s); setRows(l) } })
      .catch((e) => alive && setError(String(e)))
    return () => { alive = false }
  }, [days, months])

  if (error) return <div className="card offline-note">Backend unreachable — {error}.</div>
  if (!stats) return <p className="dim">Loading failure record…</p>

  const trend = stats.per_month.map((m) => ({
    label: new Date(`${m.month}-01T00:00:00`).toLocaleString(undefined, { month: 'short' }),
    count: m.count,
  }))
  const prev3 = trend.slice(0, 3).reduce((a, m) => a + m.count, 0)
  const last3 = trend.slice(3).reduce((a, m) => a + m.count, 0)
  const dir = last3 < prev3 ? 'down' : last3 > prev3 ? 'up' : 'flat'
  const asRows = (a) => a.map((c) => [c.name, c.count])

  // two tabs: still-open breakdowns vs restored ones. A row is open until a
  // recovery time exists (linked or not); unlinked-open rows are flagged.
  const byClass = (r) => !cls || (r.category || 'Unclassified') === cls
  const openRows = rows.filter((r) => !r.ended_at && byClass(r))
  const resolvedRows = rows.filter((r) => r.ended_at && byClass(r))
  const shown = state === 'open' ? openRows : resolvedRows

  return (
    <>
      <div className="log-filters">
        <label className="dim">Period <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
          {FAIL_PERIODS.map(([lbl], i) => <option key={lbl} value={i}>{lbl}</option>)}
        </select></label>
        <label className="dim">Class <select value={cls} onChange={(e) => setCls(e.target.value)}>
          <option value="">All</option>
          {stats.by_class.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select></label>
        <span className="dim">Read-only — report a failure in the <a href="#/log">Log book</a>.</span>
      </div>

      <div className="kpis">
        <div className="tile"><div className="v">{stats.total}</div>
          <div className="k">Failures — {periodLabel.toLowerCase()}</div></div>
        <div className={stats.open ? 'tile alert' : 'tile'}><div className="v">{stats.open}</div>
          <div className="k">Open breakdowns</div></div>
        <div className="tile"><div className="v">{stats.measured ? `${stats.downtime_hours} h` : '—'}</div>
          <div className="k">Downtime{stats.measured ? ` · ${stats.measured} timed` : ' — none timed'}</div></div>
        <div className="tile"><div className="v">{stats.mttr_hours != null ? `${stats.mttr_hours} h` : '—'}</div>
          <div className="k">{stats.mttr_hours != null ? `MTTR · ${stats.measured} of ${stats.closed}` : 'MTTR — needs clock times'}</div></div>
        <div className={stats.unlinked ? 'tile warn' : 'tile'}><div className="v">{stats.unlinked}</div>
          <div className="k">Unlinked records</div></div>
      </div>

      {(stats.unmeasured > 0 || stats.unlinked > 0) && (
        <p className="viz-insight">
          {stats.unmeasured > 0 && <>Downtime and MTTR come from the {stats.measured} failure{stats.measured === 1 ? '' : 's'} logged
            with clock times; {stats.unmeasured} imported record{stats.unmeasured === 1 ? '' : 's'} carry a date only and sit outside the averages. </>}
          {stats.unlinked > 0 && <>{stats.unlinked} record{stats.unlinked === 1 ? '' : 's'} never matched an asset code in the register —
            they are a data-quality backlog, not open work.</>}
        </p>
      )}

      <div className="viz-grid2">
        <section className="card viz-card">
          <h2 className="viz-h">Failures per month <span className="viz-note">last {months} months</span></h2>
          <TrendChart data={trend} />
          <p className="viz-insight">
            {dir === 'down' && <>Improving — {last3} in the last 3 months vs {prev3} in the previous 3.</>}
            {dir === 'up' && <>Worsening — {last3} in the last 3 months vs {prev3} in the previous 3.</>}
            {dir === 'flat' && <>Steady — {last3} in each of the last two quarters.</>}
          </p>
        </section>

        <section className="card viz-card">
          <h2 className="viz-h">By asset class <span className="viz-note">{periodLabel.toLowerCase()}</span></h2>
          {stats.by_class.length === 0 ? <p className="dim">Nothing in this window.</p> : <>
            <HBar rows={asRows(stats.by_class)} unit="" />
            <p className="viz-insight">{stats.by_class[0].name} leads with {stats.by_class[0].count} — focus for the next PM review.</p>
          </>}
        </section>

        <section className="card viz-card">
          <h2 className="viz-h">Fault types <span className="viz-note">{periodLabel.toLowerCase()}</span></h2>
          {stats.by_fault.length === 0
            ? <p className="dim">No fault types classified in this window.</p>
            : <HBar rows={asRows(stats.by_fault)} unit="" seq />}
        </section>

        <section className="card viz-card">
          <h2 className="viz-h">Repeat offenders <span className="viz-note">most failures</span></h2>
          {stats.by_asset.length === 0
            ? <p className="dim">Nothing in this window.</p>
            : <>
                <HBar rows={asRows(stats.by_asset)} unit="" seq />
                <p className="viz-insight">{stats.by_asset[0].name} has failed {stats.by_asset[0].count} times — worth a condition review.</p>
              </>}
        </section>
      </div>

      <h2>Failure &amp; recovery log</h2>
      <div className="fail-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={state === 'open'}
                className={`fail-tab${state === 'open' ? ' active' : ''}${openRows.length ? ' has-open' : ''}`}
                onClick={() => setState('open')}>
          Open failures <span className="fail-tab-n">{openRows.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={state === 'resolved'}
                className={`fail-tab${state === 'resolved' ? ' active' : ''}`}
                onClick={() => setState('resolved')}>
          Resolved <span className="fail-tab-n">{resolvedRows.length}</span>
        </button>
      </div>
      <div className="card tbl-wrap">
        <table>
          <thead><tr><th>Asset</th><th>Class</th><th>Occurred</th><th>Restored</th><th>Down</th><th>State</th><th>Team</th><th>Fault → what happened</th></tr></thead>
          <tbody>
            {shown.map((f) => (
              <tr key={f.id} tabIndex={0}
                  onClick={() => f.asset_code && (location.hash = `/asset/${f.asset_code}`)}
                  onKeyDown={(e) => e.key === 'Enter' && f.asset_code && (location.hash = `/asset/${f.asset_code}`)}>
                <td className="code" data-l="Asset">{f.asset_code || '—'}</td>
                <td className="dim" data-l="Class">{f.category || '—'}</td>
                <td className="dim dt" data-l="Occurred">{f.log_date}</td>
                {/* midnight means no clock time was recorded — show the date alone
                    rather than an invented 00:00 (same rule as the log book) */}
                <td className="dim dt" data-l="Restored">{f.ended_at
                  ? (f.ended_at.slice(11, 16) === '00:00'
                      ? f.ended_at.slice(0, 10)
                      : f.ended_at.slice(0, 16).replace('T', ' '))
                  : '—'}</td>
                <td className="dt" data-l="Down">{f.down_hours != null ? `${f.down_hours} h` : '—'}</td>
                <td data-l="State">{!f.asset_code
                  ? <span className="chip"><span className="dot" />Unlinked</span>
                  : f.ended_at
                    ? <span className="chip w-done"><span className="dot" />Restored</span>
                    : <span className="chip d-overdue"><span className="dot" />Open</span>}</td>
                <td className="dim" data-l="Team">{f.attended_by || f.entered_by || '—'}</td>
                <td className="wrap-cell" data-l="Fault">
                  {f.fault_type && <b>{f.fault_type} </b>}{f.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="dim" style={{ padding: '1rem' }}>Nothing matches this filter.</p>}
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
        <p>To,<br />The Senior Manager (Procurement)<br />{ORG}</p>
        <p className="l-sub"><b>Subject: Proposal for procurement of {p.item} — {p.qty}</b></p>
        <p>Respected Sir,</p>
        <p>
          It is proposed to procure <b>{p.item}</b> ({p.qty}) for <b>{p.asset} — {a?.name}</b> installed
          at {a?.location}, {ORG}.
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
        <p className="l-sign">Yours faithfully,<br /><br />Power Supply &amp; E&amp;M Maintenance<br />{ORG}</p>
      </div>
    </>
  )
}

/* ---------- job card (official document) ---------- */

function JobCard({ jcId }) {
  const w = JOB_CARDS.find((x) => x.id === jcId)
  if (!w) return <p>Job card not found. <a className="crumb" href="#/">← Assets</a></p>
  const asset = ASSETS.find((x) => x.code === w.asset)
  const done = w.status === 'done' || w.status === 'verified'
  const cs = CHECKSHEET_RESULTS[w.id]
  return (
    <>
      <div className="sheet-bar">
        <a className="crumb" style={{ margin: 0 }} href={`#/asset/${asset.code}`}>← {asset.code}</a>
        <button className="btn" onClick={() => window.print()}>Print job card</button>
        <p>{done ? 'Completed — returned with technician acknowledgement.' : 'Issued copy — hand over to the executing department / agency.'}</p>
      </div>

      <div className="osheet">
        <div className="os-top">
          <div className="os-brand">
            <div className="os-org"><span className="bolt">⚡</span>AMPS</div>
            <div className="os-dept">Power Supply &amp; E&amp;M Maintenance<br />{ORG}</div>
          </div>
          <div className="os-title">
            <div className="os-t1">Job Card</div>
            <div className="os-t2">{w.title}</div>
          </div>
          <div className="os-qr">
            <QR value={assetUrl(asset.code)} size={72} />
            <div className="os-qr-cap">Scan for asset history</div>
          </div>
        </div>

        <div className="os-doc">
          <span>Job card no.: <b className="code">{w.id}</b> · Format AMPS/JC-01 · Rev 00</span>
          <span>{done ? <b className="os-locked">Status: COMPLETED · LOCKED 🔒</b> : `Status: ${w.status.toUpperCase()}`}</span>
          <span>Page 1 of 1</span>
        </div>

        <table className="os-details">
          <tbody>
            <tr>
              <td><label>Asset code</label><b className="code">{w.asset}</b></td>
              <td><label>Asset</label>{asset.name}</td>
              <td><label>Location</label>{asset.location}</td>
              <td><label>Job type</label>{cap(w.type)}</td>
            </tr>
            <tr>
              <td><label>Issued to</label>{w.issuedTo}</td>
              <td><label>Date of issue</label>{fmtDate(w.openedAt)}</td>
              <td><label>Date of completion</label>{w.closedAt ? fmtDate(w.closedAt) : ''}</td>
              <td><label>Enclosures</label>{(() => {
                const docs = w.docs ?? []
                if (!cs && docs.length === 0) return <span className="dim">— none on file —</span>
                return <span>
                  {cs && <a href={`#/checksheet/wo/${w.id}`} className="jc-encl">Dept. checksheet ✓</a>}
                  {docs.map((d2, i) => <span key={i}>{(cs || i > 0) && ' · '}{d2}</span>)}
                </span>
              })()}</td>
            </tr>
          </tbody>
        </table>

        <div className="os-remarks">
          <label>Job details / work required</label>
          <p>{w.desc}</p>
        </div>

        <div className="os-remarks" style={{ borderTop: '1px solid #a8a29e' }}>
          <label>Completion report / findings</label>
          {w.findings ? <p>{w.findings}</p> : <><span className="os-rule" /><span className="os-rule" /></>}
        </div>

        <table className="os-signs">
          <tbody>
            <tr>
              <td>
                <span className="os-sign-space">Sr. Engineer (E)</span>
                <label>Issued by</label>
                <span className="os-date">Date: {fmtDate(w.openedAt)}</span>
              </td>
              <td>
                <span className="os-sign-space">{done ? w.ackBy : ''}</span>
                <label>Executed &amp; acknowledged by (agency)</label>
                <span className="os-date">Date: {w.closedAt ? fmtDate(w.closedAt) : '__________'}</span>
              </td>
              <td>
                <span className="os-sign-space">{w.status === 'verified' ? 'R. Das (Supervisor)' : ''}</span>
                <label>Verified by</label>
                <span className="os-date">Date: {w.status === 'verified' ? fmtDate(w.closedAt) : '__________'}</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="os-foot">
          Generated by AMPS — Asset Maintenance &amp; Preventive Scheduling · Format AMPS/JC-01 Rev 00
        </div>
      </div>

      {done && <p className="roadmap">🔒 Completed job cards are locked with their enclosures. Agency reports and bills come in the agency's own format and are filed as submitted — only the departmental checksheet follows the AMPS format.</p>}
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
    if (!filled || !wo) return <p>Checksheet not found. <a className="crumb" href="#/">← Assets</a></p>
    task = filled.task
    asset = ASSETS.find((x) => x.code === wo.asset)
  } else {
    asset = ASSETS.find((x) => x.code === a1)
    task = decodeURIComponent(a2)
    if (!asset) return <p>Asset not found. <a className="crumb" href="#/">← Assets</a></p>
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
            <div className="os-dept">Power Supply &amp; E&amp;M Maintenance<br />{ORG}</div>
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
  const live = useLiveAssets()
  const assets = LIVE ? live.assets : ASSETS
  return (
    <>
      <div className="sheet-bar">
        <button className="btn" onClick={() => window.print()}>Print tag sheet</button>
        <p>One tag per asset — print, laminate, stick on the equipment. Scanning opens the asset's live record.</p>
      </div>
      {LIVE && live.loading ? <p className="dim">Loading the asset register…</p>
        : assets.length === 0 ? <div className="card"><p className="dim" style={{ margin: 0 }}>No assets in the register yet — tags appear as assets are added.</p></div>
        : (
          <div className="tags">
            {assets.map((a) => (
              <div className="tag" key={a.code}>
                <QR value={assetUrl(a.code)} size={140} />
                <div className="scan-cap">Scan for history</div>
                <div className="nm">{a.name}</div>
                <span className="code">{a.code}</span>
                <div className="org">AMPS · {ORG.toUpperCase()}</div>
              </div>
            ))}
          </div>
        )}
    </>
  )
}

/* ---------- shell + hash router ---------- */

const routeFromHash = () => location.hash.replace(/^#/, '') || '/'

/* Live deployments only show modules whose backend exists; the rest join the
   nav release by release. The demo build keeps the full walkthrough. */
const NAV = LIVE ? [
  ['/', 'Assets'],
  ['/log', 'Log book'],
  ['/failures', 'Failures'],
  ['/tags', 'QR tags'],
] : [
  ['/', 'Assets'],
  ['/planner', 'Planner'],
  ['/roster', 'Duty roster'],
  ['/log', 'Log book'],
  ['/failures', 'Failures'],
  ['/spares', 'Spares'],
  ['/procurement', 'Procurement'],
  ['/tags', 'QR tags'],
]

const NotYet = () => (
  <div className="card"><p className="dim" style={{ margin: 0 }}>
    This module isn't part of the installed release yet — it arrives with a
    later version. <a className="crumb" href="#/">← Back to assets</a>
  </p></div>
)

/* ---------- sign in (line-scoped operations) ---------- */

function LoginForm({ autoFocus = false }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await apiLogin(username.trim(), password)
      location.hash = '/'
      location.reload() // fresh session everywhere: nav, scope, authorship
    } catch (ex) {
      setErr(String(ex.message || 'login failed'))
      setBusy(false)
    }
  }
  return (
    <form className="login-form-fields" onSubmit={submit}>
      <input autoFocus={autoFocus} autoComplete="username" placeholder="Username"
             value={username} onChange={(e) => setUsername(e.target.value)} />
      <input type="password" autoComplete="current-password" placeholder="Password"
             value={password} onChange={(e) => setPassword(e.target.value)} />
      {err && <div className="login-err">{err}</div>}
      <button className="btn" type="submit" disabled={busy || !username.trim() || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

/* ---------- landing: four line squares + sign-in (anonymous home) ---------- */

/* Abstract alpona — the Bengali dot-and-petal floor motif, geometrized:
   a centre dot, two dotted rings, eight petal arcs. Watermark, not ornament. */
function Alpona({ size = 120 }) {
  const dots = (r, n, key) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return <circle key={`${key}${i}`} cx={60 + r * Math.cos(a)} cy={60 + r * Math.sin(a)} r="1.6" />
  })
  const petals = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * 360
    return <path key={`p${i}`} d="M 60 22 Q 66 34 60 44 Q 54 34 60 22 Z"
                 transform={`rotate(${a} 60 60)`} fill="currentColor" opacity="0.5" stroke="none" />
  })
  return (
    <svg className="alpona" width={size} height={size} viewBox="0 0 120 120" aria-hidden="true"
         fill="currentColor" stroke="currentColor" strokeWidth="1">
      <circle cx="60" cy="60" r="4" stroke="none" />
      <circle cx="60" cy="60" r="12" fill="none" opacity="0.7" />
      {petals}
      {dots(30, 16, 'a')}
      <circle cx="60" cy="60" r="50" fill="none" strokeDasharray="2 6" opacity="0.6" />
      {dots(57, 24, 'b')}
    </svg>
  )
}

function useLines() {
  const [lines, setLines] = useState(null)
  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.VITE_AMPS_API ?? ''}/api/lines`)
      .then((r) => (r.ok ? r.json() : []))
      .then((l) => alive && setLines(l))
      .catch(() => alive && setLines([]))
    return () => { alive = false }
  }, [])
  return lines
}

/* the metro-map ribbon: every line's colour in running order, blended
   into one continuous band — no joints, colours flow into each other */
const Ribbon = ({ lines }) => {
  if (!lines?.length) return null
  const n = lines.length
  const blend = Math.min(4, 20 / n) // soft crossfade zone between neighbours
  const stops = lines.map((l, i) => {
    const c = lineColor(l.name)
    return `${c} ${(i / n) * 100 + blend}%, ${c} ${((i + 1) / n) * 100 - blend}%`
  }).join(', ')
  return <div className="metro-ribbon" aria-hidden="true"
              style={{ background: `linear-gradient(90deg, ${stops})` }} />
}

function Landing() {
  const lines = useLines()
  return (
    <div className="gate land">
      <div className="land-wrap">
        <header className="land-head">
          <img className="land-emblem" src={`${import.meta.env.BASE_URL}metro-logo.svg`}
               alt="Indian Railways" />
          <div className="land-head-rule" aria-hidden="true" />
          <div>
            <div className="gate-badge">⚡ AMPS <span className="gate-live">● LIVE</span></div>
            <h1 className="gate-title">{ORG}</h1>
            <p className="gate-sub">Asset Maintenance &amp; Preventive Scheduling</p>
          </div>
          <a className="btn gate-signin-btn" href="#/login">Sign in</a>
        </header>
        <Ribbon lines={lines} />
        <div className="land-tiles">
          {lines === null ? <p className="gate-dim">Loading…</p> : lines.length === 0 ? (
            <p className="gate-dim">No lines registered yet — the administrator adds them with the first assets.</p>
          ) : lines.map((l) => (
            <a key={l.name} className={`land-tile${l.initiator ? ' initiator' : ''}`}
               href={`#/line/${encodeURIComponent(l.name)}`}
               style={{ '--line-c': lineColor(l.name) }}>
              {l.initiator && <Alpona />}
              <span className="gate-line-dot" />
              <span className="land-tile-name">{l.name}
                {l.initiator && <span className="gate-initiator-chip">সূচনা · initiator</span>}
              </span>
              <span className="land-tile-sub">{l.assets} assets · {l.stations} locations</span>
              <span className="land-tile-go">View →</span>
            </a>
          ))}
        </div>
        <div className="gate-foot">AMPS · MIT © 2026 <SignatureMark /></div>
      </div>
    </div>
  )
}

/* ---------- standalone sign-in page ---------- */

function LoginPage() {
  const lines = useLines()
  return (
    <div className="gate">
      <div className="gate-panel solo">
        <div className="gate-auth">
          <Ribbon lines={lines} />
          <div className="gate-auth-brand"><span className="bolt">⚡</span> Sign in to AMPS</div>
          <p className="gate-auth-sub">{ORG} — operational access for your line: report failures, write the log, register assets. Viewing needs no account.</p>
          <LoginForm autoFocus />
          <a className="gate-back" href="#/">← Back to lines</a>
          <div className="gate-foot">AMPS · MIT © 2026 <SignatureMark /></div>
        </div>
      </div>
    </div>
  )
}

/* ---------- one line, view-only (from a landing square) ---------- */

function LineView({ name }) {
  return (
    <>
      <a className="crumb" href="#/">← All lines</a>
      <LiveDashboard go={(r) => { location.hash = r }} initialLine={name} />
    </>
  )
}

export default function App() {
  const [route, setRoute] = useState(routeFromHash)
  const { me, loading: meLoading } = useMe()
  useEffect(() => {
    const onHash = () => { setRoute(routeFromHash()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = (r) => { location.hash = r }
  const authOn = LIVE && me?.auth_enabled
  const signedIn = authOn && me.username !== 'viewer'
  const anonymous = authOn && !signedIn

  const assetMatch = route.match(/^\/asset\/(.+)$/)
  const lineMatch = route.match(/^\/line\/(.+)$/)
  const letterMatch = route.match(/^\/procurement\/([^/]+)\/letter$/)
  const csMatch = route.match(/^\/checksheet\/(wo|pm)\/([^/]+)(?:\/(.+))?$/)
  const jcMatch = route.match(/^\/jobcard\/(.+)$/)

  if (LIVE && meLoading) return null // one clean paint: landing or app, never both

  // The train artwork is mounted once, outside the page switch — it never
  // reloads on navigation; only its opacity changes (full on the landing,
  // muted behind every other page).
  const onLanding = anonymous && route !== '/login' && !assetMatch && !lineMatch
  const siteArt = (
    <img className={`site-art${onLanding ? '' : ' muted'}`} alt="" aria-hidden="true"
         src={`${import.meta.env.BASE_URL}landing-art.webp`} />
  )

  // Anonymous surface = landing (line squares + sign-in), a chosen line
  // view-only, and QR-scanned asset pages. Everything else routes home.
  if (anonymous) {
    if (route === '/login') return <>{siteArt}<LoginPage /></>
    if (onLanding) return <>{siteArt}<Landing /></> // full-screen, own chrome
    const navLine = lineMatch ? decodeURIComponent(lineMatch[1]) : null
    return (
      <>{siteArt}
      <div className="shell" style={navLine ? { '--nav-c': lineColor(navLine) } : undefined}>
        <header className="topbar">
          <a href="#/" className="brand">
            <img className="brand-emblem" src={`${import.meta.env.BASE_URL}metro-logo.svg`} alt="" />
            <span className="bolt">⚡</span>AMPS
            <span className="brand-sub">{ORG} · maintenance records</span>
          </a>
          <nav className="nav">
            <a href="#/login" className="btn login-btn">Sign in</a>
          </nav>
        </header>
        {assetMatch ? <LiveAssetDetail code={assetMatch[1]} />
          : <LineView name={decodeURIComponent(lineMatch[1])} />}
        <footer className="foot">{ORG} · maintenance records · AMPS, MIT © 2026 <SignatureMark /></footer>
      </div>
      </>
    )
  }

  const navLine = lineMatch ? decodeURIComponent(lineMatch[1]) : (signedIn && me.line) || null
  return (
    <>{siteArt}
    <div className="shell" style={navLine ? { '--nav-c': lineColor(navLine) } : undefined}>
      <header className="topbar">
        <a href="#/" className="brand">
          <img className="brand-emblem" src={`${import.meta.env.BASE_URL}metro-logo.svg`} alt="" />
          <span className="bolt">⚡</span>AMPS
          <span className="brand-sub">Asset Maintenance &amp; Preventive Scheduling</span>
        </a>
        <nav className="nav">
          {NAV.map(([path, label]) => (
            <a key={path} href={`#${path}`} className={route === path ? 'active' : ''}>{label}</a>
          ))}
          {signedIn && (
            <span className="who">
              <span className="dot" style={{ background: lineColor(me.line || '') }} />
              {me.full_name}{me.line ? ` · ${me.line}` : ''}
              <button className="mini-btn muted" type="button" onClick={apiLogout}>Sign out</button>
            </span>
          )}
        </nav>
      </header>

      {assetMatch ? (LIVE ? <LiveAssetDetail code={assetMatch[1]} /> : <AssetDetail code={assetMatch[1]} />)
        : lineMatch ? (LIVE ? <LineView name={decodeURIComponent(lineMatch[1])} /> : <NotYet />)
        : letterMatch ? (LIVE ? <NotYet /> : <ProposalLetter prId={letterMatch[1]} />)
        : csMatch ? (LIVE ? <NotYet /> : <Checksheet kind={csMatch[1]} a1={csMatch[2]} a2={csMatch[3]} />)
        : jcMatch ? (LIVE ? <NotYet /> : <JobCard jcId={jcMatch[1]} />)
        : route === '/planner' ? (LIVE ? <NotYet /> : <Planner />)
        : route === '/roster' ? (LIVE ? <NotYet /> : <DutyRoster />)
        : route === '/log' ? <LogBook />
        /* one ledger still: this reads failure entries out of the logbook,
           it is not a second record — reporting stays in the log book */
        : route === '/failures' ? (LIVE ? <LiveFailures /> : <Failures />)
        : route === '/spares' ? (LIVE ? <NotYet /> : <Spares />)
        : route === '/procurement' ? (LIVE ? <NotYet /> : <Procurement />)
        : route === '/tags' ? <TagSheet />
        : (LIVE ? <LiveDashboard go={go} /> : <Dashboard go={go} />)}

      <footer className="foot">
        {LIVE
          ? <>{ORG} · maintenance records · AMPS, MIT © 2026 <SignatureMark /></>
          : <>Demonstration environment · synthetic data only · MIT © 2026 <SignatureMark /></>}
      </footer>
    </div>
    </>
  )
}
