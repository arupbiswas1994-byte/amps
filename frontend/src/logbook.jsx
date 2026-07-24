// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arup Biswas and AMPS contributors (binidev)
// AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

/* Digital shift logbook — the v0.3 module, live on /api/logbook.

   Replaces the earlier local-state demo page: entries now persist through the
   backend's append-only log (a mistake is corrected by a NEW entry pointing at
   the old one — the bound-paper-logbook discipline, enforced by software).

   API base: same-origin by default; demo hosting builds with VITE_AMPS_API. */
import { useEffect, useRef, useState } from 'react'
import { LIVE, ORG, useMe } from './api.js'

/* Optional time — the plain native picker. Blank = no time. */
function TimeInput({ value, onChange, className = '', label = 'Time (optional)' }) {
  return (
    <input type="time" value={value} title={label} aria-label={label}
           className={className} onChange={(e) => onChange(e.target.value)} />
  )
}

const API = import.meta.env.VITE_AMPS_API ?? ''

const SHIFT_LABEL = { M: 'Morning', E: 'Evening', N: 'Night', G: 'General', R: 'Rest' }
const ENTRY_SHIFTS = ['M', 'E', 'N', 'G']  // R = roster-only, never a log shift
const ENTRY_TYPES = ['maintenance', 'failure', 'rectification', 'general']
const MAINT_SUBTYPES = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly', '5-Yearly', 'Unscheduled']
/* local-calendar ISO — toISOString() is UTC and shifts IST dates a day back */
const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => isoLocal(new Date())
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return isoLocal(d)
}

/* Week/month/year windows, anchored on the newest RECORDED date rather than
   on today — imported history can end months back, and anchoring on the
   calendar would open the book on an empty window. */
const PAGE_SIZE = 100

const PERIODS = [
  ['Week', 'week'], ['Month', 'month'], ['Year', 'year'], ['All time', 'all'],
]
const periodRange = (period, anchorIso) => {
  if (period === 'all' || !anchorIso) return [null, null]
  const a = new Date(anchorIso + 'T00:00:00')
  if (period === 'year') return [`${a.getFullYear()}-01-01`, `${a.getFullYear()}-12-31`]
  if (period === 'month') {
    const m = String(a.getMonth() + 1).padStart(2, '0')
    const last = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate()
    return [`${a.getFullYear()}-${m}-01`, `${a.getFullYear()}-${m}-${last}`]
  }
  // week: Monday..Sunday containing the anchor
  const dow = (a.getDay() + 6) % 7
  const start = addDays(anchorIso, -dow)
  return [start, addDays(start, 6)]
}

const fmtDate = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
/* "HH:MM" from an ISO timestamp, or "" when it's midnight (= no time given) */
const hhmm = (iso) => (iso && iso.slice(11, 16) !== '00:00' ? iso.slice(11, 16) : '')
/* drop the leading "[TYPE]" tag from the body — the type is already a chip */
const bodyText = (t) => (t || '').replace(/^\[[^\]]*\]\s*/, '')

const PencilIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none"
       stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.4 2.3a1.35 1.35 0 0 1 1.9 1.9L5 12.6l-2.6.6.6-2.6 8.4-8.3z" />
  </svg>
)
const ResolveIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none"
       stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6.3" /><path d="M5.3 8.2l1.9 1.9 3.5-4" />
  </svg>
)
const HistoryIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none"
       stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 8a5.5 5.5 0 1 1 1.6 3.9" /><path d="M2.3 12v-2.6h2.6" /><path d="M8 5v3l2 1.2" />
  </svg>
)


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

/* Inline close-out for a failure already on the book. Its own date, time and
   shift — the shift that did the work owns the entry. */
function RectifyForm({ failure, busy, onCancel, onSubmit }) {
  const [date, setDate] = useState(failure.log_date)
  const [time, setTime] = useState('')
  const [shift, setShift] = useState('G')
  const [text, setText] = useState('')
  const [team, setTeam] = useState('')
  return (
    <div className="log-row2">
      <span className="log-row2-tag">Rectification</span>
      <input type="date" value={date} min={failure.log_date}
             onChange={(e) => setDate(e.target.value)} aria-label="Rectified on" />
      <TimeInput value={time} onChange={setTime} className="log-time" label="Rectified at" />
      <select value={shift} onChange={(e) => setShift(e.target.value)} aria-label="Shift">
        {ENTRY_SHIFTS.map((s) => <option key={s} value={s}>{s} — {SHIFT_LABEL[s]}</option>)}
      </select>
      <input value={team} onChange={(e) => setTeam(e.target.value)}
             placeholder="Team…" className="log-team" aria-label="Team" />
      <input value={text} onChange={(e) => setText(e.target.value)}
             placeholder="What was done to rectify it…" />
      <button type="button" className="btn" disabled={busy}
              onClick={() => onSubmit({ date, time, shift, text, team })}>
        {busy ? 'Saving…' : 'Log fix'}
      </button>
      <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
    </div>
  )
}

