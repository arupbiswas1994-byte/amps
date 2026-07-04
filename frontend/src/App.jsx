import { useEffect, useState } from 'react'
import { ASSETS, PM_SCHEDULES, WORK_ORDERS, kpis, fmtDate, dueState } from './data.js'
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

const WoChip = ({ status }) => (
  <span className={`chip w-${status}`}><span className="dot" />{status[0].toUpperCase() + status.slice(1)}</span>
)

/* ---------- dashboard ---------- */

function Dashboard({ go }) {
  const k = kpis()
  const nextPM = (code) => {
    const due = PM_SCHEDULES.filter((p) => p.asset === code).sort((a, b) => a.nextDue - b.nextDue)[0]
    return due ?? null
  }
  return (
    <>
      <div className="kpis">
        <div className="tile"><div className="v">{k.assets}</div><div className="k">Assets registered</div></div>
        <div className="tile"><div className="v">{k.compliance}%</div><div className="k">PM compliance</div></div>
        <div className={k.dueSoon ? 'tile warn' : 'tile'}><div className="v">{k.dueSoon}</div><div className="k">PM due within 7 days</div></div>
        <div className={k.overdue ? 'tile alert' : 'tile'}><div className="v">{k.overdue}</div><div className="k">PM overdue</div></div>
        <div className="tile"><div className="v">{k.openWO}</div><div className="k">Open work orders</div></div>
      </div>

      <h2>Asset register</h2>
      <div className="card tbl-wrap">
        <table>
          <thead>
            <tr><th>Code</th><th>Asset</th><th>Class</th><th>Location</th><th>Status</th><th>Next PM</th><th>PM state</th></tr>
          </thead>
          <tbody>
            {ASSETS.map((a) => {
              const pm = nextPM(a.code)
              return (
                <tr key={a.code} tabIndex={0} onClick={() => go(`/asset/${a.code}`)}
                    onKeyDown={(e) => e.key === 'Enter' && go(`/asset/${a.code}`)}>
                  <td className="code">{a.code}</td>
                  <td>{a.name}</td>
                  <td className="dim">{a.cls}</td>
                  <td className="dim">{a.location}</td>
                  <td><StatusChip status={a.status} /></td>
                  <td className="dim dt">{pm ? fmtDate(pm.nextDue) : '—'}</td>
                  <td>{pm ? <DueChip nextDue={pm.nextDue} /> : <span className="dim">—</span>}</td>
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

function AssetDetail({ code, go }) {
  const a = ASSETS.find((x) => x.code === code)
  if (!a) return <p>Asset not found. <a className="crumb" href="#/">← Back to register</a></p>
  const pms = PM_SCHEDULES.filter((p) => p.asset === code)
  const wos = WORK_ORDERS.filter((w) => w.asset === code)
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

          <div className="sect">
            <h3>Preventive maintenance</h3>
            {pms.length === 0 ? <p className="dim">No PM schedules.</p> : (
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Task</th><th>Frequency</th><th>Last done</th><th>Next due</th><th>State</th></tr></thead>
                  <tbody>
                    {pms.map((p) => (
                      <tr key={p.task} style={{ cursor: 'default' }}>
                        <td>{p.task}</td>
                        <td className="dim">{p.frequency}</td>
                        <td className="dim dt">{fmtDate(p.lastDone)}</td>
                        <td className="dt">{fmtDate(p.nextDue)}</td>
                        <td><DueChip nextDue={p.nextDue} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="sect">
            <h3>Work-order history</h3>
            {wos.length === 0 ? <p className="dim">No work orders.</p> : wos.map((w) => (
              <div className="wo" key={w.id}>
                <div className="row1">
                  <span className="code">{w.id}</span>
                  <span className="t">{w.title}</span>
                  <WoChip status={w.status} />
                </div>
                {w.findings && <div className="findings">{w.findings}</div>}
                <div className="sub">
                  {w.type} · opened {fmtDate(w.openedAt)}
                  {w.closedAt && <> · closed {fmtDate(w.closedAt)}</>}
                  {w.assignedTo && <> · {w.assignedTo}</>}
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

export default function App() {
  const [route, setRoute] = useState(routeFromHash)
  useEffect(() => {
    const onHash = () => { setRoute(routeFromHash()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = (r) => { location.hash = r }

  const assetMatch = route.match(/^\/asset\/(.+)$/)

  return (
    <div className="shell">
      <header className="topbar">
        <a href="#/" className="brand"><span className="bolt">⚡</span>AMPS
          <span className="brand-sub">Asset Maintenance &amp; Preventive Scheduling</span>
        </a>
        <nav className="nav">
          <a href="#/" className={route === '/' ? 'active' : ''}>Register</a>
          <a href="#/tags" className={route === '/tags' ? 'active' : ''}>QR tags</a>
        </nav>
      </header>

      {assetMatch ? <AssetDetail code={assetMatch[1]} go={go} />
        : route === '/tags' ? <TagSheet />
        : <Dashboard go={go} />}

      <footer className="foot">
        Demonstration environment · synthetic data only · MIT © 2026 Arup Biswas
      </footer>
    </div>
  )
}
