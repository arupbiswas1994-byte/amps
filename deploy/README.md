# AMPS — Kubernetes (k3s) demo deployment

Deployment assets for running the AMPS public demo on a k3s cluster.
Contributed by the **binidev team**, which operates the public demo hosting;
AMPS itself is authored and maintained by Arup Biswas (MIT).

> **Synthetic data only.** The demo runs the fictional dataset from
> `backend/seed.py` — no real organizational assets, locations or records,
> ever.

## Quickstart — single machine (no cluster)

For an office laptop or workstation, `compose.yaml` runs the whole stack —
Postgres (persistent volume), backend, and the UI with same-origin `/api`
and `/docs` — in one command:

```bash
docker compose -f deploy/compose.yaml up -d --build
# → http://localhost:8080
```

The database starts **empty and persistent** (real use). To load the
synthetic demo dataset instead:

```bash
docker compose -f deploy/compose.yaml run --rm backend python seed.py
```

Seeding is idempotent — it refuses to touch a database that already has data.

## Office topology — dev laptop & prod desktop

The intended working setup on an office network (no public IP, no cluster):

### Prod desktop — the LAN server

```bash
git clone https://github.com/arupbiswas1994-byte/amps.git && cd amps
docker compose -f deploy/compose.yaml up -d --build
```

Colleagues reach the app at `http://<desktop-LAN-IP>:8080` — UI, `/api` and
`/docs` all same-origin. Data lives in the Postgres volume: **persistent,
starts empty** (seed only if you want the synthetic dataset).

Update ritual (data survives — the volume is untouched):

```bash
git pull && docker compose -f deploy/compose.yaml up -d --build
```

Nightly backup (cron/Task Scheduler one-liner):

```bash
docker compose -f deploy/compose.yaml exec -T db pg_dump -U amps amps | gzip > amps-$(date +%a).sql.gz
```

No public hosting (Cloudflare Pages etc.) is needed or wanted for this:
the office instance is LAN-only by design, and the frontend is static files
already served by the compose nginx. Public hosting only applies to the
concept demo, which has its own deployment (this directory's `k8s/`).

### Dev laptop

```bash
cd backend  && pip install -r requirements.txt && uvicorn app.main:app --reload
cd frontend && npm install && npm run dev        # UI on :5173
```

The Vite dev server proxies `/api` and `/docs` to `localhost:8000`, so both
halves run side by side with hot reload and zero config — the backend falls
back to a local SQLite file (`python seed.py` for demo data). To develop the
UI against the prod desktop's data instead:

```bash
AMPS_DEV_API=http://<desktop-LAN-IP>:8080 npm run dev
```

## Layout

```
deploy/
├── compose.yaml              # single-machine stack (Postgres + backend + UI)
├── docker/
│   ├── backend.Dockerfile    # FastAPI + uvicorn on :8000
│   ├── frontend.Dockerfile   # Vite build → nginx on :80
│   ├── nginx.conf
│   └── nginx.compose.conf    # compose variant — nginx proxies /api,/docs
└── k8s/
    ├── kustomization.yaml    # apply with: kubectl apply -k deploy/k8s
    ├── namespace.yaml        # amps-demo
    ├── postgres.yaml         # StatefulSet + PVC (see v0.1 notes below)
    ├── backend.yaml          # Deployment + Service :8000
    ├── frontend.yaml         # Deployment + Service :80
    ├── ingress.yaml          # / → frontend · /api,/docs,/openapi.json → backend
    ├── seed-job.yaml         # one-shot synthetic-data seed
    └── secrets.template.yaml # documented template — never commit real values
```

## Install

1. **Build and push the images** (from the repository root):

   ```bash
   REG=ghcr.io/biniyognet   # or your registry
   docker build -f deploy/docker/backend.Dockerfile  -t $REG/amps-backend:demo .
   docker build -f deploy/docker/frontend.Dockerfile -t $REG/amps-frontend:demo .
   docker push $REG/amps-backend:demo && docker push $REG/amps-frontend:demo
   ```

   Registry/tag are overridable in `k8s/kustomization.yaml` (`images:`).

2. **Check the demo domain** in `k8s/ingress.yaml` (set to
   `amps.binihost.com` for the public demo — change for your own cluster)
   and adjust `ingressClassName` / TLS as needed
   (k3s default is Traefik; cert-manager annotation is stubbed in the file).

3. **Create the secrets** — follow the commands in
   `k8s/secrets.template.yaml` (or copy it to `secrets.yaml`, which is
   gitignored, and enable it in `kustomization.yaml`).

4. **Apply:**

   ```bash
   kubectl apply -k deploy/k8s
   kubectl -n amps-demo get pods -w
   ```

5. **Verify:** `https://amps.binihost.com/` (UI) · `/docs` (Swagger) ·
   `/api/assets` (API) · `/api/qr/TRF-0001.png` (QR generation).

## v0.1 notes (read before debugging)

| Area | State in v0.1 |
|---|---|
| Backend ↔ DB | **Not wired yet.** The assets API is an in-memory skeleton; `DATABASE_URL` is provisioned but unread until the SQLAlchemy layer lands (v0.2). |
| `seed.py` | Defines + prints the synthetic dataset; real DB seeding arrives with v0.2. The Job is pre-wired for it. |
| Postgres | Provisioned ahead of v0.2 so the environment is complete when it lands. CNPG clusters can substitute a `Cluster` resource + rw Service for `postgres.yaml`. |
| Frontend | Repo ships only `src/App.jsx`; `frontend.Dockerfile` shims the missing Vite entry files (`index.html`, `src/main.jsx`) at build time. Remove the shim when the real UI lands (v0.3). |

## Ops notes

- Everything lives in namespace `amps-demo`; `kubectl delete ns amps-demo`
  removes the demo cleanly (PVC included — demo data is disposable).
- Single replica everywhere: this is a concept demo, not HA hosting.
- Resource requests are deliberately tiny (demo idles near zero); limits cap
  the blast radius on shared clusters.
