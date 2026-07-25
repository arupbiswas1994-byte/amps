// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Arup Biswas and AMPS contributors (binidev)
// AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

/** Crisp SVG QR. Encodes a deep link so any phone camera opens the asset page. */
export default function QR({ value, size = 128 }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const n = qr.getModuleCount()
    let path = ''
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`
    return { path, n }
  }, [value])

  return (
    <svg
      viewBox={`0 0 ${svg.n} ${svg.n}`}
      width={size}
      height={size}
      role="img"
      aria-label={`QR code: ${value}`}
      shapeRendering="crispEdges"
    >
      <rect width={svg.n} height={svg.n} fill="#ffffff" />
      <path d={svg.path} fill="#1c1917" />
    </svg>
  )
}

// Encode the code so the QR/link is a valid URL — codes carry spaces and
// parens (e.g. "AHU-01 (CPD DCOS)"). encodeURIComponent is the exact inverse of
// the router's decode, so the page opens cleanly when scanned.
export const assetUrl = (code) => `${location.origin}/#/asset/${encodeURIComponent(code)}`
