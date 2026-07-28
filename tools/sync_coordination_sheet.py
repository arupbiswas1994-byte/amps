#!/usr/bin/env python3
"""Sync the AMPS line-coordination Google Sheet to the CURRENT data model.

The coordination workbook (Dashboard + per-line Assets/Logs tabs) is how each
line hands us its existing records before import. Whenever the AMPS schema
changes in a way a coordinator must know about — a new log `kind`, a new column,
a changed lifecycle — the sheet's Instructions tab and the Logs header cell-notes
must be re-synced so what they fill in still matches what we import.

This script is the single source of that text. Edit the constants below when the
model changes, then run it. It is idempotent (safe to re-run).

Usage:
    python3 tools/sync_coordination_sheet.py [--sheet <id>] [--dry-run]

Auth: the jarvis-drive service account (edit access to the sheet). Point
GDRIVE_SERVICE_ACCOUNT at the key, or it defaults to the gdrive-mcp copy.
"""
import argparse
import os
import sys

SHEET_ID = "1DFKVwJbkPskH0io5euUZa1y0Kat3kKK3ykS-hGmf_dY"
SA_DEFAULT = os.path.expanduser("~/biniWorkspace/mcp/gdrive_mcp/service-account.json")

# ---- canonical text: keep in step with backend/app/api/logbook.py ----

# the log kinds and the failure lifecycle, as the coordinator sees them
KIND_NOTE = (
    "The kind of entry:\n"
    "• maintenance — preventive work\n"
    "• failure — a breakdown (stays open until rectified)\n"
    "• acknowledgement — noted, not fixed (spare awaited / demand / mail) → amber\n"
    "• job_card — job card raised to OEM/dept → yellow; closed later by a rectification\n"
    "• rectification — the fix that resolves the failure → green\n"
    "• general — any other note"
)
CLOSES_NOTE = (
    "For acknowledgement / job_card / rectification: the failure it responds to.\n"
    "Format: ASSET@YYYY-MM-DD (or just the asset code, or a date).\n"
    "Leave blank for a stand-alone note or proactive fix."
)

# Instructions tab — the lines that describe the log model (1-indexed rows).
# Only the rows listed here are overwritten; the rest of the tab is left alone.
INSTRUCTIONS = {
    27: "kind*           maintenance / failure / acknowledgement / job_card / rectification / general. REQUIRED.",
    38: "resolved_on     Only for the RECTIFICATION that fixes a failure: when it was restored (YYYY-MM-DD [HH:MM]). A failure stays open until a rectification closes it.",
    39: 'closes_failure_ref  For acknowledgement / job_card / rectification: which failure this responds to — "ASSET@YYYY-MM-DD" (or just the asset, or a date). The importer links it to that asset\'s open failure. Leave blank for a stand-alone note/fix.',
    42: "The log kinds — and the failure lifecycle",
    43: "maintenance   scheduled/preventive work — advances the asset's schedule (use the frequency word in type).",
    44: "failure       a breakdown. It stays OPEN (red) until a rectification closes it. Give date + fault_type. A failure consumes no spares — spares go on the rectification.",
    45: "acknowledgement   the failure is noted but NOT yet fixed — e.g. spare not available, demand raised, mail sent. Keeps the failure OPEN and marks it AMBER. Link via closes_failure_ref.",
    46: "job_card      a job card was raised to the OEM / concerned dept for this failure. Keeps the failure OPEN and marks it YELLOW. It must later be CLOSED by a rectification. Link via closes_failure_ref.",
    47: "rectification the actual repair that RESOLVES the failure (turns it GREEN). Link via closes_failure_ref; put the recovery time in resolved_on and any spares in consumables. If it closes no open failure, it stands alone as a proactive fix.",
    48: "general       any other note (patrol, inspection, observation) — no schedule effect.",
    50: "Failure states shown in AMPS:  OPEN (red) → ACKNOWLEDGED (amber) → JOB CARD ISSUED (yellow) → RESOLVED (green). A faulty asset floats to the top of the register with its state colour until a rectification resolves it.",
}

# header column index (0-based) -> cell note, applied to every '· Logs' tab
LOG_HEADER_NOTES = {0: KIND_NOTE, 14: CLOSES_NOTE}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", default=SHEET_ID)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    sa = os.environ.get("GDRIVE_SERVICE_ACCOUNT", SA_DEFAULT)
    if not os.path.exists(sa):
        sys.exit(f"service account key not found: {sa}")
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
    creds = Credentials.from_service_account_file(
        sa, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    svc = build("sheets", "v4", credentials=creds)

    meta = svc.spreadsheets().get(spreadsheetId=args.sheet).execute()
    log_tabs = {s["properties"]["title"]: s["properties"]["sheetId"]
                for s in meta["sheets"]
                if s["properties"]["title"].endswith("· Logs")}
    print(f"workbook: {meta['properties']['title']}")
    print(f"Logs tabs: {list(log_tabs)}")

    if args.dry_run:
        print(f"[dry-run] would set {len(INSTRUCTIONS)} Instructions rows and "
              f"{len(LOG_HEADER_NOTES)} header notes on {len(log_tabs)} tabs")
        return

    # 1) Instructions text
    data = [{"range": f"'Instructions'!A{r}", "values": [[v]]}
            for r, v in INSTRUCTIONS.items()]
    svc.spreadsheets().values().batchUpdate(
        spreadsheetId=args.sheet,
        body={"valueInputOption": "RAW", "data": data}).execute()
    print(f"Instructions: {len(data)} rows synced")

    # 2) Logs header cell-notes
    reqs = []
    for _tab, sid in log_tabs.items():
        for col, note in LOG_HEADER_NOTES.items():
            reqs.append({"updateCells": {
                "range": {"sheetId": sid, "startRowIndex": 0, "endRowIndex": 1,
                          "startColumnIndex": col, "endColumnIndex": col + 1},
                "rows": [{"values": [{"note": note}]}], "fields": "note"}})
    svc.spreadsheets().batchUpdate(
        spreadsheetId=args.sheet, body={"requests": reqs}).execute()
    print(f"header notes: synced on {len(log_tabs)} Logs tabs")


if __name__ == "__main__":
    main()
