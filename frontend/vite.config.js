// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arup Biswas and AMPS contributors (binidev)
// AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server proxies the backend routes so `npm run dev` + `uvicorn --reload`
// just work side by side, same-origin, no CORS or VITE_AMPS_API needed.
// Point AMPS_DEV_API elsewhere (e.g. the office server) to develop the UI
// against a remote backend.
const api = process.env.AMPS_DEV_API ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': api,
      '/docs': api,
      '/openapi.json': api,
    },
  },
})