/* Edit a log entry the append-only way: submitting writes a NEW entry that
   corrects the old one, so nothing is lost. Handles the two jobs Arup asked
   for on the imported open failures too — linking the right equipment (asset
   code) and filling the resolve row (recovery date/time). */
function EditEntryForm({ entry, assets, systems, classSystem, onCancel, onSaved }) {
  const isFail = entry.type === 'failure'
  const [text, setText] = useState(entry.text)
  const [assetCode, setAssetCode] = useState(entry.asset_code || '')
  const [system, setSystem] = useState(entry.system || '')
  const [category, setCategory] = useState(entry.category || '')
  const [team, setTeam] = useState(entry.attended_by || '')
  const [tim, setTim] = useState(hhmm(entry.at))
  const [faultType, setFaultType] = useState(entry.fault_type || '')
  const [endDate, setEndDate] = useState(entry.ended_at ? entry.ended_at.slice(0, 10) : '')
  const [endTim, setEndTim] = useState(hhmm(entry.ended_at))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const textRef = useRef(null)
  useEffect(() => { textRef.current?.focus({ preventScroll: true }) }, [])

  const classesFor = system
    ? [...new Set(assets.filter((a) => a.system === system).map((a) => a.asset_class).filter(Boolean))].sort()
    : [...new Set(assets.map((a) => a.asset_class).filter(Boolean))].sort()

  const save = async () => {
    if (!text.trim() || busy) return
    setBusy(true); setErr('')
    try {
      const res = await fetch(`${API}/api/logbook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          corrects_id: entry.id,
          log_date: entry.log_date, shift: entry.shift, type: entry.type,
          subtype: entry.subtype || null,
          system: system || null, category: category || null,
          asset_code: assetCode.trim() || null,
          time: tim || null, text: text.trim(), attended_by: team.trim() || null,
          fault_type: isFail ? (faultType.trim() || null) : null,
          end_date: isFail ? (endDate || null) : null,
          end_time: isFail ? (endTim || null) : null,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || `HTTP ${res.status}`)
      onSaved()
    } catch (ex) {
      setErr(String(ex.message || ex).replace(/^Error: /, ''))
    } finally { setBusy(false) }
  }

  return (
    <div className="edit-panel">
      <div className="ep-head">
        <span className="ep-title">✎ Editing entry</span>
        <span className="ep-ctx">{fmtDate(entry.log_date)} · {SHIFT_LABEL[entry.shift] || entry.shift} · {entry.type}{entry.subtype ? ` · ${entry.subtype}` : ''}</span>
      </div>

      <div className="fg-set">
        {/* row 1 — system › class › asset id (type & shift are fixed context, shown in the header) */}
        <section className="fg">
          <div className="fg-fields">
            <label>System
              <select value={system} onChange={(e) => { setSystem(e.target.value); setCategory('') }}>
                <option value="">System…</option>
                {systems.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>Class
              <select value={category}
                      onChange={(e) => { const c = e.target.value; setCategory(c); if (c && classSystem[c]) setSystem(classSystem[c]) }}>
                <option value="">Class…</option>
                {classesFor.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>Equipment (Asset ID)
              <input value={assetCode} list="register-codes" placeholder="scan/type code — links the asset"
                     onChange={(e) => {
                       const v = e.target.value; setAssetCode(v)
                       const hit = assets.find((a) => a.code === v)
                       if (hit?.system) setSystem(hit.system)
                       if (hit?.asset_class) setCategory(hit.asset_class)
                     }} />
            </label>
          </div>
        </section>

        {/* row 2 — time › attended by › (failure fault & recovery) › record */}
        <section className="fg">
          <div className="fg-fields">
            <label>Time
              <input type="time" value={tim} onChange={(e) => setTim(e.target.value)} />
            </label>
            <label className={isFail ? '' : 'fg-span-2'}>Team / attended by
              <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="crew that did the work" />
            </label>
            {isFail && <>
              <label>Fault type
                <input value={faultType} onChange={(e) => setFaultType(e.target.value)} placeholder="e.g. DC earth fault" />
              </label>
              <label>Resolved on
                <input type="date" value={endDate} min={entry.log_date}
                       onChange={(e) => setEndDate(e.target.value)} />
              </label>
              <label>Resolved at
                <input type="time" value={endTim} onChange={(e) => setEndTim(e.target.value)} />
              </label>
            </>}
            <label className="fg-span">Entry
              <textarea ref={textRef} value={text} rows={2}
                        onChange={(e) => setText(e.target.value)} placeholder="What was done, readings, event…" />
            </label>
          </div>
        </section>
      </div>

      <div className="ep-actions">
        <button type="button" className="btn" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save edit'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <span className="ep-note">Saving files a correction — the original is kept in this entry's history.</span>
        {err && <span className="import-msg err">{err}</span>}
      </div>
    </div>
  )
}

/* The WhatsApp-style edit trail: original + every correction, oldest first. */
function VersionHistory({ id }) {
  const [vers, setVers] = useState(null)
  useEffect(() => {
    let alive = true
    fetch(`${API}/api/logbook/${id}/versions`).then((r) => (r.ok ? r.json() : []))
      .then((v) => alive && setVers(v)).catch(() => alive && setVers([]))
    return () => { alive = false }
  }, [id])
  if (!vers) return <div className="ver-hist"><span className="dim">Loading history…</span></div>
  return (
    <div className="ver-hist">
      {vers.map((v, i) => (
        <div className="ver-row" key={v.id}>
          <span className="ver-tag">{i === 0 ? 'Original' : `Edit ${i}`}</span>
          <span className="sub dt">{v.log_date}{hhmm(v.at) ? ` · ${fmtTime(v.at)}` : ''}</span>
          <span className="dim">{v.attended_by || v.entered_by}</span>
          <div className="ver-text">{v.text}</div>
        </div>
      ))}
    </div>
  )
}

export default function LogBook({ editId = null, focusDate = null } = {}) {
  const { me, canWrite } = useMe()
  const authOn = me?.auth_enabled
  const [entries, setEntries] = useState([])
  // Initialise straight from a deep link (#/log?d=…&edit=…) so only ONE load
  // fires — the focused day. Setting these in an effect instead raced the
  // default all-dates load, and the bigger response could land last and hide
  // the entry. This component remounts when reached from failures/asset pages.
  const [logDate, setLogDate] = useState(focusDate || today())  // ruler: write + read date
  // Open on a period window, not on today. A quiet day left the page blank,
  // which reads as "the logbook is broken" rather than "nothing happened
  // today". The ruler still drives both reading and writing once a day is
  // picked; clearing it returns to the period window.
  const [allDates, setAllDates] = useState(!focusDate)  // deep link opens its day, not the window
  const [period, setPeriod] = useState('month')
  const [anchor, setAnchor] = useState(null)   // newest recorded date
  // A year of this book is thousands of entries — page it rather than pull a
  // truncated slice and imply it is the whole thing.
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [fCat, setFCat] = useState('')             // '' = all categories (classes)
  const [fType, setFType] = useState('')           // '' = all types
  const [search, setSearch] = useState('')         // free-text box value
  const [qParam, setQParam] = useState('')         // debounced -> ?q= server search
  const [impBusy, setImpBusy] = useState(false)
  const [impResult, setImpResult] = useState(null)
  const fileRef = useRef(null)
  const toolbarRef = useRef(null)
  const [apiOk, setApiOk] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // add-entry form
  const [text, setText] = useState('')
  const [shift, setShift] = useState('M')
  const [type, setType] = useState('general')
  const [subtype, setSubtype] = useState('Monthly')
  const [system, setSystem] = useState('')         // coarse rollup (short list)
  const [category, setCategory] = useState('')     // asset class under the system
  const [tim, setTim] = useState('')               // optional HH:MM
  const [faultType, setFaultType] = useState('')   // failures: fault class
  const [team, setTeam] = useState('')             // crew that did the work
  // A failure is logged either still-open or already-rectified. Rectified
  // expands a second row that becomes its own log entry — the fix keeps its
  // own date, time and shift, because a night breakdown fixed next morning
  // belongs to the morning shift that fixed it, not to the night that broke.
  // Defaults to OPEN on purpose: a form that assumes the fix has happened
  // invites logging work that hasn't.
  const [rectified, setRectified] = useState(false)
  const [rDate, setRDate] = useState('')
  const [rTim, setRTim] = useState('')
  const [rShift, setRShift] = useState('G')
  const [rText, setRText] = useState('')
  const [rTeam, setRTeam] = useState('')
  // closing a failure that was logged open earlier — the two-row form can't
  // reach it, that entry already exists
  const [rectifying, setRectifying] = useState(null)
  const [editingId, setEditingId] = useState(editId ? Number(editId) : null)   // entry being edited
  const [historyFor, setHistoryFor] = useState(null) // entry whose trail is open
  const [assetCode, setAssetCode] = useState('')   // cross-reference to the register
  const [author, setAuthor] = useState('demo.visitor')
  const [assets, setAssets] = useState([])         // register rows for the datalist

  useEffect(() => {
    fetch(`${API}/api/assets`).then((r) => (r.ok ? r.json() : []))
      .then(setAssets).catch(() => {})
  }, [])
  // distinct asset classes, sorted — the category dropdown's options
  const classes = [...new Set(assets.map((a) => a.asset_class).filter(Boolean))].sort()
  // the systems (short) and, per system, the classes under it — so the class
  // picker only ever shows what belongs to the chosen system
  const systems = [...new Set(assets.map((a) => a.system).filter(Boolean))].sort()
  const classesForSystem = system
    ? [...new Set(assets.filter((a) => a.system === system).map((a) => a.asset_class).filter(Boolean))].sort()
    : classes
  // reverse link: each class's most common system, so picking a class fills
  // the system too (a class almost always sits under one system)
  const classSystem = {}
  {
    const tally = {}
    assets.forEach((a) => {
      if (a.asset_class && a.system) {
        (tally[a.asset_class] ??= {})[a.system] = (tally[a.asset_class][a.system] || 0) + 1
      }
    })
    Object.entries(tally).forEach(([c, sys]) => {
      classSystem[c] = Object.entries(sys).sort((x, y) => y[1] - x[1])[0][0]
    })
  }

  // anchor the period windows on the newest date the book actually holds
  useEffect(() => {
    fetch(`${API}/api/logbook/bounds`).then((r) => (r.ok ? r.json() : null))
      .then((b) => b?.last && setAnchor(b.last)).catch(() => {})
  }, [])

  const [from, to] = periodRange(period, anchor)

  const load = async () => {
    try {
      const q = new URLSearchParams()
      // a text search spans the whole book, so it ignores the single-day scope
      const searching = qParam.trim().length > 0
      if (!allDates && !searching) q.set('log_date', logDate)
      if (fCat) q.set('category', fCat)
      if (fType) q.set('entry_type', fType)
      if (searching) q.set('q', qParam.trim())
      if (allDates || searching) {
        if (from) q.set('date_from', from)
        if (to) q.set('date_to', to)
      }
      q.set('limit', String(PAGE_SIZE))
      q.set('offset', String(page * PAGE_SIZE))
      const res = await fetch(`${API}/api/logbook?${q}`)
      if (!res.ok) throw new Error(res.status)
      const n = Number(res.headers.get('X-Total-Count'))
      setTotal(Number.isFinite(n) ? n : 0)
      setEntries(await res.json())
      setApiOk(true)
    } catch {
      setApiOk(false)
    }
  }

  useEffect(() => { load() }, [logDate, allDates, fCat, fType, qParam, from, to, page])  // eslint-disable-line react-hooks/exhaustive-deps
  // any change of what we are looking at starts again at the first page
  useEffect(() => { setPage(0) }, [logDate, allDates, fCat, fType, qParam, from, to])
  // debounce the search box so we don't hit the API on every keystroke
  useEffect(() => { const t = setTimeout(() => setQParam(search), 300); return () => clearTimeout(t) }, [search])
  // freeze the toolbar: measure the sticky topbar so it parks just beneath it
  useEffect(() => {
    const setVars = () => {
      const tb = document.querySelector('.topbar')
      if (tb) document.documentElement.style.setProperty('--topbar-h', `${tb.offsetHeight}px`)
    }
    setVars(); window.addEventListener('resize', setVars)
    return () => window.removeEventListener('resize', setVars)
  })

  // download the entries currently in view as CSV
  const exportCsv = () => {
    const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const head = ['date', 'shift', 'time', 'type', 'subtype', 'system', 'class', 'asset', 'entry', 'attended_by']
    const body = entries.map((e) => [
      e.log_date, e.shift, hhmm(e.at), e.type, e.subtype || '', e.system || '', e.category || '',
      e.asset_code || '', bodyText(e.text), e.attended_by || e.entered_by || '',
    ].map(cell).join(','))
    const csv = [head.join(','), ...body].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `amps-logbook-${allDates ? 'period' : logDate}-${today()}.csv`
    a.click(); URL.revokeObjectURL(url)
  }
  // bulk-import scattered sheet history (the unified logbook CSV)
  const onImportFile = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setImpBusy(true); setImpResult(null)
    try {
      const r = await fetch(`${API}/api/logbook/import`, {
        method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: await file.text(),
      })
      const body = await r.json().catch(() => null)
      setImpResult(r.ok ? body : { error: body?.detail || `HTTP ${r.status}` })
      if (r.ok) load()
    } catch (err) {
      setImpResult({ error: String(err) })
    }
    setImpBusy(false)
  }

  // deep-link (#/log?d=…&edit=…): a failure or asset-page row jumps here to
  // edit an entry — open its day and put it straight into edit mode
  useEffect(() => {
    if (!editId) return
    if (focusDate) { setLogDate(focusDate); setAllDates(false) }
    setEditingId(Number(editId))
    setHistoryFor(null)
  }, [editId, focusDate])

  // whenever an entry enters edit mode — a deep-link from another page, or a
  // click here — bring it into the middle of the viewport so the form is seen.
  // Keyed on entries too: on a deep-link the row only exists once the day loads.
  useEffect(() => {
    if (!editingId) return
    const el = document.getElementById(`le-${editingId}`)
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }, [editingId, entries])

  // close the edit form and, if we arrived via a deep-link (?edit=…), strip
  // that param so a page refresh doesn't reopen the form on the same row.
  const closeEdit = () => {
    setEditingId(null)
    if (editId) location.hash = `/log${focusDate ? `?d=${focusDate}` : ''}`
  }

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
          system: system || null,
          category: category || null,
          time: tim || null,
          fault_type: type === 'failure' ? (faultType.trim() || null) : null,
          asset_code: assetCode.trim() || null,
          text: text.trim(), entered_by: author.trim() || 'demo.visitor',
          attended_by: team.trim() || null,
          // one submit, two immutable entries — the backend commits them together
          rectification: type === 'failure' && rectified ? {
            log_date: rDate || logDate,
            time: rTim || null,
            shift: rShift,
            type: 'rectification',
            system: system || null,
            category: category || null,
            asset_code: assetCode.trim() || null,
            text: (rText.trim() || 'Rectified'),
            entered_by: author.trim() || 'demo.visitor',
            attended_by: rTeam.trim() || team.trim() || null,
          } : null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `HTTP ${res.status}`)
      }
      setText(''); setAssetCode(''); setTim(''); setFaultType(''); setSystem('')
      setRectified(false); setRDate(''); setRTim(''); setRText(''); setRTeam('')
      setTeam('')
      setAllDates(false)  // show the day just written to
      await load()
    } catch (ex) {
      setErr(String(ex.message || ex).replace(/^Error: /, ''))
    } finally {
      setBusy(false)
    }
  }

  /* Close a failure that was logged open. A separate entry, never an edit —
     the failure keeps saying what it said, the fix says what it did. */
  const submitRectify = async (failure, form) => {
    setBusy(true); setErr('')
    try {
      const res = await fetch(`${API}/api/logbook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_date: form.date, time: form.time || null, shift: form.shift,
          type: 'rectification', rectifies_id: failure.id,
          category: failure.category || null,
          asset_code: failure.asset_code || null,
          text: form.text.trim() || 'Rectified',
          entered_by: author.trim() || 'demo.visitor',
          attended_by: form.team.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `HTTP ${res.status}`)
      }
      setRectifying(null)
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
        <form className="entry-form card" onSubmit={add}>
          <div className="ef-head">
            <span className="ep-title">＋ New log entry</span>
            <span className="ep-ctx">{fmtDate(logDate)}</span>
          </div>

          <div className="fg-set">
            {/* row 1 — shift › type › (frequency|state) › system › class › asset id */}
            <section className="fg">
              <div className="fg-fields">
                {/* maintenance is always a night-shift job — lock the shift to N */}
                <label>Shift
                  <select value={type === 'maintenance' ? 'N' : shift} disabled={type === 'maintenance'}
                          onChange={(e) => setShift(e.target.value)}
                          title={type === 'maintenance' ? 'Maintenance runs on the night shift' : 'Shift'}>
                    {ENTRY_SHIFTS.map((s) => <option key={s} value={s}>{s} — {SHIFT_LABEL[s]}</option>)}
                  </select>
                </label>
                <label>Type
                  <select value={type}
                          onChange={(e) => { setType(e.target.value); if (e.target.value === 'maintenance') setShift('N') }}>
                    {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </label>
                {type === 'maintenance' && (
                  <label>Frequency
                    <select value={subtype} onChange={(e) => setSubtype(e.target.value)}>
                      {MAINT_SUBTYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                )}
                {type === 'failure' && (
                  <label>State
                    <select value={rectified ? 'rectified' : 'open'}
                            onChange={(e) => { const on = e.target.value === 'rectified'; setRectified(on); if (on && !rDate) setRDate(logDate) }}>
                      <option value="open">Still open</option>
                      <option value="rectified">Rectified</option>
                    </select>
                  </label>
                )}
                {/* System (short list), then the class under it, then the asset code */}
                <label>System
                  <select value={system} onChange={(e) => { setSystem(e.target.value); setCategory('') }}>
                    <option value="">System…</option>
                    {systems.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label>Class {type !== 'failure' && <span className="ef-opt">(optional)</span>}
                  <select value={category} disabled={!system && classesForSystem.length === 0}
                          onChange={(e) => { const c = e.target.value; setCategory(c); if (c && classSystem[c]) setSystem(classSystem[c]) }}>
                    <option value="">Class…</option>
                    {classesForSystem.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label>Equipment (Asset ID)
                  <input value={assetCode} list="register-codes" placeholder="scan/type code…"
                         onChange={(e) => {
                           const v = e.target.value; setAssetCode(v)
                           const hit = assets.find((a) => a.code === v)
                           if (hit?.system) setSystem(hit.system)
                           if (hit?.asset_class) setCategory(hit.asset_class)
                         }} />
                </label>
                <datalist id="register-codes">
                  {assets.map((a) => <option key={a.code} value={a.code}>{`${a.code} — ${a.name} · ${a.location}`}</option>)}
                </datalist>
              </div>
            </section>

            {/* row 2 — time › attended by › (entered by) › (fault type) › record */}
            <section className="fg">
              <div className="fg-fields">
                <label>Time <span className="ef-opt">(optional)</span>
                  <TimeInput value={tim} onChange={setTim} />
                </label>
                <label className={authOn && type !== 'failure' ? 'fg-span-2' : ''}>Team / attended by
                  <input value={team} onChange={(e) => setTeam(e.target.value)} maxLength={200}
                         placeholder="crew that did the work" />
                </label>
                {!authOn && (
                  <label>Entered by
                    <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={40} placeholder="you" />
                  </label>
                )}
                {type === 'failure' && (
                  <label>Fault type
                    <input value={faultType} onChange={(e) => setFaultType(e.target.value)}
                           placeholder="e.g. DC earth fault" maxLength={120} />
                  </label>
                )}
                <label className="fg-span">Entry
                  <textarea value={text} rows={2} onChange={(e) => setText(e.target.value)}
                            placeholder={`Log entry for ${fmtDate(logDate)} — work done, readings, events…`} />
                </label>
              </div>
            </section>
          </div>

          {/* rectification, filed as its own entry — shown when a failure is logged already-fixed */}
          {type === 'failure' && rectified && (
            <div className="ef-rect">
              <span className="ef-sublbl">Rectification — filed as a second entry</span>
              <div className="fg-fields">
                <label>Rectified on
                  <input type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} />
                </label>
                <label>Rectified at
                  <TimeInput value={rTim} onChange={setRTim} label="Rectified at" />
                </label>
                <label>Shift
                  <select value={rShift} onChange={(e) => setRShift(e.target.value)}>
                    {ENTRY_SHIFTS.map((s) => <option key={s} value={s}>{s} — {SHIFT_LABEL[s]}</option>)}
                  </select>
                </label>
                <label className="fg-span-2">Team
                  <input value={rTeam} onChange={(e) => setRTeam(e.target.value)} placeholder="crew" />
                </label>
                <label className="fg-span">What was done
                  <input value={rText} onChange={(e) => setRText(e.target.value)}
                         placeholder="what was done to rectify it…" />
                </label>
              </div>
            </div>
          )}

          <div className="ef-actions">
            <button className="btn" type="submit" disabled={busy || apiOk === false || !text.trim()}>
              {busy ? 'Adding…' : rectified && type === 'failure' ? 'Add both entries' : 'Add entry'}
            </button>
            {err && <span className="import-msg err">{err}</span>}
          </div>
        </form>
      ) : (
        <p className="dim">Viewing only — sign in with your line account to add entries.</p>
      )}

      {/* unified toolbar — same language as the asset register: search · filters
          · count · actions, frozen under the topbar as the log scrolls */}
      <div className="asset-toolbar" ref={toolbarRef}>
        <input className="asset-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
               placeholder="Search the log — text, asset, crew, fault…" aria-label="Search the log" />
        <div className="asset-filter" role="tablist" aria-label="Date scope">
          <button type="button" className={`btn preset${allDates ? ' active' : ''}`}
                  onClick={() => setAllDates(true)}>All dates</button>
        </div>
        <select value={fType} onChange={(e) => setFType(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
        </select>
        <select value={fCat} onChange={(e) => setFCat(e.target.value)} aria-label="Filter by class">
          <option value="">All classes</option>
          {classes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={period} onChange={(e) => { setPeriod(e.target.value); setAllDates(true) }} aria-label="Period">
          {PERIODS.map(([lbl, v]) => <option key={v} value={v}>{lbl}</option>)}
        </select>
        {(search || fCat || fType || !allDates) && (
          <button type="button" className="btn ghost sm" onClick={() => {
            setSearch(''); setFCat(''); setFType(''); setAllDates(true)
          }}>Clear</button>
        )}
        <span className="asset-count">
          {qParam.trim() || allDates ? `${total.toLocaleString()} entr${total === 1 ? 'y' : 'ies'}` : fmtDate(logDate)}
        </span>
        <div className="asset-actions">
          <button type="button" className="icon-btn" title="Download the entries in view (CSV)"
                  aria-label="Download entries" onClick={exportCsv} disabled={!entries.length}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2.4v7.2M4.8 6.6 8 9.8l3.2-3.2M3 12.8h10" /></svg>
          </button>
          <button type="button" className="icon-btn" title="Print the log in view"
                  aria-label="Print log" onClick={() => window.print()}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 6V2.5h7V6M4.5 12H3.2V6.4h9.6V12H11.5M4.5 9.6h7V13.5h-7z" /></svg>
          </button>
          {canWrite && (
            <button type="button" className={`icon-btn${impBusy ? ' disabled' : ''}`} title="Import history CSV"
                    aria-label="Import history" onClick={() => fileRef.current?.click()} disabled={impBusy}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 9.8V2.6M4.8 5.8 8 2.6l3.2 3.2M3 12.8h10" /></svg>
            </button>
          )}
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onImportFile} />
        </div>
      </div>
      <div className="print-caption">
        AMPS · {ORG} — shift logbook · {qParam.trim() ? `“${qParam.trim()}”` : allDates && from ? `${fmtDate(from)} — ${fmtDate(to)}` : fmtDate(logDate)}
        {fType ? ` · ${fType}` : ''}{fCat ? ` · ${fCat}` : ''} · {total.toLocaleString()} entries · {today()}
      </div>
      {(impBusy || impResult) && (
        <div className="import-status">
          {impBusy ? <span className="dim">Importing…</span>
            : impResult.error ? <span className="import-msg err">{impResult.error}</span>
            : <span className="import-msg">
                {impResult.log_entries} log · {impResult.failures} failures · {impResult.skipped} skipped · {impResult.failed} failed
                {impResult.errors?.length ? ` — ${impResult.errors[0]}` : ''}
                {' '}<a className="mini-btn" href={`${API}/api/logbook/import/sample`} download>sample CSV</a>
              </span>}
        </div>
      )}
      {allDates && from && !qParam.trim() && <p className="dim log-range">{fmtDate(from)} — {fmtDate(to)}</p>}

      {Object.entries(byDay).map(([day, list]) => (
        <div key={day} className="log-day">
          <h3 className="log-date dt">{fmtDate(day)}</h3>
          <div className="card">
            {/* All four shifts always appear, so an empty shift reads as
                "nothing was logged" rather than as missing data. Empty ones
                collapse to one line; the shift being written to is marked. */}
            {ENTRY_SHIFTS.map((sh) => {
              const rows = list.filter((en) => en.shift === sh)
              const isSel = sh === shift
              if (!rows.length) {
                return (
                  <div key={sh} className={`log-shift empty${isSel ? ' sel' : ''}`}>
                    <span className="log-shift-h">{sh} — {SHIFT_LABEL[sh]}</span>
                    <span className="dim">no entries</span>
                  </div>
                )
              }
              return (
                <div key={sh} className={`log-shift${isSel ? ' sel' : ''}`}>
                  <div className="log-shift-h">
                    {sh} — {SHIFT_LABEL[sh]} <span className="dim">· {rows.length}</span>
                  </div>
                  {rows.map((en) => {
                    const openFail = en.type === 'failure' && !en.ended_at
                    const editing = editingId === en.id
                    return (
                    <div className={`log-entry${editing ? ' editing' : ''}`} id={`le-${en.id}`} key={en.id}>
                      <div className="le-row">
                        <div className="le-main">
                          <div className="log-meta">
                            {!en.at.includes('T00:00:00') && <span className="dt le-time">{fmtTime(en.at)}</span>}
                            {en.system && <span className="chip sys"><span className="dot" />{en.system}</span>}
                            {en.category && <span className="chip grp"><span className="dot" />{en.category}</span>}
                            <span className={`chip ${['defect', 'failure'].includes(en.type) ? 'd-overdue' : ''}`}>
                              <span className="dot" />{en.type}{en.subtype ? ` · ${en.subtype}` : ''}
                            </span>
                            {en.asset_code
                              ? <a className="code" href={`#/asset/${en.asset_code}`}>{en.asset_code}</a>
                              : en.type === 'failure' && <span className="chip d-overdue"><span className="dot" />unlinked</span>}
                            {en.type === 'failure' && (en.ended_at
                              ? <span className="chip w-done"><span className="dot" />resolved{en.down_hours != null ? ` · ${en.down_hours}h` : ''}</span>
                              : <span className="chip d-overdue"><span className="dot" />open</span>)}
                            {en.rectifies_id && <span className="dim le-ref">rectifies #{en.rectifies_id}</span>}
                            {en.corrects_id && (
                              <button type="button" className="edited-btn"
                                      onClick={() => setHistoryFor(historyFor === en.id ? null : en.id)}
                                      title="Show edit history"><HistoryIcon /> edited</button>
                            )}
                          </div>
                          <div className="log-text">{bodyText(en.text)}</div>
                          <div className="le-by">
                            <b>{en.attended_by || en.entered_by}</b>
                            {en.attended_by && en.attended_by !== en.entered_by && <> · rec. {en.entered_by}</>}
                          </div>
                        </div>
                        {canWrite && editingId !== en.id && (
                          <div className="le-actions">
                            <button type="button" className="icon-btn" title="Edit entry" aria-label="Edit entry"
                                    onClick={() => { setEditingId(en.id); setRectifying(null) }}><PencilIcon /></button>
                            {openFail && rectifying !== en.id && (
                              <button type="button" className="icon-btn resolve" title="Rectify — log the fix" aria-label="Rectify"
                                      onClick={() => { setRectifying(en.id); setEditingId(null) }}><ResolveIcon /></button>
                            )}
                          </div>
                        )}
                      </div>
                      {historyFor === en.id && <VersionHistory id={en.id} />}
                      {canWrite && editingId === en.id && (
                        <EditEntryForm entry={en} assets={assets} systems={systems} classSystem={classSystem}
                                       onCancel={closeEdit}
                                       onSaved={() => { closeEdit(); load() }} />
                      )}
                      {canWrite && rectifying === en.id && openFail && (
                        <RectifyForm failure={en} busy={busy}
                                     onCancel={() => setRectifying(null)}
                                     onSubmit={(f) => submitRectify(en, f)} />
                      )}
                    </div>
                  )})}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      {apiOk && !entries.length && <p className="dim">No entries for this filter.</p>}

      {total > PAGE_SIZE && (
        <div className="log-pager">
          <button type="button" className="btn ghost" disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}>← Newer</button>
          <span className="dim">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <button type="button" className="btn ghost"
                  disabled={(page + 1) * PAGE_SIZE >= total}
                  onClick={() => setPage((p) => p + 1)}>Older →</button>
        </div>
      )}

      {/* The demo build warns the visitor off logging anything real. On a live
          deployment that sentence sits under thousands of genuine records and
          tells the section not to use its own logbook — say the opposite. */}
      <p className="roadmap">
        {LIVE
          ? 'Entries are permanent and append-only: nothing is edited or deleted. A mistake is corrected by a new entry, and every entry keeps the shift, date and team that made it.'
          : 'Entries persist in the demo database (reseeded on each demo restart). Synthetic data only — do not log real operational information here.'}
      </p>
    </>
  )
}
