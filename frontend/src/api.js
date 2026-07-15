/* Live data layer.

   Built with VITE_AMPS_DATA=live, the asset-driven screens read the running
   backend instead of the bundled demo dataset, and modules whose backend
   hasn't landed yet leave the navigation — a deployment only shows what is
   real. Default build (demo) keeps the full synthetic walkthrough.

   VITE_AMPS_ORG names the organisation on headers, tags and printouts. */
import { useEffect, useState } from 'react'

export const LIVE = import.meta.env.VITE_AMPS_DATA === 'live'
export const ORG = import.meta.env.VITE_AMPS_ORG || 'Demo Metro Line'

const API = import.meta.env.VITE_AMPS_API ?? '' // same-origin by default

async function getJSON(path) {
  const r = await fetch(`${API}${path}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/* API asset → the shape the screens already use for demo data. */
const toView = (a) => ({
  code: a.code,
  name: a.name,
  cls: a.asset_class,
  sys: a.system || null,
  location: a.location,
  line: a.line || null,
  makeModel: a.make_model || null,
  status: a.status,
  criticality: a.criticality,
})

/** Session identity. Reads are open to everyone (the QR-scan surface);
    `canWrite` is true when auth is off (demo/dev) or a real user is signed in.
    Anonymous visitors on an authenticated deployment browse as 'viewer'. */
export function useMe() {
  const [state, set] = useState({ me: null, canWrite: !LIVE, loading: LIVE })
  useEffect(() => {
    if (!LIVE) return undefined
    let alive = true
    fetch(`${API}/api/auth/me`)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then((me) => alive && set({
        me,
        canWrite: !me.auth_enabled || me.username !== 'viewer',
        loading: false,
      }))
      .catch(() => alive && set({ me: null, canWrite: false, loading: false }))
    return () => { alive = false }
  }, [])
  return state
}

export async function apiLogin(username, password) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail || 'login failed')
  return r.json()
}

export async function apiLogout() {
  await fetch(`${API}/api/auth/logout`, { method: 'POST' }).catch(() => {})
  location.reload()
}

/** Register + dashboard source: every asset, plus PM items due within 60 days. */
export function useLiveAssets() {
  const [state, set] = useState({ assets: [], due: [], loading: LIVE, error: null })
  useEffect(() => {
    if (!LIVE) return undefined
    let alive = true
    Promise.all([
      getJSON('/api/assets'),
      getJSON('/api/maintenance/due?horizon_days=60').catch(() => []),
    ])
      .then(([assets, due]) => alive && set({ assets: assets.map(toView), due, loading: false, error: null }))
      .catch((e) => alive && set({ assets: [], due: [], loading: false, error: String(e) }))
    return () => { alive = false }
  }, [])
  return state
}

/** Asset page source: the record plus its work-order and failure history
    (the QR scan target — everything ever recorded against the asset). */
export function useLiveAsset(code) {
  const [state, set] = useState({ asset: null, history: [], failures: [], loading: true, error: null })
  useEffect(() => {
    let alive = true
    set({ asset: null, history: [], failures: [], loading: true, error: null })
    Promise.all([
      getJSON(`/api/assets/${encodeURIComponent(code)}`),
      getJSON(`/api/assets/${encodeURIComponent(code)}/history`).catch(() => []),
      getJSON(`/api/failures?asset_code=${encodeURIComponent(code)}`).catch(() => []),
    ])
      .then(([a, history, failures]) => alive && set({ asset: toView(a), history, failures, loading: false, error: null }))
      .catch((e) => alive && set({ asset: null, history: [], failures: [], loading: false, error: String(e) }))
    return () => { alive = false }
  }, [code])
  return state
}
